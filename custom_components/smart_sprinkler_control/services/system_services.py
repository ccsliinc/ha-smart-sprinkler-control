"""System-wide services for Smart Sprinkler Control."""

import logging
from datetime import datetime
from typing import Any, Dict

from homeassistant.core import HomeAssistant

from ..models.zone import SprinklerSystem

_LOGGER = logging.getLogger(__name__)


class SystemServices:
    """Service layer for system-wide sprinkler operations."""

    def __init__(self, hass: HomeAssistant, sprinkler_system: SprinklerSystem):
        """Initialize system services."""
        self.hass = hass
        self.system = sprinkler_system

    async def enable_system(self) -> bool:
        """Enable the sprinkler system."""
        _LOGGER.info("Enabling sprinkler system")
        self.system.is_enabled = True
        self.system.last_updated = datetime.now()

        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True

    async def disable_system(self) -> bool:
        """Disable the sprinkler system and stop all zones."""
        _LOGGER.info("Disabling sprinkler system")

        # Stop all running zones first
        self.system.stop_all_zones()

        self.system.is_enabled = False
        self.system.last_updated = datetime.now()

        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True

    async def enable_rain_delay(self, hours: int = 24) -> bool:
        """Enable rain delay for specified hours."""
        _LOGGER.info("Enabling rain delay for %d hours", hours)

        self.system.enable_rain_delay(hours)

        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True

    async def disable_rain_delay(self) -> bool:
        """Disable rain delay."""
        _LOGGER.info("Disabling rain delay")

        self.system.disable_rain_delay()

        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True

    async def update_system_settings(self, **settings: Any) -> bool:
        """Update system-wide settings."""
        _LOGGER.info("Updating system settings: %s", settings)

        if "system_name" in settings:
            self.system.system_name = settings["system_name"]
        if "weather_entity_id" in settings:
            self.system.weather_entity_id = settings["weather_entity_id"]
        if "rain_sensor_entity_id" in settings:
            self.system.rain_sensor_entity_id = settings["rain_sensor_entity_id"]

        self.system.last_updated = datetime.now()

        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True

    async def get_system_status(self) -> Dict[str, Any]:
        """Get comprehensive system status."""
        # Update system state first
        self.system.update_system_state()

        return {
            "state": self.system.get_overall_state(),
            "attributes": self.system.get_system_summary(),
            "zone_details": {
                f"zone_{zone.zone_id}": {
                    "name": zone.settings.name,
                    "state": zone.state,
                    "enabled": zone.settings.enabled,
                    "remaining_duration": zone.remaining_duration,
                    "can_start": zone.can_start(),
                    "is_watering": zone.is_watering(),
                    "last_watering": (
                        zone.last_watering_date.isoformat()
                        if zone.last_watering_date
                        else None
                    ),
                    "total_runtime_today": zone.total_runtime_today,
                    "total_water_today": round(zone.total_water_used_today, 2),
                    "settings": {
                        "duration": zone.settings.duration,
                        "flow_rate": zone.settings.flow_rate,
                        "area_sqft": zone.settings.area_sqft,
                    },
                }
                for zone in self.system.zones.values()
            },
        }

    async def _trigger_sensor_update(self) -> None:
        """Trigger update of the sensor entity."""
        # This will be implemented when sensor is fully set up
        # For now, just update the system state
        self.system.update_system_state()
