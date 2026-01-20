"""Smart Sprinkler Manager sensor platform."""

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .models.zone import SprinklerSystem

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Smart Sprinkler Manager sensor from a config entry."""
    
    # Create the summary sensor for this system
    system_name = config_entry.data.get("system_name", "Smart Sprinkler System")
    entity_id = f"sprinkler.{system_name.lower().replace(' ', '_')}"
    
    sensor = SmartSprinklerManagerSensor(
        hass=hass,
        entity_id=entity_id,
        system_name=system_name,
        config_entry=config_entry
    )
    
    async_add_entities([sensor], True)


class SmartSprinklerManagerSensor(SensorEntity):
    """Backend-driven summary sensor with rich attributes - Zero Sensor Pollution Architecture."""

    def __init__(
        self,
        hass: HomeAssistant,
        entity_id: str,
        system_name: str,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the sprinkler system sensor."""
        self.hass = hass
        self._entity_id = entity_id
        self._system_name = system_name
        self._config_entry = config_entry
        
        # Initialize the sprinkler system object
        self._system_data = SprinklerSystem(
            system_name=system_name,
            entity_id=entity_id,
            zone_count=config_entry.data.get("zone_count", 8)
        )
        
        # Store system data in hass.data for service access
        if DOMAIN not in hass.data:
            hass.data[DOMAIN] = {}
        hass.data[DOMAIN][entity_id] = self._system_data
        
        _LOGGER.info("Initialized Smart Sprinkler Manager: %s", system_name)

    @property
    def entity_id(self) -> str:
        """Return the entity ID."""
        return self._entity_id

    @property
    def name(self) -> str:
        """Return the name of the sensor."""
        return f"{self._system_name} Smart Sprinkler Manager"

    @property
    def unique_id(self) -> str:
        """Return a unique ID for this sensor."""
        return f"{DOMAIN}_{self._entity_id}"

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
        """Calculate all attributes - ALL DISPLAY LOGIC IN BACKEND."""
        # Update system state first
        self._system_data.update_system_state()
        
        # Get system summary
        summary = self._system_data.get_system_summary()
        
        # Add detailed zone information
        zone_details = {}
        for zone_id, zone in self._system_data.zones.items():
            zone_details[f"zone_{zone_id}"] = {
                "name": zone.settings.name,
                "state": zone.state,
                "enabled": zone.settings.enabled,
                "duration": zone.settings.duration,
                "remaining_time": zone.remaining_duration,
                "runtime_today": zone.total_runtime_today,
                "water_used_today": round(zone.total_water_used_today, 2),
                "last_run": zone.last_watering_date.isoformat() if zone.last_watering_date else None,
                
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
                "zone_count": len(schedule.zone_ids),
                "next_run": schedule.next_run_date.isoformat() if schedule.next_run_date else None,
                "last_run": schedule.last_run_date.isoformat() if schedule.last_run_date else None,
                
                # Backend-calculated display properties
                "is_active_today": schedule.is_active_today(),
                "should_run_now": schedule.should_run_now(),
            }
        
        # Combine all attributes
        attributes = {
            **summary,
            "zone_details": zone_details,
            "schedule_details": schedule_details,
            "config": {
                "zone_count": self._system_data.zone_count,
                "weather_entity": self._system_data.weather_entity_id,
                "rain_sensor_entity": self._system_data.rain_sensor_entity_id,
            },
            "statistics": {
                "total_schedules": len(self._system_data.schedules),
                "enabled_schedules": len([s for s in self._system_data.schedules.values() if s.enabled]),
                "zones_watered_today": len([z for z in self._system_data.zones.values() if z.total_runtime_today > 0]),
            }
        }
        
        return attributes

    def _get_zone_display_title(self, zone) -> str:
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

    def _get_zone_status_color(self, zone) -> str:
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

    def _get_zone_status_text(self, zone) -> str:
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

    async def async_update(self) -> None:
        """Update the sensor state."""
        # The state and attributes are calculated on-demand
        # This method can be used for any additional data fetching if needed
        pass