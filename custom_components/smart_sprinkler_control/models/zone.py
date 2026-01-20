"""Sprinkler zone models for Smart Sprinkler Control."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, time
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
            _LOGGER.warning("Cannot start zone %d: current state is %s", self.zone_id, self.state)
            return False
        
        self.state = "watering"
        self.start_time = datetime.now()
        self.end_time = datetime.now() + timedelta(minutes=duration)
        self.remaining_duration = duration
        self.current_schedule_id = schedule_id
        
        _LOGGER.info("Started watering zone %d for %d minutes", self.zone_id, duration)
        return True
    
    def stop_watering(self) -> bool:
        """Stop watering this zone."""
        if not self.is_watering():
            return False
        
        actual_runtime = 0
        water_used = 0.0
        
        if self.start_time:
            actual_runtime = int((datetime.now() - self.start_time).total_seconds() / 60)
            if self.settings.flow_rate:
                water_used = (actual_runtime / 60.0) * self.settings.flow_rate
        
        self.state = "idle"
        self.start_time = None
        self.end_time = None
        self.remaining_duration = 0
        self.current_schedule_id = None
        self.last_watering_date = datetime.now()
        
        # Update statistics
        self.total_runtime_today += actual_runtime
        self.total_runtime_week += actual_runtime
        self.total_water_used_today += water_used
        self.total_water_used_week += water_used
        
        _LOGGER.info("Stopped watering zone %d after %d minutes, used %.1f gallons", 
                    self.zone_id, actual_runtime, water_used)
        return True
    
    def update_remaining_time(self) -> bool:
        """Update remaining duration based on current time."""
        if not self.is_watering() or not self.end_time:
            return False
        
        remaining_seconds = (self.end_time - datetime.now()).total_seconds()
        self.remaining_duration = max(0, int(remaining_seconds / 60))
        
        # Auto-stop if time is up
        if self.remaining_duration <= 0:
            return self.stop_watering()
        
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
    weather_entity_id: Optional[str] = None
    rain_sensor_entity_id: Optional[str] = None
    
    # System statistics (NO SENSORS!)
    total_water_used_today: float = 0.0  # gallons
    total_water_used_week: float = 0.0
    total_runtime_today: int = 0  # minutes
    total_runtime_week: int = 0
    active_zones_count: int = 0
    
    # Connection and status (NO SENSORS!)
    is_connected: bool = True
    connection_status: str = "Connected"
    last_updated: Optional[datetime] = None
    
    def __post_init__(self):
        """Initialize zones after creation."""
        if not self.zones:
            for zone_id in range(1, self.zone_count + 1):
                zone_settings = ZoneSettings(name=f"Zone {zone_id}")
                self.zones[zone_id] = Zone(zone_id=zone_id, settings=zone_settings)
    
    def get_active_zones(self) -> List[Zone]:
        """Get list of currently watering zones."""
        return [zone for zone in self.zones.values() if zone.is_watering()]
    
    def get_scheduled_zones(self) -> List[Zone]:
        """Get list of zones that are scheduled to run."""
        return [zone for zone in self.zones.values() if zone.state == "scheduled"]
    
    def start_zone(self, zone_id: int, duration: int, schedule_id: Optional[str] = None) -> bool:
        """Start a specific zone."""
        if zone_id not in self.zones:
            _LOGGER.error("Zone %d does not exist", zone_id)
            return False
        
        if self.rain_delay_active:
            _LOGGER.warning("Cannot start zone %d: rain delay is active", zone_id)
            return False
        
        if not self.is_enabled:
            _LOGGER.warning("Cannot start zone %d: system is disabled", zone_id)
            return False
        
        zone = self.zones[zone_id]
        result = zone.start_watering(duration, schedule_id)
        
        if result:
            self.active_zones_count = len(self.get_active_zones())
            self.last_updated = datetime.now()
        
        return result
    
    def stop_zone(self, zone_id: int) -> bool:
        """Stop a specific zone."""
        if zone_id not in self.zones:
            _LOGGER.error("Zone %d does not exist", zone_id)
            return False
        
        zone = self.zones[zone_id]
        result = zone.stop_watering()
        
        if result:
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
    
    def enable_rain_delay(self, hours: int = 24) -> None:
        """Enable rain delay for specified hours."""
        self.rain_delay_active = True
        self.rain_delay_end_time = datetime.now() + timedelta(hours=hours)
        
        # Stop all running zones
        self.stop_all_zones()
        
        # Set all scheduled zones to rain delayed
        for zone in self.zones.values():
            if zone.state == "scheduled":
                zone.state = "rain_delayed"
        
        _LOGGER.info("Rain delay enabled for %d hours", hours)
    
    def disable_rain_delay(self) -> None:
        """Disable rain delay."""
        self.rain_delay_active = False
        self.rain_delay_end_time = None
        
        # Restore rain delayed zones to scheduled
        for zone in self.zones.values():
            if zone.state == "rain_delayed":
                zone.state = "scheduled"
        
        _LOGGER.info("Rain delay disabled")
    
    def update_system_state(self) -> None:
        """Update system state and zone timers."""
        # Check if rain delay should expire
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
        """Create a new watering schedule."""
        if schedule.schedule_id in self.schedules:
            _LOGGER.warning("Schedule %s already exists", schedule.schedule_id)
            return False
        
        self.schedules[schedule.schedule_id] = schedule
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
            "enabled_zones": len([z for z in self.zones.values() if z.settings.enabled]),
            "rain_delay_active": self.rain_delay_active,
            "rain_delay_end_time": self.rain_delay_end_time.isoformat() if self.rain_delay_end_time else None,
            "total_water_today": round(self.total_water_used_today, 2),
            "total_runtime_today": self.total_runtime_today,
            "active_zone_names": [f"Zone {z.zone_id}: {z.settings.name}" for z in active_zones],
            "connection_status": self.connection_status,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
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