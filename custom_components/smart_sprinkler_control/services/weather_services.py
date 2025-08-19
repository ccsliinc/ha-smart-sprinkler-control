"""Weather integration services for Smart Sprinkler Control."""

import logging
from typing import Optional, Dict, Any
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import Entity
from ..models.zone import SprinklerSystem

_LOGGER = logging.getLogger(__name__)


class WeatherServices:
    """Service layer for weather-based sprinkler control."""
    
    def __init__(self, hass: HomeAssistant, sprinkler_system: SprinklerSystem):
        """Initialize weather services."""
        self.hass = hass
        self.system = sprinkler_system
    
    async def check_weather_conditions(self) -> Dict[str, Any]:
        """Check current weather conditions."""
        weather_data = {
            "rain_detected": False,
            "rain_amount_24h": 0.0,
            "temperature": None,
            "humidity": None,
            "conditions": "unknown",
            "should_skip_watering": False,
            "reason": None
        }
        
        # Check weather entity if configured
        if self.system.weather_entity_id:
            weather_entity = self.hass.states.get(self.system.weather_entity_id)
            if weather_entity:
                weather_data.update(await self._parse_weather_entity(weather_entity))
        
        # Check rain sensor if configured
        if self.system.rain_sensor_entity_id:
            rain_sensor = self.hass.states.get(self.system.rain_sensor_entity_id)
            if rain_sensor:
                weather_data.update(await self._parse_rain_sensor(rain_sensor))
        
        # Determine if watering should be skipped
        weather_data["should_skip_watering"] = await self._should_skip_watering(weather_data)
        
        return weather_data
    
    async def _parse_weather_entity(self, weather_entity) -> Dict[str, Any]:
        """Parse weather entity data."""
        data = {}
        
        try:
            # Get basic weather information
            if weather_entity.state:
                data["conditions"] = weather_entity.state
            
            # Get attributes
            attrs = weather_entity.attributes
            if "temperature" in attrs:
                data["temperature"] = attrs["temperature"]
            if "humidity" in attrs:
                data["humidity"] = attrs["humidity"]
            
            # Check for precipitation
            if "precipitation" in attrs:
                data["rain_amount_24h"] = float(attrs["precipitation"])
                data["rain_detected"] = data["rain_amount_24h"] > 0.0
            
            # Check for current conditions that indicate rain
            rain_conditions = ["rainy", "pouring", "snowy", "storm", "thunderstorm"]
            if data.get("conditions", "").lower() in rain_conditions:
                data["rain_detected"] = True
        
        except (ValueError, TypeError) as e:
            _LOGGER.warning("Error parsing weather entity: %s", e)
        
        return data
    
    async def _parse_rain_sensor(self, rain_sensor) -> Dict[str, Any]:
        """Parse rain sensor data."""
        data = {}
        
        try:
            # Rain sensor is typically binary (on/off)
            if rain_sensor.state in ["on", "wet", "true", "1"]:
                data["rain_detected"] = True
                data["reason"] = "Rain sensor activated"
            elif rain_sensor.state in ["off", "dry", "false", "0"]:
                data["rain_detected"] = False
        
        except (ValueError, TypeError) as e:
            _LOGGER.warning("Error parsing rain sensor: %s", e)
        
        return data
    
    async def _should_skip_watering(self, weather_data: Dict[str, Any]) -> bool:
        """Determine if watering should be skipped based on weather."""
        # Check if rain delay is already active
        if self.system.rain_delay_active:
            weather_data["reason"] = "Rain delay is active"
            return True
        
        # Check rain detection
        if weather_data.get("rain_detected", False):
            weather_data["reason"] = "Rain detected"
            return True
        
        # Check precipitation amount
        rain_amount = weather_data.get("rain_amount_24h", 0.0)
        if rain_amount > 0.1:  # Default threshold
            weather_data["reason"] = f"Recent precipitation: {rain_amount} inches"
            return True
        
        # Check for rainy conditions
        conditions = weather_data.get("conditions", "").lower()
        if any(condition in conditions for condition in ["rain", "storm", "shower"]):
            weather_data["reason"] = f"Weather conditions: {conditions}"
            return True
        
        return False
    
    async def auto_enable_rain_delay(self, hours: int = 24) -> bool:
        """Automatically enable rain delay based on weather conditions."""
        weather_data = await self.check_weather_conditions()
        
        if weather_data["should_skip_watering"]:
            _LOGGER.info("Auto-enabling rain delay due to weather: %s", weather_data["reason"])
            self.system.enable_rain_delay(hours)
            
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
            return True
        
        return False
    
    async def check_and_disable_rain_delay(self) -> bool:
        """Check weather and disable rain delay if conditions are clear."""
        if not self.system.rain_delay_active:
            return False
        
        weather_data = await self.check_weather_conditions()
        
        # Only disable if weather is clear
        if not weather_data["should_skip_watering"]:
            _LOGGER.info("Weather is clear, disabling rain delay")
            self.system.disable_rain_delay()
            
            # Trigger sensor update
            self.hass.async_create_task(self._trigger_sensor_update())
            return True
        
        return False
    
    async def adjust_watering_duration(self, base_duration: int) -> int:
        """Adjust watering duration based on weather conditions."""
        weather_data = await self.check_weather_conditions()
        
        adjusted_duration = base_duration
        
        # Reduce duration based on recent rain
        rain_amount = weather_data.get("rain_amount_24h", 0.0)
        if rain_amount > 0.05:  # Small amount of rain
            reduction = min(50, int(rain_amount * 100))  # Max 50% reduction
            adjusted_duration = max(5, int(base_duration * (100 - reduction) / 100))
            _LOGGER.info("Reduced watering duration by %d%% due to recent rain", reduction)
        
        # Increase duration for hot, dry conditions
        temperature = weather_data.get("temperature")
        humidity = weather_data.get("humidity")
        
        if temperature and temperature > 85:  # Hot weather
            if humidity and humidity < 30:  # Low humidity
                increase = min(50, int((temperature - 85) * 2))  # Max 50% increase
                adjusted_duration = int(base_duration * (100 + increase) / 100)
                _LOGGER.info("Increased watering duration by %d%% due to hot, dry conditions", increase)
        
        return adjusted_duration
    
    async def _trigger_sensor_update(self):
        """Trigger update of the sensor entity."""
        # This will be implemented when sensor is fully set up
        # For now, just update the system state
        self.system.update_system_state()