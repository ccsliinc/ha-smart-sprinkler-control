"""Sprinkler zone models for Smart Sprinkler Control."""

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

_LOGGER = logging.getLogger(__name__)


@dataclass
class ZoneSettings:
    """Settings for a sprinkler zone."""

    name: str
    duration: int = 15  # Default watering duration in minutes
    enabled: bool = True
    flow_rate: Optional[float] = None  # GPM (gallons per minute)
    area_sqft: Optional[float] = None  # Square footage for calculations
    switch_entity: Optional[str] = None  # HA switch entity to control this zone


@dataclass
class Zone:
    """Represents a single sprinkler zone."""

    zone_id: int
    settings: ZoneSettings

    # Current state
    state: str = "idle"  # idle, watering, scheduled, disabled, error, rain_delayed
    current_schedule_id: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    remaining_duration: int = 0  # minutes

    # Schedule queue - list of (zone_id, duration) tuples for remaining zones
    # Passed from zone to zone during schedule execution
    schedule_queue: List[tuple] = field(default_factory=list)

    # Statistics
    total_runtime_today: int = 0  # minutes
    total_runtime_week: int = 0  # minutes
    total_water_used_today: float = 0.0  # gallons
    total_water_used_week: float = 0.0  # gallons
    last_watering_date: Optional[datetime] = None

    def is_watering(self) -> bool:
        """Check if zone is currently watering."""
        return self.state == "watering"

    def can_start(self) -> bool:
        """Check if zone can be started."""
        return self.settings.enabled and self.state in ["idle", "scheduled"]

    def start_watering(self, duration: int, schedule_id: Optional[str] = None) -> bool:
        """Start watering this zone."""
        if not self.can_start():
            _LOGGER.warning(
                "Cannot start zone %d: current state is %s", self.zone_id, self.state
            )
            return False

        self.state = "watering"
        self.start_time = datetime.now()
        self.end_time = datetime.now() + timedelta(minutes=duration)
        self.remaining_duration = duration
        self.current_schedule_id = schedule_id

        _LOGGER.info("Started watering zone %d for %d minutes", self.zone_id, duration)
        return True

    def stop_watering(self) -> tuple:
        """Stop watering this zone.

        Returns:
            tuple: (success: bool, schedule_queue: list) - the queue of remaining zones
        """
        if not self.is_watering():
            return (False, [])

        actual_runtime = 0
        water_used = 0.0

        if self.start_time:
            actual_runtime = int(
                (datetime.now() - self.start_time).total_seconds() / 60
            )
            if self.settings.flow_rate:
                water_used = (actual_runtime / 60.0) * self.settings.flow_rate

        # Capture the queue before clearing
        remaining_queue = self.schedule_queue.copy()
        schedule_id = self.current_schedule_id

        # Only count this as real watering activity if the session actually
        # started (had a start_time). This guards "last run" and runtime stats
        # against being polluted by availability transitions (e.g. an ESPHome
        # controller reconnecting and flipping switches unavailable->off, or the
        # safety all-off path) which must never register as a watering run.
        real_session = self.start_time is not None

        self.state = "idle"
        self.start_time = None
        self.end_time = None
        self.remaining_duration = 0
        self.current_schedule_id = None
        self.schedule_queue = []  # Clear the queue

        if real_session:
            # Reflect ONLY actual watering in last-run/activity and statistics.
            self.last_watering_date = datetime.now()
            self.total_runtime_today += actual_runtime
            self.total_runtime_week += actual_runtime
            self.total_water_used_today += water_used
            self.total_water_used_week += water_used

        _LOGGER.info(
            "Stopped watering zone %d after %d minutes, used %.1f gallons",
            self.zone_id,
            actual_runtime,
            water_used,
        )

        return (True, remaining_queue, schedule_id)

    def update_remaining_time(self) -> bool:
        """Update remaining duration based on current time."""
        if not self.is_watering() or not self.end_time:
            return False

        remaining_seconds = (self.end_time - datetime.now()).total_seconds()

        # Auto-stop if time is up (use 1-second buffer for timing jitter)
        # Without buffer, coordinator might run 3ms before end_time and miss the stop
        if remaining_seconds <= 1:
            # Zone is auto-stopped here; it is no longer watering, so report
            # False ("not running"). The caller ignores this return value and
            # the post-stop side effects are handled inside stop_watering().
            self.stop_watering()
            return False

        # Use round() not int() to avoid truncation errors (299 sec = 5 min, not 4)
        # Use max(1, ...) to ensure display shows at least 1 minute while running
        self.remaining_duration = max(1, round(remaining_seconds / 60))

        return True


@dataclass
class SprinklerSchedule:
    """Represents a watering schedule."""

    schedule_id: str
    name: str
    zone_ids: List[int]
    start_time: time
    days_of_week: List[int]  # 0=Monday, 6=Sunday
    enabled: bool = True

    # Zone durations (zone_id -> duration in minutes)
    zone_durations: Dict[int, int] = field(default_factory=dict)

    # Weather conditions
    skip_if_rain: bool = True
    rain_threshold: float = 0.1  # inches

    # Schedule metadata
    created_date: datetime = field(default_factory=datetime.now)
    last_run_date: Optional[datetime] = None
    next_run_date: Optional[datetime] = None

    def is_active_today(self) -> bool:
        """Check if schedule should run today."""
        if not self.enabled:
            return False

        today = datetime.now().weekday()
        return today in self.days_of_week

    def should_run_now(self) -> bool:
        """Check if schedule should run right now."""
        if not self.is_active_today():
            return False

        now = datetime.now().time()
        return now >= self.start_time

    def get_zone_duration(self, zone_id: int) -> int:
        """Get duration for a specific zone."""
        return self.zone_durations.get(zone_id, 15)  # Default 15 minutes


@dataclass
class SprinklerSystem:
    """Main sprinkler system class - zero sensor pollution architecture."""

    # Basic system information
    system_name: str
    entity_id: str
    zone_count: int = 8  # Default zone count

    # All zones stored as Python objects (NO SENSORS!)
    zones: Dict[int, Zone] = field(default_factory=dict)

    # All schedules stored as Python objects (NO SENSORS!)
    schedules: Dict[str, SprinklerSchedule] = field(default_factory=dict)

    # System state and settings (NO SENSORS!)
    is_enabled: bool = True
    rain_delay_active: bool = False
    rain_delay_end_time: Optional[datetime] = None
    # True only when the active rain delay was set automatically by the
    # weather/auto-rain logic. Distinct from a manual delay so auto-clear can
    # never clear a delay the user set by hand, and the manual button always
    # takes precedence over auto.
    auto_rain_delay: bool = False
    weather_entity_id: Optional[str] = None
    rain_sensor_entity_id: Optional[str] = None

    # System statistics (NO SENSORS!)
    total_water_used_today: float = 0.0  # gallons
    total_water_used_week: float = 0.0
    total_runtime_today: int = 0  # minutes
    total_runtime_week: int = 0
    active_zones_count: int = 0
    # Calendar date the daily statistics above belong to. Used to reset
    # per-zone and system daily totals at the day rollover. Persisted so a
    # restart neither double-resets nor skips a reset. None until first set.
    stats_date: Optional[date] = None

    # Connection and status (NO SENSORS!)
    is_connected: bool = True
    connection_status: str = "Connected"
    last_updated: Optional[datetime] = None

    def __post_init__(self) -> None:
        """Initialize zones after creation."""
        if not self.zones:
            for zone_id in range(1, self.zone_count + 1):
                zone_settings = ZoneSettings(name=f"Zone {zone_id}")
                self.zones[zone_id] = Zone(zone_id=zone_id, settings=zone_settings)

    def reset_daily_stats_if_new_day(self, today: Optional[date] = None) -> bool:
        """Reset per-zone and system daily totals at the day rollover.

        Description:
            Zeroes ``total_runtime_today`` / ``total_water_used_today`` on every
            zone and on the system whenever the calendar date has changed since
            the last reset. Tracked via ``self.stats_date`` so a reset happens
            exactly once per day and survives restarts (the date is persisted).

        Inputs:
            today (Optional[date]): the current date; defaults to ``date.today()``.

        Outputs:
            bool: True if a reset was performed, False if it was already current.

        Example:
            >>> system.reset_daily_stats_if_new_day()  # at 00:00 rollover
            True
        """
        if today is None:
            today = datetime.now().date()

        # First-ever run (no persisted date): adopt today without wiping any
        # stats restored from storage. Subsequent days trigger a real reset.
        if self.stats_date is None:
            self.stats_date = today
            return False

        if self.stats_date == today:
            return False

        for zone in self.zones.values():
            zone.total_runtime_today = 0
            zone.total_water_used_today = 0.0
        self.total_runtime_today = 0
        self.total_water_used_today = 0.0
        self.stats_date = today
        _LOGGER.info("Daily sprinkler statistics reset for %s", today.isoformat())
        return True

    def get_active_zones(self) -> List[Zone]:
        """Get list of currently watering zones."""
        return [zone for zone in self.zones.values() if zone.is_watering()]

    def is_schedule_running(self) -> bool:
        """Check if any schedule is running (zone has a queue or schedule_id)."""
        for zone in self.zones.values():
            if zone.current_schedule_id or zone.schedule_queue:
                return True
        return False

    def get_running_schedule_id(self) -> Optional[str]:
        """Get the ID of the currently running schedule, if any."""
        for zone in self.zones.values():
            if zone.current_schedule_id:
                return zone.current_schedule_id
        return None

    def get_scheduled_zones(self) -> List[Zone]:
        """Get list of zones that are scheduled to run."""
        return [zone for zone in self.zones.values() if zone.state == "scheduled"]

    def start_zone(
        self, zone_id: int, duration: int, schedule_id: Optional[str] = None
    ) -> bool:
        """Start a specific zone.

        Only one zone can run at a time to maintain water pressure.
        Starting a new zone will automatically stop any currently running zone.
        """
        if zone_id not in self.zones:
            _LOGGER.error("Zone %d does not exist", zone_id)
            return False

        if self.rain_delay_active:
            _LOGGER.warning("Cannot start zone %d: rain delay is active", zone_id)
            return False

        if not self.is_enabled:
            _LOGGER.warning("Cannot start zone %d: system is disabled", zone_id)
            return False

        # Single-zone operation: stop any currently running zone first
        active_zones = self.get_active_zones()
        if active_zones:
            for active_zone in active_zones:
                _LOGGER.info(
                    "Stopping zone %d to start zone %d (single-zone operation)",
                    active_zone.zone_id,
                    zone_id,
                )
                active_zone.stop_watering()

        zone = self.zones[zone_id]
        result = zone.start_watering(duration, schedule_id)

        if result:
            self.active_zones_count = len(self.get_active_zones())
            self.last_updated = datetime.now()

        return result

    def stop_zone(self, zone_id: int) -> tuple:
        """Stop a specific zone.

        Returns:
            tuple: (success: bool, schedule_queue: list, schedule_id: str or None)
        """
        if zone_id not in self.zones:
            _LOGGER.error("Zone %d does not exist", zone_id)
            return (False, [], None)

        zone = self.zones[zone_id]
        result = zone.stop_watering()

        if result[0]:  # result is (success, queue, schedule_id)
            self.active_zones_count = len(self.get_active_zones())
            self.last_updated = datetime.now()

            # Update system statistics
            self.total_runtime_today += zone.total_runtime_today
            self.total_water_used_today += zone.total_water_used_today

        return result

    def stop_all_zones(self) -> bool:
        """Stop all running zones."""
        stopped_any = False
        for zone in self.zones.values():
            if zone.is_watering():
                if zone.stop_watering():
                    stopped_any = True

        if stopped_any:
            self.active_zones_count = 0
            self.last_updated = datetime.now()

        return stopped_any

    def enable_rain_delay(self, hours: int = 24, auto: bool = False) -> None:
        """Enable rain delay for specified hours.

        Description:
            Activates rain delay, stops running zones, and marks scheduled
            zones as rain_delayed.
        Inputs:
            hours: Duration of the delay in hours.
            auto: True when set by the automatic weather logic. A *manual*
                enable (auto=False) always clears the auto flag so the manual
                delay takes precedence and won't be auto-cleared. An *auto*
                enable never downgrades an existing manual delay to auto.
        Outputs:
            None.
        """
        # A manual request always wins: clear the auto flag. An auto request
        # must not overwrite an existing manual delay.
        if auto:
            if self.rain_delay_active and not self.auto_rain_delay:
                # Manual delay already in effect — leave it untouched.
                return
            self.auto_rain_delay = True
        else:
            self.auto_rain_delay = False

        self.rain_delay_active = True
        self.rain_delay_end_time = datetime.now() + timedelta(hours=hours)

        # Stop all running zones
        self.stop_all_zones()

        # Set all scheduled zones to rain delayed
        for zone in self.zones.values():
            if zone.state == "scheduled":
                zone.state = "rain_delayed"

        _LOGGER.info(
            "Rain delay enabled for %d hours (%s)",
            hours,
            "auto" if auto else "manual",
        )

    def disable_rain_delay(self, auto: bool = False) -> bool:
        """Disable rain delay.

        Description:
            Clears the rain delay and restores rain_delayed zones to scheduled.
        Inputs:
            auto: True when called by the automatic weather logic. An auto
                clear is a no-op when the active delay was set manually, so a
                dry spell never cancels a delay the user set by hand.
        Outputs:
            bool — True if a delay was actually cleared, False if skipped.
        """
        if not self.rain_delay_active:
            return False

        # Auto-clear must never cancel a manually set delay.
        if auto and not self.auto_rain_delay:
            return False

        self.rain_delay_active = False
        self.rain_delay_end_time = None
        self.auto_rain_delay = False

        # Restore rain delayed zones to scheduled
        for zone in self.zones.values():
            if zone.state == "rain_delayed":
                zone.state = "scheduled"

        _LOGGER.info("Rain delay disabled (%s)", "auto" if auto else "manual")
        return True

    def update_system_state(self) -> None:
        """Update system state and zone timers."""
        # Check if rain delay should expire (timer-based expiry clears both
        # auto and manual delays; force-clear via auto=False bypasses the
        # manual-protection guard since the timer the user/auto set is up).
        if self.rain_delay_active and self.rain_delay_end_time:
            if datetime.now() >= self.rain_delay_end_time:
                self.disable_rain_delay()

        # Update all zones
        for zone in self.zones.values():
            zone.update_remaining_time()

        # Update system statistics
        self.active_zones_count = len(self.get_active_zones())
        self.last_updated = datetime.now()

    def create_schedule(self, schedule: SprinklerSchedule) -> bool:
        """Create or update a watering schedule (upsert)."""
        is_update = schedule.schedule_id in self.schedules
        self.schedules[schedule.schedule_id] = schedule
        if is_update:
            _LOGGER.info("Updated schedule: %s", schedule.name)
        else:
            _LOGGER.info("Created schedule: %s", schedule.name)
        return True

    def delete_schedule(self, schedule_id: str) -> bool:
        """Delete a watering schedule."""
        if schedule_id not in self.schedules:
            _LOGGER.warning("Schedule %s does not exist", schedule_id)
            return False

        # Stop any zones running from this schedule
        for zone in self.zones.values():
            if zone.current_schedule_id == schedule_id:
                zone.stop_watering()

        del self.schedules[schedule_id]
        _LOGGER.info("Deleted schedule: %s", schedule_id)
        return True

    def get_system_summary(self) -> Dict[str, Any]:
        """Get system summary for the summary sensor."""
        active_zones = self.get_active_zones()

        return {
            "system_name": self.system_name,
            "total_zones": self.zone_count,
            "active_zones": len(active_zones),
            "scheduled_zones": len(self.get_scheduled_zones()),
            "enabled_zones": len(
                [z for z in self.zones.values() if z.settings.enabled]
            ),
            "rain_delay_active": self.rain_delay_active,
            "rain_delay_end_time": (
                self.rain_delay_end_time.isoformat()
                if self.rain_delay_end_time
                else None
            ),
            "total_water_today": round(self.total_water_used_today, 2),
            "total_runtime_today": self.total_runtime_today,
            "active_zone_names": [
                f"Zone {z.zone_id}: {z.settings.name}" for z in active_zones
            ],
            "connection_status": self.connection_status,
            "last_updated": (
                self.last_updated.isoformat() if self.last_updated else None
            ),
        }

    def get_overall_state(self) -> str:
        """Get overall system state for the sensor."""
        if not self.is_enabled:
            return "disabled"

        if self.rain_delay_active:
            return "rain_delayed"

        active_zones = self.get_active_zones()
        if active_zones:
            return f"watering_{len(active_zones)}_zones"

        scheduled_zones = self.get_scheduled_zones()
        if scheduled_zones:
            return "scheduled"

        return "idle"
