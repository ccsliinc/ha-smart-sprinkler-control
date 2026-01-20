"""Smart Sprinkler Control Integration."""

import logging
from datetime import timedelta
from typing import Any, Dict

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DOMAIN,
    PLATFORMS,
    VERSION,
    ISSUE_URL,
    SERVICE_START_ZONE,
    SERVICE_STOP_ZONE,
    SERVICE_STOP_ALL_ZONES,
    SERVICE_CREATE_SCHEDULE,
    SERVICE_DELETE_SCHEDULE,
    SERVICE_UPDATE_ZONE_SETTINGS,
    SERVICE_UPDATE_SYSTEM_SETTINGS,
    ATTR_ZONE_ID,
    ATTR_DURATION,
    ATTR_SCHEDULE_ID,
    ATTR_ZONE_COUNT,
    CONF_SYSTEM_NAME,
    CONF_ZONE_COUNT,
    CONF_ZONE_NAMES,
    CONF_WEATHER_ENTITY,
    CONF_RAIN_SENSOR_ENTITY,
    CONF_ZONE_SWITCHES,
)
from .models.zone import SprinklerSystem, SprinklerSchedule, ZoneSettings
from .api.http import async_register_http_views, async_unregister_http_views
from .frontend.panel import async_register_panel, async_unregister_panel

_LOGGER = logging.getLogger(__name__)

# Storage version for persistent data
STORAGE_VERSION = 1

# Service schemas
START_ZONE_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
    vol.Optional(ATTR_DURATION, default=15): vol.All(
        vol.Coerce(int), vol.Range(min=1, max=120)
    ),
    vol.Optional(ATTR_SCHEDULE_ID): cv.string,
})

STOP_ZONE_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
})

STOP_ALL_ZONES_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
})

ENABLE_RAIN_DELAY_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Optional("hours", default=24): vol.All(
        vol.Coerce(int), vol.Range(min=1, max=168)
    ),
})

DISABLE_RAIN_DELAY_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
})

UPDATE_ZONE_SETTINGS_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
    vol.Optional("name"): cv.string,
    vol.Optional("duration"): vol.All(vol.Coerce(int), vol.Range(min=1, max=120)),
    vol.Optional("enabled"): cv.boolean,
    vol.Optional("flow_rate"): vol.Coerce(float),
    vol.Optional("area_sqft"): vol.Coerce(float),
    vol.Optional("switch_entity"): cv.entity_id,
})

CREATE_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Required(ATTR_SCHEDULE_ID): cv.string,
    vol.Required("name"): cv.string,
    vol.Required("zone_ids"): vol.All(cv.ensure_list, [vol.Coerce(int)]),
    vol.Required("start_time"): cv.string,  # HH:MM format
    vol.Required("days_of_week"): vol.All(cv.ensure_list, [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))]),
    vol.Optional("zone_durations"): dict,
    vol.Optional("enabled", default=True): cv.boolean,
    vol.Optional("skip_if_rain", default=True): cv.boolean,
    vol.Optional("rain_threshold", default=0.1): vol.Coerce(float),
})

DELETE_SCHEDULE_SCHEMA = vol.Schema({
    vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    vol.Required(ATTR_SCHEDULE_ID): cv.string,
})

# YAML Configuration schema for autoload
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema({
            vol.Required(CONF_SYSTEM_NAME): cv.string,
            vol.Required(CONF_ZONE_COUNT): vol.All(vol.Coerce(int), vol.Range(min=1, max=32)),
            vol.Optional(CONF_ZONE_NAMES, default={}): {vol.Coerce(int): cv.string},
            vol.Optional(CONF_ZONE_SWITCHES, default={}): {vol.Coerce(int): cv.entity_id},
            vol.Optional(CONF_WEATHER_ENTITY): cv.entity_id,
            vol.Optional(CONF_RAIN_SENSOR_ENTITY): cv.entity_id,
        })
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up Smart Sprinkler Control from configuration.yaml."""
    hass.data.setdefault(DOMAIN, {})

    # Check if we have YAML configuration
    if DOMAIN not in config:
        return True

    yaml_config = config[DOMAIN]
    _LOGGER.info("Found YAML configuration for Smart Sprinkler Control")

    # Check if a config entry already exists
    existing_entries = hass.config_entries.async_entries(DOMAIN)
    if existing_entries:
        _LOGGER.debug("Config entry already exists, skipping YAML import")
        return True

    # Create a config entry from YAML configuration
    hass.async_create_task(
        hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": "import"},
            data={
                CONF_SYSTEM_NAME: yaml_config.get(CONF_SYSTEM_NAME),
                CONF_ZONE_COUNT: yaml_config.get(CONF_ZONE_COUNT),
                CONF_ZONE_NAMES: yaml_config.get(CONF_ZONE_NAMES, {}),
                CONF_ZONE_SWITCHES: yaml_config.get(CONF_ZONE_SWITCHES, {}),
                CONF_WEATHER_ENTITY: yaml_config.get(CONF_WEATHER_ENTITY),
                CONF_RAIN_SENSOR_ENTITY: yaml_config.get(CONF_RAIN_SENSOR_ENTITY),
            },
        )
    )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Smart Sprinkler Control from a config entry."""
    _LOGGER.info(
        "Smart Sprinkler Control Version %s starting, report issues to: %s",
        VERSION,
        ISSUE_URL,
    )

    hass.data.setdefault(DOMAIN, {})

    # Get configuration from entry
    system_name = entry.data.get(CONF_SYSTEM_NAME, "Smart Sprinkler System")
    zone_count = entry.data.get(CONF_ZONE_COUNT, 6)
    zone_names = entry.data.get(CONF_ZONE_NAMES, {})
    zone_switches = entry.data.get(CONF_ZONE_SWITCHES, {})
    weather_entity = entry.data.get(CONF_WEATHER_ENTITY)
    rain_sensor_entity = entry.data.get(CONF_RAIN_SENSOR_ENTITY)

    # Create storage for persistent data
    storage_key = f"smart_sprinkler_control_{entry.entry_id}"
    store = Store(hass, STORAGE_VERSION, storage_key)

    # Load existing data if available
    stored_data = await store.async_load() or {}

    # Create the sprinkler system object
    entity_id = f"sensor.{system_name.lower().replace(' ', '_')}"
    system = SprinklerSystem(
        system_name=system_name,
        entity_id=entity_id,
        zone_count=zone_count,
    )

    # Configure zones with names and switch entities from config
    for zone_id, zone in system.zones.items():
        zone_id_str = str(zone_id)
        # Set zone name
        if zone_id_str in zone_names:
            zone.settings.name = zone_names[zone_id_str]
        elif zone_id in zone_names:
            zone.settings.name = zone_names[zone_id]
        # Set switch entity
        if zone_id_str in zone_switches:
            zone.settings.switch_entity = zone_switches[zone_id_str]
        elif zone_id in zone_switches:
            zone.settings.switch_entity = zone_switches[zone_id]

    # Configure weather integration
    system.weather_entity_id = weather_entity
    system.rain_sensor_entity_id = rain_sensor_entity

    # Restore data from storage
    if stored_data:
        _LOGGER.info("Restoring saved data for %s", system_name)

        # Restore zone settings
        if stored_data.get("zones"):
            for zone_id_str, zone_data in stored_data["zones"].items():
                zone_id = int(zone_id_str)
                if zone_id in system.zones:
                    zone = system.zones[zone_id]
                    if zone_data.get("settings"):
                        settings = zone_data["settings"]
                        zone.settings.name = settings.get("name", zone.settings.name)
                        zone.settings.duration = settings.get("duration", 15)
                        zone.settings.enabled = settings.get("enabled", True)
                        zone.settings.flow_rate = settings.get("flow_rate")
                        zone.settings.area_sqft = settings.get("area_sqft")
                        zone.settings.switch_entity = settings.get("switch_entity", zone.settings.switch_entity)
                    # Restore statistics
                    zone.total_runtime_today = zone_data.get("total_runtime_today", 0)
                    zone.total_water_used_today = zone_data.get("total_water_used_today", 0.0)

        # Restore schedules
        if stored_data.get("schedules"):
            from datetime import time as time_type
            for schedule_id, schedule_data in stored_data["schedules"].items():
                try:
                    start_time_str = schedule_data.get("start_time", "06:00")
                    hour, minute = map(int, start_time_str.split(":"))
                    schedule = SprinklerSchedule(
                        schedule_id=schedule_id,
                        name=schedule_data.get("name", schedule_id),
                        zone_ids=schedule_data.get("zone_ids", []),
                        start_time=time_type(hour, minute),
                        days_of_week=schedule_data.get("days_of_week", []),
                        enabled=schedule_data.get("enabled", True),
                        zone_durations=schedule_data.get("zone_durations", {}),
                        skip_if_rain=schedule_data.get("skip_if_rain", True),
                        rain_threshold=schedule_data.get("rain_threshold", 0.1),
                    )
                    system.schedules[schedule_id] = schedule
                    _LOGGER.debug("Restored schedule: %s", schedule_id)
                except Exception as e:
                    _LOGGER.warning("Failed to restore schedule %s: %s", schedule_id, e)

        # Restore system settings
        if stored_data.get("rain_delay_active"):
            system.rain_delay_active = stored_data["rain_delay_active"]
        if stored_data.get("is_enabled") is not None:
            system.is_enabled = stored_data["is_enabled"]

    # Create coordinator for data updates
    coordinator = SprinklerDataUpdateCoordinator(hass, entry, system)

    # Store data in hass.data for access by services and sensor
    hass.data[DOMAIN][entry.entry_id] = {
        "system": system,
        "coordinator": coordinator,
        "store": store,
        "entry": entry,
    }

    # Also store by entity_id for service lookups
    hass.data[DOMAIN][entity_id] = system

    # Register services
    await _register_services(hass)

    # Initial coordinator refresh
    await coordinator.async_config_entry_first_refresh()

    # Set up platforms (sensor)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register HTTP views and panel (only for first entry)
    if len([e for e in hass.data[DOMAIN].values() if isinstance(e, dict) and "system" in e]) == 1:
        await async_register_http_views(hass)
        await async_register_panel(hass)

    _LOGGER.info("Smart Sprinkler Control setup complete for: %s", system_name)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Save data before unloading
    entry_data = hass.data[DOMAIN].get(entry.entry_id, {})
    if entry_data:
        system = entry_data.get("system")
        store = entry_data.get("store")
        if system and store:
            await _save_system_data(system, store)

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Remove from hass.data
        if entry.entry_id in hass.data[DOMAIN]:
            entry_data = hass.data[DOMAIN].pop(entry.entry_id)
            system = entry_data.get("system")
            if system:
                hass.data[DOMAIN].pop(system.entity_id, None)

        # Remove services and panel only if this is the last instance
        if not any(
            isinstance(v, dict) and "system" in v
            for v in hass.data[DOMAIN].values()
        ):
            _LOGGER.info("Removing Smart Sprinkler Control services")
            for service in [
                SERVICE_START_ZONE,
                SERVICE_STOP_ZONE,
                SERVICE_STOP_ALL_ZONES,
                "enable_rain_delay",
                "disable_rain_delay",
                SERVICE_UPDATE_ZONE_SETTINGS,
                SERVICE_CREATE_SCHEDULE,
                SERVICE_DELETE_SCHEDULE,
            ]:
                hass.services.async_remove(DOMAIN, service)

            # Unregister HTTP views and panel
            await async_unregister_http_views(hass)
            await async_unregister_panel(hass)

    return unload_ok


async def _save_system_data(system: SprinklerSystem, store: Store) -> None:
    """Save system data to persistent storage."""
    try:
        data = {
            "system_name": system.system_name,
            "is_enabled": system.is_enabled,
            "rain_delay_active": system.rain_delay_active,
            "zones": {},
            "schedules": {},
        }

        # Save zone data
        for zone_id, zone in system.zones.items():
            data["zones"][str(zone_id)] = {
                "settings": {
                    "name": zone.settings.name,
                    "duration": zone.settings.duration,
                    "enabled": zone.settings.enabled,
                    "flow_rate": zone.settings.flow_rate,
                    "area_sqft": zone.settings.area_sqft,
                    "switch_entity": zone.settings.switch_entity,
                },
                "total_runtime_today": zone.total_runtime_today,
                "total_water_used_today": zone.total_water_used_today,
            }

        # Save schedules
        for schedule_id, schedule in system.schedules.items():
            data["schedules"][schedule_id] = {
                "name": schedule.name,
                "zone_ids": schedule.zone_ids,
                "start_time": schedule.start_time.strftime("%H:%M"),
                "days_of_week": schedule.days_of_week,
                "enabled": schedule.enabled,
                "zone_durations": schedule.zone_durations,
                "skip_if_rain": schedule.skip_if_rain,
                "rain_threshold": schedule.rain_threshold,
            }

        await store.async_save(data)
        _LOGGER.debug("Saved system data for %s", system.system_name)

    except Exception as e:
        _LOGGER.error("Failed to save system data: %s", e)


def _get_system_from_entity_id(hass: HomeAssistant, entity_id: str) -> SprinklerSystem:
    """Get the sprinkler system from an entity ID."""
    # Try direct lookup by entity_id
    if entity_id in hass.data[DOMAIN]:
        return hass.data[DOMAIN][entity_id]

    # Search through entries
    for entry_id, entry_data in hass.data[DOMAIN].items():
        if isinstance(entry_data, dict) and "system" in entry_data:
            system = entry_data["system"]
            if system.entity_id == entity_id:
                return system

    return None


async def _register_services(hass: HomeAssistant) -> None:
    """Register Smart Sprinkler Control services."""

    async def handle_start_zone(call: ServiceCall) -> None:
        """Handle start_zone service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]
        duration = call.data.get(ATTR_DURATION, 15)
        schedule_id = call.data.get(ATTR_SCHEDULE_ID)

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Starting zone %d for %d minutes", zone_id, duration)

        # Start the zone in the system
        result = system.start_zone(zone_id, duration, schedule_id)

        if result:
            # Control the actual hardware switch
            zone = system.zones.get(zone_id)
            if zone and zone.settings.switch_entity:
                try:
                    await hass.services.async_call(
                        "switch",
                        "turn_on",
                        {"entity_id": zone.settings.switch_entity},
                        blocking=True,
                    )
                    _LOGGER.info(
                        "Zone %d started: turned on %s",
                        zone_id,
                        zone.settings.switch_entity,
                    )
                except Exception as e:
                    _LOGGER.error(
                        "Failed to turn on switch %s for zone %d: %s",
                        zone.settings.switch_entity,
                        zone_id,
                        e,
                    )
            else:
                _LOGGER.warning(
                    "Zone %d has no switch entity configured",
                    zone_id,
                )
        else:
            _LOGGER.warning("Failed to start zone %d", zone_id)

    async def handle_stop_zone(call: ServiceCall) -> None:
        """Handle stop_zone service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Stopping zone %d", zone_id)

        # Turn off the hardware switch first
        zone = system.zones.get(zone_id)
        if zone and zone.settings.switch_entity:
            try:
                await hass.services.async_call(
                    "switch",
                    "turn_off",
                    {"entity_id": zone.settings.switch_entity},
                    blocking=True,
                )
                _LOGGER.info(
                    "Zone %d stopped: turned off %s",
                    zone_id,
                    zone.settings.switch_entity,
                )
            except Exception as e:
                _LOGGER.error(
                    "Failed to turn off switch %s for zone %d: %s",
                    zone.settings.switch_entity,
                    zone_id,
                    e,
                )

        result = system.stop_zone(zone_id)
        if result:
            _LOGGER.info("Zone %d stopped successfully", zone_id)

    async def handle_stop_all_zones(call: ServiceCall) -> None:
        """Handle stop_all_zones service call."""
        entity_id = call.data[ATTR_ENTITY_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Stopping all zones")

        # Turn off all hardware switches
        for zone_id, zone in system.zones.items():
            if zone.settings.switch_entity:
                try:
                    await hass.services.async_call(
                        "switch",
                        "turn_off",
                        {"entity_id": zone.settings.switch_entity},
                        blocking=True,
                    )
                    _LOGGER.debug(
                        "Turned off switch %s for zone %d",
                        zone.settings.switch_entity,
                        zone_id,
                    )
                except Exception as e:
                    _LOGGER.error(
                        "Failed to turn off switch %s for zone %d: %s",
                        zone.settings.switch_entity,
                        zone_id,
                        e,
                    )

        system.stop_all_zones()

    async def handle_enable_rain_delay(call: ServiceCall) -> None:
        """Handle enable_rain_delay service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        hours = call.data.get("hours", 24)

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Enabling rain delay for %d hours", hours)
        system.enable_rain_delay(hours)

    async def handle_disable_rain_delay(call: ServiceCall) -> None:
        """Handle disable_rain_delay service call."""
        entity_id = call.data[ATTR_ENTITY_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Disabling rain delay")
        system.disable_rain_delay()

    async def handle_update_zone_settings(call: ServiceCall) -> None:
        """Handle update_zone_settings service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        if zone_id not in system.zones:
            _LOGGER.error("Zone %d not found", zone_id)
            return

        zone = system.zones[zone_id]

        if "name" in call.data:
            zone.settings.name = call.data["name"]
        if "duration" in call.data:
            zone.settings.duration = call.data["duration"]
        if "enabled" in call.data:
            zone.settings.enabled = call.data["enabled"]
        if "flow_rate" in call.data:
            zone.settings.flow_rate = call.data["flow_rate"]
        if "area_sqft" in call.data:
            zone.settings.area_sqft = call.data["area_sqft"]

        _LOGGER.info("Updated zone %d settings", zone_id)

    async def handle_create_schedule(call: ServiceCall) -> None:
        """Handle create_schedule service call."""
        from datetime import time as time_type

        entity_id = call.data[ATTR_ENTITY_ID]
        schedule_id = call.data[ATTR_SCHEDULE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        # Parse start time
        start_time_str = call.data["start_time"]
        hour, minute = map(int, start_time_str.split(":"))

        schedule = SprinklerSchedule(
            schedule_id=schedule_id,
            name=call.data["name"],
            zone_ids=call.data["zone_ids"],
            start_time=time_type(hour, minute),
            days_of_week=call.data["days_of_week"],
            enabled=call.data.get("enabled", True),
            zone_durations=call.data.get("zone_durations", {}),
            skip_if_rain=call.data.get("skip_if_rain", True),
            rain_threshold=call.data.get("rain_threshold", 0.1),
        )

        result = system.create_schedule(schedule)
        if result:
            _LOGGER.info("Created schedule: %s", schedule_id)
        else:
            _LOGGER.warning("Failed to create schedule: %s", schedule_id)

    async def handle_delete_schedule(call: ServiceCall) -> None:
        """Handle delete_schedule service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        schedule_id = call.data[ATTR_SCHEDULE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        result = system.delete_schedule(schedule_id)
        if result:
            _LOGGER.info("Deleted schedule: %s", schedule_id)
        else:
            _LOGGER.warning("Failed to delete schedule: %s", schedule_id)

    # Register all services
    hass.services.async_register(
        DOMAIN, SERVICE_START_ZONE, handle_start_zone, schema=START_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_ZONE, handle_stop_zone, schema=STOP_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_ALL_ZONES, handle_stop_all_zones, schema=STOP_ALL_ZONES_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "enable_rain_delay", handle_enable_rain_delay, schema=ENABLE_RAIN_DELAY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, "disable_rain_delay", handle_disable_rain_delay, schema=DISABLE_RAIN_DELAY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_ZONE_SETTINGS, handle_update_zone_settings, schema=UPDATE_ZONE_SETTINGS_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_SCHEDULE, handle_create_schedule, schema=CREATE_SCHEDULE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_SCHEDULE, handle_delete_schedule, schema=DELETE_SCHEDULE_SCHEMA
    )

    _LOGGER.info("Registered Smart Sprinkler Control services")


class SprinklerDataUpdateCoordinator(DataUpdateCoordinator):
    """Coordinator to manage sprinkler system updates."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, system: SprinklerSystem
    ) -> None:
        """Initialize the coordinator."""
        self.system = system
        self.entry = entry

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=30),
        )

    async def _async_update_data(self) -> Dict[str, Any]:
        """Update data - called every 30 seconds."""
        try:
            # Update system state (timers, rain delay expiry, etc.)
            self.system.update_system_state()

            # Check schedules that should run now
            from datetime import datetime
            now = datetime.now()

            for schedule in self.system.schedules.values():
                if schedule.enabled and schedule.should_run_now():
                    # Check if we haven't already run today
                    if not schedule.last_run_date or schedule.last_run_date.date() != now.date():
                        # Check rain conditions
                        should_skip = False
                        if schedule.skip_if_rain and self.system.rain_delay_active:
                            should_skip = True
                            _LOGGER.info(
                                "Skipping schedule %s due to rain delay",
                                schedule.name
                            )

                        if not should_skip:
                            _LOGGER.info("Running schedule: %s", schedule.name)
                            # Run each zone in the schedule
                            for zone_id in schedule.zone_ids:
                                duration = schedule.get_zone_duration(zone_id)
                                self.system.start_zone(zone_id, duration, schedule.schedule_id)
                            schedule.last_run_date = now

            # Save data periodically
            entry_data = self.hass.data[DOMAIN].get(self.entry.entry_id, {})
            store = entry_data.get("store")
            if store:
                await _save_system_data(self.system, store)

            return {
                "state": self.system.get_overall_state(),
                "active_zones": len(self.system.get_active_zones()),
                "rain_delay": self.system.rain_delay_active,
                "last_updated": now.isoformat(),
            }

        except Exception as exception:
            _LOGGER.error("Error updating sprinkler data: %s", exception)
            raise UpdateFailed(f"Error updating sprinkler data: {exception}") from exception
