"""Schedule management services for Smart Sprinkler Control."""

import logging
from datetime import datetime, time
from typing import List, Optional, Dict, Any
from homeassistant.core import HomeAssistant
from ..models.zone import SprinklerSystem, SprinklerSchedule

_LOGGER = logging.getLogger(__name__)


class ScheduleServices:
    """Service layer for sprinkler schedule management."""
    
    def __init__(self, hass: HomeAssistant, sprinkler_system: SprinklerSystem):
        """Initialize schedule services."""
        self.hass = hass
        self.system = sprinkler_system
    
    async def create_schedule(
        self,
        schedule_id: str,
        name: str,
        zone_ids: List[int],
        start_time: time,
        days_of_week: List[int],
        zone_durations: Optional[Dict[int, int]] = None,
        enabled: bool = True,
        skip_if_rain: bool = True,
        rain_threshold: float = 0.1
    ) -> bool:
        """Create a new watering schedule."""
        _LOGGER.info("Creating schedule: %s", name)
        
        schedule = SprinklerSchedule(
            schedule_id=schedule_id,
            name=name,
            zone_ids=zone_ids,
            start_time=start_time,
            days_of_week=days_of_week,
            enabled=enabled,
            zone_durations=zone_durations or {},
            skip_if_rain=skip_if_rain,
            rain_threshold=rain_threshold
        )
        
        result = self.system.create_schedule(schedule)
        
        if result:
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return result
    
    async def delete_schedule(self, schedule_id: str) -> bool:
        """Delete a watering schedule."""
        _LOGGER.info("Deleting schedule: %s", schedule_id)
        
        result = self.system.delete_schedule(schedule_id)
        
        if result:
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return result
    
    async def enable_schedule(self, schedule_id: str) -> bool:
        """Enable a schedule."""
        if schedule_id not in self.system.schedules:
            _LOGGER.error("Schedule %s does not exist", schedule_id)
            return False
        
        self.system.schedules[schedule_id].enabled = True
        _LOGGER.info("Enabled schedule: %s", schedule_id)
        
        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True
    
    async def disable_schedule(self, schedule_id: str) -> bool:
        """Disable a schedule."""
        if schedule_id not in self.system.schedules:
            _LOGGER.error("Schedule %s does not exist", schedule_id)
            return False
        
        # Stop any zones running from this schedule
        for zone in self.system.zones.values():
            if zone.current_schedule_id == schedule_id:
                zone.stop_watering()
        
        self.system.schedules[schedule_id].enabled = False
        _LOGGER.info("Disabled schedule: %s", schedule_id)
        
        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True
    
    async def update_schedule(self, schedule_id: str, **updates) -> bool:
        """Update an existing schedule."""
        if schedule_id not in self.system.schedules:
            _LOGGER.error("Schedule %s does not exist", schedule_id)
            return False
        
        schedule = self.system.schedules[schedule_id]
        
        # Update schedule properties
        if "name" in updates:
            schedule.name = updates["name"]
        if "zone_ids" in updates:
            schedule.zone_ids = updates["zone_ids"]
        if "start_time" in updates:
            schedule.start_time = updates["start_time"]
        if "days_of_week" in updates:
            schedule.days_of_week = updates["days_of_week"]
        if "zone_durations" in updates:
            schedule.zone_durations = updates["zone_durations"]
        if "enabled" in updates:
            schedule.enabled = updates["enabled"]
        if "skip_if_rain" in updates:
            schedule.skip_if_rain = updates["skip_if_rain"]
        if "rain_threshold" in updates:
            schedule.rain_threshold = updates["rain_threshold"]
        
        _LOGGER.info("Updated schedule %s: %s", schedule_id, updates)
        
        # Trigger sensor update
        self.hass.async_create_task(self._trigger_sensor_update())
        return True
    
    async def run_schedule_now(self, schedule_id: str) -> bool:
        """Run a schedule immediately (manual trigger)."""
        if schedule_id not in self.system.schedules:
            _LOGGER.error("Schedule %s does not exist", schedule_id)
            return False
        
        schedule = self.system.schedules[schedule_id]
        
        if not schedule.enabled:
            _LOGGER.warning("Cannot run disabled schedule: %s", schedule_id)
            return False
        
        if self.system.rain_delay_active:
            _LOGGER.warning("Cannot run schedule during rain delay: %s", schedule_id)
            return False
        
        # Start zones in sequence
        success = True
        for zone_id in schedule.zone_ids:
            if zone_id in self.system.zones:
                duration = schedule.get_zone_duration(zone_id)
                if not self.system.start_zone(zone_id, duration, schedule_id):
                    success = False
                    _LOGGER.warning("Failed to start zone %d for schedule %s", zone_id, schedule_id)
        
        if success:
            schedule.last_run_date = datetime.now()
            _LOGGER.info("Started schedule: %s", schedule.name)
            
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
        
        return success
    
    async def get_schedule_status(self) -> Dict[str, Any]:
        """Get status of all schedules."""
        return {
            "total_schedules": len(self.system.schedules),
            "enabled_schedules": len([s for s in self.system.schedules.values() if s.enabled]),
            "schedules": {
                schedule_id: {
                    "name": schedule.name,
                    "enabled": schedule.enabled,
                    "zone_ids": schedule.zone_ids,
                    "zone_count": len(schedule.zone_ids),
                    "start_time": schedule.start_time.strftime("%H:%M"),
                    "days_of_week": schedule.days_of_week,
                    "is_active_today": schedule.is_active_today(),
                    "should_run_now": schedule.should_run_now(),
                    "last_run_date": schedule.last_run_date.isoformat() if schedule.last_run_date else None,
                    "skip_if_rain": schedule.skip_if_rain,
                    "rain_threshold": schedule.rain_threshold,
                }
                for schedule_id, schedule in self.system.schedules.items()
            }
        }
    
    async def _trigger_sensor_update(self):
        """Trigger update of the sensor entity."""
        # This will be implemented when sensor is fully set up
        # For now, just update the system state
        self.system.update_system_state()