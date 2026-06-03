"""Constants for Smart Sprinkler Control."""

import logging

DOMAIN = "smart_sprinkler_control"
VERSION = "2025.1.4"
ISSUE_URL = "https://github.com/ccsliinc/ha-smart-sprinkler-control"
PLATFORMS = ["sensor"]

# hass.data attributes
COORDINATOR = "coordinator"
SPRINKLER_SYSTEMS = "sprinkler_systems"
UNSUB_LISTENERS = "unsub_listeners"

# Events - UPDATE THESE FOR YOUR DEVICE TYPE
EVENT_ZONE_CHANGED = f"{DOMAIN}_zone_changed"

# Event data constants for sprinkler zones
ATTR_ZONE_ID = "zone_id"
ATTR_ZONE_NAME = "zone_name"
ATTR_ACTION = "action"
ATTR_DURATION = "duration"  # Watering duration in minutes

# Attributes for sprinkler system
ATTR_ZONE_COUNT = "zone_count"
ATTR_SYSTEM_NAME = "system_name"
ATTR_SCHEDULE_ID = "schedule_id"  # If using scheduling
ATTR_START_TIME = "start_time"
ATTR_END_TIME = "end_time"
ATTR_DAYS_OF_WEEK = "days_of_week"
ATTR_ENABLED = "enabled"
ATTR_ENTITY_ID = "entity_id"

# Global settings attributes for smart sprinkler
ATTR_WEATHER_INTEGRATION = "weather_integration"
ATTR_RAIN_SENSOR = "rain_sensor"
ATTR_AUTO_ADJUST = "auto_adjust"  # Weather-based duration adjustment

# Configuration Properties for sprinkler system
CONF_SYSTEM_NAME = "system_name"
CONF_ZONE_COUNT = "zone_count"
CONF_ZONE_NAMES = "zone_names"
CONF_WEATHER_ENTITY = "weather_entity"
CONF_RAIN_SENSOR_ENTITY = "rain_sensor_entity"
CONF_ZONE_SWITCHES = "zone_switches"

# Defaults for sprinkler system
DEFAULT_ZONE_COUNT = 8  # Typical sprinkler zone count
DEFAULT_WATERING_DURATION = 15  # Default watering duration in minutes
DEFAULT_RAIN_THRESHOLD = 0.1  # Rain threshold to skip watering (inches)

# Services for sprinkler control
SERVICE_START_ZONE = "start_zone"
SERVICE_STOP_ZONE = "stop_zone"
SERVICE_STOP_ALL_ZONES = "stop_all_zones"
SERVICE_ADJUST_ZONE_TIME = "adjust_zone_time"
SERVICE_START_SCHEDULE = "start_schedule"  # Remove if not using scheduling
SERVICE_STOP_SCHEDULE = "stop_schedule"
SERVICE_CREATE_SCHEDULE = "create_schedule"
SERVICE_DELETE_SCHEDULE = "delete_schedule"
SERVICE_UPDATE_ZONE_SETTINGS = "update_zone_settings"
SERVICE_UPDATE_SYSTEM_SETTINGS = "update_system_settings"

# Zone States for sprinkler zones
ZONE_STATE_IDLE = "idle"
ZONE_STATE_WATERING = "watering"
ZONE_STATE_SCHEDULED = "scheduled"
ZONE_STATE_DISABLED = "disabled"
ZONE_STATE_ERROR = "error"

# Schedule Types for watering schedules
SCHEDULE_TYPE_DAILY = "daily"
SCHEDULE_TYPE_WEEKLY = "weekly"
SCHEDULE_TYPE_CUSTOM = "custom"

_LOGGER = logging.getLogger(__name__)
