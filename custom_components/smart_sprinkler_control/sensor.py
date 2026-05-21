"""Smart Sprinkler Manager sensor platform."""

import logging
from typing import Any, Dict

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .const import DOMAIN
from .models.zone import SprinklerSystem, Zone

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Smart Sprinkler Manager sensor from a config entry."""
    # Get the already-configured system and coordinator from __init__.py
    entry_data = hass.data[DOMAIN].get(config_entry.entry_id, {})
    system = entry_data.get("system")
    coordinator = entry_data.get("coordinator")

    if not system:
        _LOGGER.error("No system found for config entry %s", config_entry.entry_id)
        return

    if not coordinator:
        _LOGGER.error("No coordinator found for config entry %s", config_entry.entry_id)
        return

    sensor = SmartSprinklerManagerSensor(
        coordinator=coordinator, system=system, config_entry=config_entry
    )

    async_add_entities([sensor], True)


class SmartSprinklerManagerSensor(CoordinatorEntity, SensorEntity):
    """Backend-driven summary sensor - Zero Sensor Pollution Architecture.

    Exposes the whole system as a single sensor with rich attributes.
    Inherits from CoordinatorEntity for automatic state updates when the
    coordinator refreshes.
    """

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: DataUpdateCoordinator,
        system: SprinklerSystem,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the sprinkler system sensor.

        Args:
            coordinator: The DataUpdateCoordinator instance
            system: The SprinklerSystem object (created and configured in __init__.py)
            config_entry: Config entry for this integration
        """
        # Initialize CoordinatorEntity first
        super().__init__(coordinator)

        self._config_entry = config_entry

        # Use the system object from __init__.py (zones already configured
        # with their switch entities).
        self._system_data = system
        self._system_name = system.system_name

        # Set HA entity attributes
        self._attr_unique_id = f"{DOMAIN}_{config_entry.entry_id}"
        self._attr_name = system.system_name
        self._attr_attribution = "Smart Sprinkler Control"

        _LOGGER.info(
            "Initialized Smart Sprinkler Manager sensor: %s "
            "(CoordinatorEntity for instant updates)",
            system.system_name,
        )

    @property
    def state(self) -> str:
        """Return the state of the sensor - calculated in backend."""
        return self._calculate_state()

    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        """Return the state attributes - all calculated in backend."""
        return self._calculate_attributes()

    @property
    def icon(self) -> str:
        """Return the icon for the sensor."""
        active_zones = len(self._system_data.get_active_zones())
        if active_zones > 0:
            return "mdi:sprinkler"
        elif self._system_data.rain_delay_active:
            return "mdi:weather-rainy"
        elif not self._system_data.is_enabled:
            return "mdi:sprinkler-off"
        else:
            return "mdi:sprinkler-variant"

    @property
    def device_class(self) -> str:
        """Return the device class."""
        return "water"

    def _calculate_state(self) -> str:
        """Calculate the current state - ALL LOGIC IN BACKEND."""
        if not self._system_data.is_enabled:
            return "disabled"

        if self._system_data.rain_delay_active:
            return "rain_delayed"

        active_zones = self._system_data.get_active_zones()
        if active_zones:
            return f"watering_{len(active_zones)}_zones"

        scheduled_zones = self._system_data.get_scheduled_zones()
        if scheduled_zones:
            return f"scheduled_{len(scheduled_zones)}_zones"

        return "idle"

    def _calculate_attributes(self) -> Dict[str, Any]:
        """Calculate all attributes - ALL DISPLAY LOGIC IN BACKEND.

        NOTE: This method is READ-ONLY. It must NOT modify system state.
        The coordinator is the ONLY place that should call update_system_state()
        to ensure proper schedule continuation when zones stop.
        """
        # Get system summary (read-only - do NOT call update_system_state here!)
        summary = self._system_data.get_system_summary()

        # Add detailed zone information
        zone_details = {}
        for zone_id, zone in self._system_data.zones.items():
            # Calculate current watering duration (total minutes for this session)
            watering_duration = 0
            if zone.is_watering() and zone.start_time and zone.end_time:
                watering_duration = int(
                    (zone.end_time - zone.start_time).total_seconds() / 60
                )

            zone_details[str(zone_id)] = {
                "name": zone.settings.name,
                "state": zone.state,
                "enabled": zone.settings.enabled,
                "duration": zone.settings.duration,
                "flow_rate": zone.settings.flow_rate,
                "area_sqft": zone.settings.area_sqft,
                "remaining_time": zone.remaining_duration,
                # Total duration of the current watering session (minutes).
                "watering_duration": watering_duration,
                "runtime_today": zone.total_runtime_today,
                "water_used_today": round(zone.total_water_used_today, 2),
                "last_run": (
                    zone.last_watering_date.isoformat()
                    if zone.last_watering_date
                    else None
                ),
                # Backend-calculated display properties
                "display_title": self._get_zone_display_title(zone),
                "status_color": self._get_zone_status_color(zone),
                "status_text": self._get_zone_status_text(zone),
                "can_start": zone.can_start(),
                "is_running": zone.is_watering(),
            }

        # Add schedule information
        schedule_details = {}
        for schedule_id, schedule in self._system_data.schedules.items():
            schedule_details[schedule_id] = {
                "name": schedule.name,
                "enabled": schedule.enabled,
                "start_time": schedule.start_time.strftime("%H:%M"),
                "days_of_week": schedule.days_of_week,
                "zone_ids": schedule.zone_ids,
                "zone_durations": schedule.zone_durations,
                "zone_count": len(schedule.zone_ids),
                "skip_if_rain": schedule.skip_if_rain,
                "next_run": (
                    schedule.next_run_date.isoformat()
                    if schedule.next_run_date
                    else None
                ),
                "last_run": (
                    schedule.last_run_date.isoformat()
                    if schedule.last_run_date
                    else None
                ),
                # Backend-calculated display properties
                "is_active_today": schedule.is_active_today(),
                "should_run_now": schedule.should_run_now(),
            }

        # Combine all attributes
        attributes = {
            # Marker for frontend to identify this entity
            "integration": DOMAIN,
            **summary,
            "zones": zone_details,
            "schedules": schedule_details,
            "config": {
                "zone_count": self._system_data.zone_count,
                "weather_entity": self._system_data.weather_entity_id,
                "rain_sensor_entity": self._system_data.rain_sensor_entity_id,
            },
            "statistics": {
                "total_schedules": len(self._system_data.schedules),
                "enabled_schedules": len(
                    [s for s in self._system_data.schedules.values() if s.enabled]
                ),
                "zones_watered_today": len(
                    [
                        z
                        for z in self._system_data.zones.values()
                        if z.total_runtime_today > 0
                    ]
                ),
            },
        }

        return attributes

    def _get_zone_display_title(self, zone: Zone) -> str:
        """Get backend-calculated display title for zone."""
        base_title = f"Zone {zone.zone_id}: {zone.settings.name}"

        if zone.is_watering() and zone.remaining_duration > 0:
            return f"{base_title} ({zone.remaining_duration}m remaining)"
        elif zone.state == "scheduled":
            return f"{base_title} (Scheduled)"
        elif zone.state == "rain_delayed":
            return f"{base_title} (Rain Delayed)"
        elif not zone.settings.enabled:
            return f"{base_title} (Disabled)"
        else:
            return base_title

    def _get_zone_status_color(self, zone: Zone) -> str:
        """Get backend-calculated status color for zone."""
        if not zone.settings.enabled:
            return "#9e9e9e"  # Grey - disabled
        elif zone.state == "running":
            return "#4caf50"  # Green - active
        elif zone.state == "scheduled":
            return "#2196f3"  # Blue - scheduled
        elif zone.state == "rain_delayed":
            return "#ff9800"  # Orange - delayed
        else:
            return "#757575"  # Light grey - idle

    def _get_zone_status_text(self, zone: Zone) -> str:
        """Get backend-calculated status text for zone."""
        if not zone.settings.enabled:
            return "Disabled"
        elif zone.is_watering():
            return f"Running ({zone.remaining_duration}m)"
        elif zone.state == "scheduled":
            return "Scheduled"
        elif zone.state == "rain_delayed":
            return "Rain Delayed"
        else:
            return "Ready"

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return bool(self.coordinator.last_update_success)
