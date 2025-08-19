"""Zone control services for Smart Sprinkler Control."""

import logging
from typing import Optional
from homeassistant.core import HomeAssistant
from ..models.zone import SprinklerSystem

_LOGGER = logging.getLogger(__name__)


class ZoneServices:
    """Service layer for sprinkler zone operations."""
    
    def __init__(self, hass: HomeAssistant, sprinkler_system: SprinklerSystem):
        """Initialize zone services."""
        self.hass = hass
        self.system = sprinkler_system
    
    async def start_zone(self, zone_id: int, duration: int, schedule_id: Optional[str] = None) -> bool:
        """Start watering a specific zone."""
        _LOGGER.info("Starting zone %d for %d minutes", zone_id, duration)
        
        result = self.system.start_zone(zone_id, duration, schedule_id)
        
        if result:
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return result
    
    async def stop_zone(self, zone_id: int) -> bool:
        """Stop watering a specific zone."""
        _LOGGER.info("Stopping zone %d", zone_id)
        
        result = self.system.stop_zone(zone_id)
        
        if result:
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return result
    
    async def stop_all_zones(self) -> bool:
        """Stop watering all zones."""
        _LOGGER.info("Stopping all zones")
        
        result = self.system.stop_all_zones()
        
        if result:
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return result
    
    async def update_zone_settings(self, zone_id: int, **settings) -> bool:
        """Update settings for a specific zone."""
        if zone_id not in self.system.zones:
            _LOGGER.error("Zone %d does not exist", zone_id)
            return False
        
        zone = self.system.zones[zone_id]
        
        # Update zone settings
        if "name" in settings:
            zone.settings.name = settings["name"]
        if "duration" in settings:
            zone.settings.duration = settings["duration"]
        if "enabled" in settings:
            zone.settings.enabled = settings["enabled"]
        if "flow_rate" in settings:
            zone.settings.flow_rate = settings["flow_rate"]
        if "area_sqft" in settings:
            zone.settings.area_sqft = settings["area_sqft"]
        
        _LOGGER.info("Updated zone %d settings: %s", zone_id, settings)
        
        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True
    
    async def _trigger_sensor_update(self):
        """Trigger update of the sensor entity."""
        # This will be implemented when sensor is fully set up
        # For now, just update the system state
        self.system.update_system_state()