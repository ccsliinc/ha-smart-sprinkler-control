"""Smart Sprinkler Control Integration."""

import asyncio
import logging
from datetime import timedelta
from typing import Any, Dict, Optional, cast

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api.http import async_register_http_views, async_unregister_http_views
from .const import (
    ATTR_DURATION,
    ATTR_SCHEDULE_ID,
    ATTR_ZONE_ID,
    CONF_RAIN_SENSOR_ENTITY,
    CONF_SYSTEM_NAME,
    CONF_WEATHER_ENTITY,
    CONF_ZONE_COUNT,
    CONF_ZONE_NAMES,
    CONF_ZONE_SWITCHES,
    DOMAIN,
    ISSUE_URL,
    PLATFORMS,
    SERVICE_ADJUST_ZONE_TIME,
    SERVICE_CREATE_SCHEDULE,
    SERVICE_DELETE_SCHEDULE,
    SERVICE_START_ZONE,
    SERVICE_STOP_ALL_ZONES,
    SERVICE_STOP_ZONE,
    SERVICE_UPDATE_ZONE_SETTINGS,
    VERSION,
)
from .frontend.panel import async_register_panel, async_unregister_panel
from .models.zone import SprinklerSchedule, SprinklerSystem

_LOGGER = logging.getLogger(__name__)

# Storage version for persistent data
STORAGE_VERSION = 1

# Service schemas
START_ZONE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
        vol.Optional(ATTR_DURATION, default=15): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=120)
        ),
        vol.Optional(ATTR_SCHEDULE_ID): cv.string,
    }
)

STOP_ZONE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
    }
)

STOP_ALL_ZONES_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    }
)

ADJUST_ZONE_TIME_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
        vol.Required(ATTR_DURATION): vol.All(
            vol.Coerce(int), vol.Range(min=5, max=180)
        ),
    }
)

ENABLE_RAIN_DELAY_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Optional("hours", default=24): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=168)
        ),
    }
)

DISABLE_RAIN_DELAY_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
    }
)

UPDATE_ZONE_SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_ZONE_ID): vol.Coerce(int),
        vol.Optional("name"): cv.string,
        vol.Optional("duration"): vol.All(vol.Coerce(int), vol.Range(min=1, max=120)),
        vol.Optional("enabled"): cv.boolean,
        vol.Optional("flow_rate"): vol.Coerce(float),
        vol.Optional("area_sqft"): vol.Coerce(float),
        vol.Optional("switch_entity"): cv.entity_id,
    }
)

CREATE_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_SCHEDULE_ID): cv.string,
        vol.Required("name"): cv.string,
        vol.Required("zone_ids"): vol.All(cv.ensure_list, [vol.Coerce(int)]),
        vol.Required("start_time"): cv.string,  # HH:MM format
        vol.Required("days_of_week"): vol.All(
            cv.ensure_list, [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))]
        ),
        vol.Optional("zone_durations"): dict,
        vol.Optional("enabled", default=True): cv.boolean,
        vol.Optional("skip_if_rain", default=True): cv.boolean,
        vol.Optional("rain_threshold", default=0.1): vol.Coerce(float),
    }
)

DELETE_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_SCHEDULE_ID): cv.string,
    }
)

RUN_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTITY_ID): cv.entity_id,
        vol.Required(ATTR_SCHEDULE_ID): cv.string,
    }
)

# YAML Configuration schema for autoload
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_SYSTEM_NAME): cv.string,
                vol.Required(CONF_ZONE_COUNT): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=32)
                ),
                vol.Optional(CONF_ZONE_NAMES, default={}): {vol.Coerce(int): cv.string},
                vol.Optional(CONF_ZONE_SWITCHES, default={}): {
                    vol.Coerce(int): cv.entity_id
                },
                vol.Optional(CONF_WEATHER_ENTITY): cv.entity_id,
                vol.Optional(CONF_RAIN_SENSOR_ENTITY): cv.entity_id,
            }
        )
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
    _LOGGER.debug(
        "Configuring zones. zone_names=%s, zone_switches=%s", zone_names, zone_switches
    )
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
            _LOGGER.debug(
                "Zone %d: set switch_entity to %s", zone_id, zone.settings.switch_entity
            )
        elif zone_id in zone_switches:
            zone.settings.switch_entity = zone_switches[zone_id]
            _LOGGER.debug(
                "Zone %d: set switch_entity to %s (int key)",
                zone_id,
                zone.settings.switch_entity,
            )
        else:
            _LOGGER.warning("Zone %d: no switch entity found in config", zone_id)

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
                        # Only restore switch_entity from storage if not
                        # already configured from YAML; YAML config takes
                        # precedence over stored data.
                        stored_switch = settings.get("switch_entity")
                        if stored_switch and not zone.settings.switch_entity:
                            zone.settings.switch_entity = stored_switch
                            _LOGGER.debug(
                                "Zone %d: restored switch_entity from storage: %s",
                                zone_id,
                                stored_switch,
                            )
                        elif zone.settings.switch_entity:
                            _LOGGER.debug(
                                "Zone %d: keeping YAML-configured switch_entity: %s",
                                zone_id,
                                zone.settings.switch_entity,
                            )
                    # Restore statistics
                    zone.total_runtime_today = zone_data.get("total_runtime_today", 0)
                    zone.total_water_used_today = zone_data.get(
                        "total_water_used_today", 0.0
                    )

        # Restore schedules
        if stored_data.get("schedules"):
            from datetime import datetime
            from datetime import time as time_type

            now = datetime.now()
            for schedule_id, schedule_data in stored_data["schedules"].items():
                try:
                    start_time_str = schedule_data.get("start_time", "06:00")
                    hour, minute = map(int, start_time_str.split(":"))
                    schedule_time = time_type(hour, minute)
                    # Convert zone_durations keys from strings to ints
                    # (JSON stringifies dict keys).
                    raw_durations = schedule_data.get("zone_durations", {})
                    zone_durations = {int(k): v for k, v in raw_durations.items()}

                    schedule = SprinklerSchedule(
                        schedule_id=schedule_id,
                        name=schedule_data.get("name", schedule_id),
                        zone_ids=schedule_data.get("zone_ids", []),
                        start_time=schedule_time,
                        days_of_week=schedule_data.get("days_of_week", []),
                        enabled=schedule_data.get("enabled", True),
                        zone_durations=zone_durations,
                        skip_if_rain=schedule_data.get("skip_if_rain", True),
                        rain_threshold=schedule_data.get("rain_threshold", 0.1),
                    )
                    # SAFETY: On restore, if start time already passed today,
                    # set last_run_date to prevent auto-run on startup
                    if now.time() >= schedule_time:
                        schedule.last_run_date = now
                        _LOGGER.debug(
                            "Schedule %s: marking as run today (startup safety)",
                            schedule_id,
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

    # Log final zone configuration after all setup
    _LOGGER.info("Final zone configuration for %s:", system_name)
    for zone_id, zone in system.zones.items():
        _LOGGER.info(
            "  Zone %d: name='%s', switch_entity=%s",
            zone_id,
            zone.settings.name,
            zone.settings.switch_entity or "NOT CONFIGURED",
        )

    # SAFETY FAILSAFE: On startup, turn off ALL sprinkler switches and reset states
    # This prevents stuck zones after power loss or unexpected reboot
    _LOGGER.info("Running startup safety check - turning off all zone switches")
    for zone_id, zone in system.zones.items():
        # Reset zone state to idle
        zone.state = "idle"
        zone.start_time = None
        zone.end_time = None
        zone.remaining_duration = 0
        zone.current_schedule_id = None

        # Turn off the physical switch if configured
        if zone.settings.switch_entity:
            try:
                await hass.services.async_call(
                    "switch",
                    "turn_off",
                    {"entity_id": zone.settings.switch_entity},
                    blocking=True,
                )
                _LOGGER.debug(
                    "Startup safety: turned off %s", zone.settings.switch_entity
                )
            except Exception as e:
                _LOGGER.warning(
                    "Startup safety: failed to turn off %s: %s",
                    zone.settings.switch_entity,
                    e,
                )
    _LOGGER.info("Startup safety check complete - all zones reset to idle")

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
    if (
        len(
            [
                e
                for e in hass.data[DOMAIN].values()
                if isinstance(e, dict) and "system" in e
            ]
        )
        == 1
    ):
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
            isinstance(v, dict) and "system" in v for v in hass.data[DOMAIN].values()
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

    return bool(unload_ok)


async def _save_system_data(system: SprinklerSystem, store: Store) -> None:
    """Save system data to persistent storage."""
    try:
        zones: Dict[str, Any] = {}
        schedules: Dict[str, Any] = {}

        # Save zone data
        for zone_id, zone in system.zones.items():
            zones[str(zone_id)] = {
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
            schedules[schedule_id] = {
                "name": schedule.name,
                "zone_ids": schedule.zone_ids,
                "start_time": schedule.start_time.strftime("%H:%M"),
                "days_of_week": schedule.days_of_week,
                "enabled": schedule.enabled,
                "zone_durations": schedule.zone_durations,
                "skip_if_rain": schedule.skip_if_rain,
                "rain_threshold": schedule.rain_threshold,
            }

        data = {
            "system_name": system.system_name,
            "is_enabled": system.is_enabled,
            "rain_delay_active": system.rain_delay_active,
            "zones": zones,
            "schedules": schedules,
        }

        await store.async_save(data)
        _LOGGER.debug("Saved system data for %s", system.system_name)

    except Exception as e:
        _LOGGER.error("Failed to save system data: %s", e)


def _get_system_from_entity_id(
    hass: HomeAssistant, entity_id: str
) -> Optional[SprinklerSystem]:
    """Get the sprinkler system from an entity ID, or None if not found."""
    _LOGGER.debug("Looking up system for entity_id: %s", entity_id)
    _LOGGER.debug(
        "Available keys in hass.data[DOMAIN]: %s", list(hass.data[DOMAIN].keys())
    )

    # Try direct lookup by entity_id
    if entity_id in hass.data[DOMAIN]:
        system = hass.data[DOMAIN][entity_id]
        if isinstance(system, SprinklerSystem):
            _LOGGER.debug("Found system directly by entity_id")
            _dump_zone_config(system)
            return system

    # Search through entries
    for entry_id, entry_data in hass.data[DOMAIN].items():
        if isinstance(entry_data, dict) and "system" in entry_data:
            system = cast(SprinklerSystem, entry_data["system"])
            if system.entity_id == entity_id:
                _LOGGER.debug("Found system via entry search (entry_id=%s)", entry_id)
                _dump_zone_config(system)
                return system

    # Fallback: resolve via the entity registry.
    #
    # The system is keyed internally by a name-derived slug
    # (f"sensor.{name}"), but Home Assistant may assign the summary sensor
    # a different actual entity_id (e.g. "..._2") when the base slug is
    # already taken in the registry. In that case the slug-based lookups
    # above miss. Map the *real* entity_id back to its owning config entry
    # via the registry so callers can always reference the sensor's true
    # entity_id.
    registry = er.async_get(hass)
    reg_entry = registry.async_get(entity_id)
    if reg_entry and reg_entry.config_entry_id:
        entry_data = hass.data[DOMAIN].get(reg_entry.config_entry_id)
        if isinstance(entry_data, dict) and "system" in entry_data:
            system = cast(SprinklerSystem, entry_data["system"])
            _LOGGER.debug(
                "Found system via entity registry (config_entry_id=%s)",
                reg_entry.config_entry_id,
            )
            _dump_zone_config(system)
            return system

    _LOGGER.error("System NOT FOUND for entity_id: %s", entity_id)
    return None


def _dump_zone_config(system: SprinklerSystem) -> None:
    """Debug helper to dump zone configuration."""
    for zone_id, zone in system.zones.items():
        _LOGGER.debug(
            "  Zone %d: name=%s, switch_entity=%s, state=%s",
            zone_id,
            zone.settings.name,
            zone.settings.switch_entity,
            zone.state,
        )


async def _trigger_state_update(hass: HomeAssistant, entity_id: str) -> None:
    """Trigger an immediate state update for the sensor.

    This notifies Home Assistant that the sensor state has changed,
    so the frontend can see the updated values immediately.
    Uses async_refresh() instead of async_request_refresh() to bypass debouncing.
    """
    # Find the coordinator for this entity
    for entry_id, entry_data in hass.data[DOMAIN].items():
        if isinstance(entry_data, dict) and "coordinator" in entry_data:
            system = entry_data.get("system")
            if system and system.entity_id == entity_id:
                coordinator = entry_data["coordinator"]
                _LOGGER.debug("Triggering immediate state update for %s", entity_id)
                # Use async_refresh() for immediate update (bypasses debouncer)
                await coordinator.async_refresh()
                return

    _LOGGER.warning("Could not find coordinator for entity %s", entity_id)


async def _register_services(hass: HomeAssistant) -> None:
    """Register Smart Sprinkler Control services."""

    async def handle_start_zone(call: ServiceCall) -> None:
        """Handle start_zone service call.

        Single-zone operation: Starting a zone will stop any currently running zone.
        """
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]
        duration = call.data.get(ATTR_DURATION, 15)
        schedule_id = call.data.get(ATTR_SCHEDULE_ID)

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("Starting zone %d for %d minutes", zone_id, duration)

        # Single-zone operation: Turn off any currently active zone switches first
        active_zones = system.get_active_zones()
        zone_was_stopped = False
        for active_zone in active_zones:
            if active_zone.settings.switch_entity:
                try:
                    await hass.services.async_call(
                        "switch",
                        "turn_off",
                        {"entity_id": active_zone.settings.switch_entity},
                        blocking=True,
                    )
                    _LOGGER.info(
                        "Single-zone operation: turned off zone %d (%s)",
                        active_zone.zone_id,
                        active_zone.settings.switch_entity,
                    )
                    zone_was_stopped = True
                except Exception as e:
                    _LOGGER.error(
                        "Failed to turn off switch %s for zone %d: %s",
                        active_zone.settings.switch_entity,
                        active_zone.zone_id,
                        e,
                    )

        # 5-second delay between stopping one zone and starting another
        # This protects the sprinkler valves and allows water pressure to stabilize
        if zone_was_stopped:
            _LOGGER.info(
                "Waiting 5 seconds before starting zone %d (valve protection)", zone_id
            )
            await asyncio.sleep(5)

        # Start the zone in the system (this also updates model state)
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

        # Trigger immediate state update so frontend sees the change
        await _trigger_state_update(hass, entity_id)

    async def handle_stop_zone(call: ServiceCall) -> None:
        """Handle stop_zone service call."""
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        _LOGGER.info("-" * 50)
        _LOGGER.info("<<< ZONE STOP: zone %d (manual)", zone_id)

        # Turn off the hardware switch first
        zone = system.zones.get(zone_id)
        if zone and zone.settings.switch_entity:
            _LOGGER.info("    Turning off switch: %s", zone.settings.switch_entity)
            try:
                await hass.services.async_call(
                    "switch",
                    "turn_off",
                    {"entity_id": zone.settings.switch_entity},
                    blocking=True,
                )
                _LOGGER.info("    Switch OFF confirmed")
            except Exception as e:
                _LOGGER.error(
                    "    SWITCH ERROR: Failed to turn off %s: %s",
                    zone.settings.switch_entity,
                    e,
                )

        result = system.stop_zone(zone_id)
        if result:
            _LOGGER.info("    Zone %d stopped successfully", zone_id)

        # Trigger immediate state update so frontend sees the change
        await _trigger_state_update(hass, entity_id)

    async def handle_adjust_zone_time(call: ServiceCall) -> None:
        """Handle adjust_zone_time: adjust remaining time for a running zone."""
        entity_id = call.data[ATTR_ENTITY_ID]
        zone_id = call.data[ATTR_ZONE_ID]
        new_duration = call.data[ATTR_DURATION]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        zone = system.zones.get(zone_id)
        if not zone:
            _LOGGER.error("Zone %d not found", zone_id)
            return

        if not zone.is_watering():
            _LOGGER.warning("Zone %d is not running, cannot adjust time", zone_id)
            return

        # Enforce minimum of 5 minutes
        new_duration = max(5, new_duration)
        _LOGGER.info(
            "Adjusting zone %d remaining time to %d minutes", zone_id, new_duration
        )

        # Update the zone's remaining duration and end_time
        from datetime import datetime, timedelta

        zone.remaining_duration = new_duration
        zone.end_time = datetime.now() + timedelta(minutes=new_duration)

        # Trigger immediate state update so frontend sees the change
        await _trigger_state_update(hass, entity_id)

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

        # Trigger immediate state update so frontend sees the change
        await _trigger_state_update(hass, entity_id)

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

        # Trigger state update so frontend sees changes
        await _trigger_state_update(hass, entity_id)

    async def handle_create_schedule(call: ServiceCall) -> None:
        """Handle create_schedule service call."""
        from datetime import datetime
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
        schedule_time = time_type(hour, minute)

        schedule = SprinklerSchedule(
            schedule_id=schedule_id,
            name=call.data["name"],
            zone_ids=call.data["zone_ids"],
            start_time=schedule_time,
            days_of_week=call.data["days_of_week"],
            enabled=call.data.get("enabled", True),
            zone_durations=call.data.get("zone_durations", {}),
            skip_if_rain=call.data.get("skip_if_rain", True),
            rain_threshold=call.data.get("rain_threshold", 0.1),
        )

        # Check if this is an update (schedule already exists)
        existing_schedule = system.schedules.get(schedule_id)
        now = datetime.now()

        if existing_schedule:
            # Preserve last_run_date when editing to prevent re-triggering
            schedule.last_run_date = existing_schedule.last_run_date
            _LOGGER.debug(
                "Schedule %s: preserving last_run_date from existing schedule",
                schedule_id,
            )
        elif now.time() >= schedule_time:
            # New schedule: if start time already passed today, mark as run
            schedule.last_run_date = now
            _LOGGER.debug(
                "Schedule %s: start time already passed, marking as run today",
                schedule_id,
            )

        result = system.create_schedule(schedule)
        if result:
            _LOGGER.info("Created schedule: %s", schedule_id)
            # Trigger state update so frontend sees the change immediately
            await _trigger_state_update(hass, entity_id)
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
            # Trigger state update so frontend sees the change immediately
            await _trigger_state_update(hass, entity_id)
        else:
            _LOGGER.warning("Failed to delete schedule: %s", schedule_id)

    async def handle_run_schedule(call: ServiceCall) -> None:
        """Handle run_schedule service call - manually run a schedule now."""
        entity_id = call.data[ATTR_ENTITY_ID]
        schedule_id = call.data[ATTR_SCHEDULE_ID]

        system = _get_system_from_entity_id(hass, entity_id)
        if not system:
            _LOGGER.error("System not found for entity: %s", entity_id)
            return

        schedule = system.schedules.get(schedule_id)
        if not schedule:
            _LOGGER.error("Schedule not found: %s", schedule_id)
            return

        # Check if a schedule is already running
        if system.is_schedule_running():
            running_id = system.get_running_schedule_id()
            _LOGGER.warning(
                "Cannot run schedule %s: schedule %s is already running",
                schedule_id,
                running_id,
            )
            return

        if not schedule.zone_ids:
            _LOGGER.warning("Schedule %s has no zones", schedule_id)
            return

        _LOGGER.info("=" * 60)
        _LOGGER.info("SCHEDULE RUN: %s (manual trigger)", schedule.name)
        _LOGGER.info("  Zones: %s", schedule.zone_ids)
        _LOGGER.info("=" * 60)

        # Build the queue of (zone_id, duration) tuples
        queue = []
        for zone_id in schedule.zone_ids:
            duration = schedule.get_zone_duration(zone_id)
            queue.append((zone_id, duration))
            _LOGGER.info("  Queue item: zone %d for %d min", zone_id, duration)

        # Start the first zone and pass the rest as queue
        first_zone_id, first_duration = queue[0]
        remaining_queue = queue[1:]

        zone = system.zones.get(first_zone_id)
        if not zone:
            _LOGGER.error("SCHEDULE ERROR: First zone %d not found", first_zone_id)
            return

        # Start the zone
        system.start_zone(first_zone_id, first_duration, schedule_id)
        zone.schedule_queue = remaining_queue

        _LOGGER.info(
            ">>> ZONE START: zone %d (%s) for %d min | Queue remaining: %d",
            first_zone_id,
            zone.settings.name,
            first_duration,
            len(remaining_queue),
        )

        # Turn on the physical switch
        if zone.settings.switch_entity:
            try:
                await hass.services.async_call(
                    "switch",
                    "turn_on",
                    {"entity_id": zone.settings.switch_entity},
                    blocking=True,
                )
            except Exception as e:
                _LOGGER.error(
                    "Failed to turn on switch for zone %d: %s", first_zone_id, e
                )

        # Trigger state update
        await _trigger_state_update(hass, entity_id)

    # Register all services
    hass.services.async_register(
        DOMAIN, SERVICE_START_ZONE, handle_start_zone, schema=START_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_STOP_ZONE, handle_stop_zone, schema=STOP_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_STOP_ALL_ZONES,
        handle_stop_all_zones,
        schema=STOP_ALL_ZONES_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_ADJUST_ZONE_TIME,
        handle_adjust_zone_time,
        schema=ADJUST_ZONE_TIME_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "enable_rain_delay",
        handle_enable_rain_delay,
        schema=ENABLE_RAIN_DELAY_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        "disable_rain_delay",
        handle_disable_rain_delay,
        schema=DISABLE_RAIN_DELAY_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_ZONE_SETTINGS,
        handle_update_zone_settings,
        schema=UPDATE_ZONE_SETTINGS_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_SCHEDULE,
        handle_create_schedule,
        schema=CREATE_SCHEDULE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_SCHEDULE,
        handle_delete_schedule,
        schema=DELETE_SCHEDULE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN, "run_schedule", handle_run_schedule, schema=RUN_SCHEDULE_SCHEMA
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
            # Track active zones and their schedule queues BEFORE update
            active_zones_before: Dict[int, Dict[str, Any]] = {}
            for zone_id, zone in self.system.zones.items():
                if zone.is_watering() and zone.settings.switch_entity:
                    active_zones_before[zone_id] = {
                        "switch_entity": zone.settings.switch_entity,
                        "schedule_queue": zone.schedule_queue.copy(),
                        "schedule_id": zone.current_schedule_id,
                    }

            # Update system state (timers, rain delay expiry, etc.)
            self.system.update_system_state()

            # Check for zones that were auto-stopped (were running, now idle)
            for zone_id, zone_data in active_zones_before.items():
                zone_obj = self.system.zones.get(zone_id)
                if zone_obj and not zone_obj.is_watering():
                    switch_entity = zone_data["switch_entity"]
                    schedule_queue = zone_data["schedule_queue"]
                    schedule_id = zone_data["schedule_id"]

                    # Zone was auto-stopped by timer - turn off the physical switch
                    _LOGGER.info("-" * 50)
                    _LOGGER.info(
                        "<<< ZONE STOP: zone %d (%s) timer expired",
                        zone_id,
                        zone_obj.settings.name,
                    )
                    _LOGGER.info("    Turning off switch: %s", switch_entity)
                    try:
                        await self.hass.services.async_call(
                            "switch",
                            "turn_off",
                            {"entity_id": switch_entity},
                            blocking=True,
                        )
                        _LOGGER.info("    Switch OFF confirmed")
                    except Exception as e:
                        _LOGGER.error(
                            "    SWITCH ERROR: Failed to turn off %s: %s",
                            switch_entity,
                            e,
                        )

                    # If this zone had a schedule queue, start the next zone
                    if schedule_queue:
                        _LOGGER.info(
                            "    Queue has %d zones remaining, starting next...",
                            len(schedule_queue),
                        )
                        await self._start_next_scheduled_zone(
                            schedule_queue, schedule_id
                        )
                    else:
                        _LOGGER.info("    No more zones in queue - schedule complete")
                        _LOGGER.info("=" * 60)
                        _LOGGER.info("SCHEDULE COMPLETE: %s", schedule_id or "manual")
                        _LOGGER.info("=" * 60)

            # Check schedules that should run now
            from datetime import datetime

            now = datetime.now()

            for schedule in self.system.schedules.values():
                if schedule.enabled and schedule.should_run_now():
                    # Check if we haven't already run today
                    if (
                        not schedule.last_run_date
                        or schedule.last_run_date.date() != now.date()
                    ):
                        # Check rain conditions
                        should_skip = False
                        if schedule.skip_if_rain and self.system.rain_delay_active:
                            should_skip = True
                            _LOGGER.info(
                                "Skipping schedule %s due to rain delay", schedule.name
                            )

                        if not should_skip:
                            # Check if a schedule is already running
                            if self.system.is_schedule_running():
                                _LOGGER.info(
                                    "Skipping schedule %s: another schedule is running",
                                    schedule.name,
                                )
                                continue

                            _LOGGER.info("=" * 60)
                            _LOGGER.info(
                                "SCHEDULE RUN: %s (auto-trigger at %s)",
                                schedule.name,
                                schedule.start_time,
                            )
                            _LOGGER.info("  Zones: %s", schedule.zone_ids)
                            _LOGGER.info("=" * 60)

                            # Build the queue of (zone_id, duration) tuples
                            queue = []
                            for zone_id in schedule.zone_ids:
                                dur = schedule.get_zone_duration(zone_id)
                                queue.append((zone_id, dur))
                                _LOGGER.info(
                                    "  Queue item: zone %d for %d min", zone_id, dur
                                )

                            if queue:
                                # Start the first zone with queue
                                first_zone_id, first_duration = queue[0]
                                remaining_queue = queue[1:]

                                zone_obj = self.system.zones.get(first_zone_id)
                                if zone_obj:
                                    self.system.start_zone(
                                        first_zone_id,
                                        first_duration,
                                        schedule.schedule_id,
                                    )
                                    zone_obj.schedule_queue = remaining_queue

                                    _LOGGER.info("-" * 50)
                                    _LOGGER.info(
                                        ">>> ZONE START: zone %d (%s) for %d min "
                                        "| Queue remaining: %d",
                                        first_zone_id,
                                        zone_obj.settings.name,
                                        first_duration,
                                        len(remaining_queue),
                                    )

                                    # Turn on the physical switch
                                    switch_entity = zone_obj.settings.switch_entity
                                    if switch_entity:
                                        _LOGGER.info(
                                            "    Turning on switch: %s",
                                            switch_entity,
                                        )
                                        try:
                                            await self.hass.services.async_call(
                                                "switch",
                                                "turn_on",
                                                {"entity_id": switch_entity},
                                                blocking=True,
                                            )
                                            _LOGGER.info("    Switch ON confirmed")
                                        except Exception as e:
                                            _LOGGER.error(
                                                "    SWITCH ERROR: "
                                                "Failed to turn on %s: %s",
                                                switch_entity,
                                                e,
                                            )

                            schedule.last_run_date = now

            # Save data periodically
            entry_data = self.hass.data[DOMAIN].get(self.entry.entry_id, {})
            store = entry_data.get("store")
            if store:
                await _save_system_data(self.system, store)

            # Log current state for monitoring
            active_zones = self.system.get_active_zones()
            if active_zones:
                for zone in active_zones:
                    _LOGGER.debug(
                        "[STATUS] Zone %d (%s) running: %d min remaining, "
                        "schedule=%s, queue=%d",
                        zone.zone_id,
                        zone.settings.name,
                        zone.remaining_duration,
                        zone.current_schedule_id or "manual",
                        len(zone.schedule_queue),
                    )

            return {
                "state": self.system.get_overall_state(),
                "active_zones": len(active_zones),
                "rain_delay": self.system.rain_delay_active,
                "last_updated": now.isoformat(),
            }

        except Exception as exception:
            _LOGGER.error("Error updating sprinkler data: %s", exception)
            raise UpdateFailed(
                f"Error updating sprinkler data: {exception}"
            ) from exception

    async def _start_next_scheduled_zone(self, queue: list, schedule_id: str) -> None:
        """Start the next zone from a schedule queue.

        Args:
            queue: List of (zone_id, duration) tuples for remaining zones
            schedule_id: The schedule ID for logging
        """
        if not queue:
            _LOGGER.info("=" * 60)
            _LOGGER.info("SCHEDULE COMPLETE: %s - all zones finished", schedule_id)
            _LOGGER.info("=" * 60)
            return

        # Pop the first zone from queue
        next_zone_id, duration = queue[0]
        remaining_queue = queue[1:]  # Rest of queue for this zone to pass on

        zone = self.system.zones.get(next_zone_id)
        if not zone:
            _LOGGER.error("SCHEDULE ERROR: zone %d not found, skipping", next_zone_id)
            # Try next zone in queue
            if remaining_queue:
                await self._start_next_scheduled_zone(remaining_queue, schedule_id)
            return

        # 5-second delay for valve protection between zones
        _LOGGER.info("    Waiting 5 seconds for valve protection...")
        await asyncio.sleep(5)

        _LOGGER.info("-" * 50)
        _LOGGER.info(
            ">>> ZONE START: zone %d (%s) for %d min | Queue remaining: %d",
            next_zone_id,
            zone.settings.name,
            duration,
            len(remaining_queue),
        )

        # Start the zone and pass the remaining queue
        self.system.start_zone(next_zone_id, duration, schedule_id)
        zone.schedule_queue = remaining_queue

        # Turn on the physical switch
        if zone.settings.switch_entity:
            _LOGGER.info("    Turning on switch: %s", zone.settings.switch_entity)
            try:
                await self.hass.services.async_call(
                    "switch",
                    "turn_on",
                    {"entity_id": zone.settings.switch_entity},
                    blocking=True,
                )
                _LOGGER.info("    Switch ON confirmed")
            except Exception as e:
                _LOGGER.error(
                    "    SWITCH ERROR: Failed to turn on %s: %s",
                    zone.settings.switch_entity,
                    e,
                )
        else:
            _LOGGER.warning(
                "    WARNING: No switch configured for zone %d", next_zone_id
            )
