"""Config flow for Smart Sprinkler Manager integration."""

import logging
from typing import Any, Dict, Optional

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_ZONE_COUNT,
    CONF_ZONE_NAMES,
    CONF_ZONE_SWITCHES,
    DEFAULT_ZONE_COUNT,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class SmartSprinklerManagerConfigFlow(
    config_entries.ConfigFlow, domain=DOMAIN  # type: ignore[call-arg]
):
    """Handle a config flow for Smart Sprinkler Manager."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._system_name: Optional[str] = None
        self._zone_count: int = DEFAULT_ZONE_COUNT
        self._zone_names: Dict[int, str] = {}
        self._zone_switches: Dict[int, str] = {}

    async def async_step_import(
        self, import_data: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle import from YAML configuration."""
        if import_data is None:
            return self.async_abort(reason="no_import_data")

        system_name = import_data.get("system_name", "Smart Sprinkler System")

        # Set unique ID and check for duplicates
        await self.async_set_unique_id(system_name.lower().replace(" ", "_"))
        self._abort_if_unique_id_configured()

        _LOGGER.info("Importing Smart Sprinkler Control from YAML: %s", system_name)

        # Create config entry directly from import data
        return self.async_create_entry(
            title=system_name,
            data={
                "system_name": system_name,
                "zone_count": import_data.get("zone_count", DEFAULT_ZONE_COUNT),
                "zone_names": import_data.get("zone_names", {}),
                "zone_switches": import_data.get("zone_switches", {}),
                "weather_entity": import_data.get("weather_entity"),
                "rain_sensor_entity": import_data.get("rain_sensor_entity"),
                "enable_weather_integration": import_data.get("weather_entity")
                is not None,
            },
        )

    async def async_step_user(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: Dict[str, str] = {}

        if user_input is not None:
            # Validate input
            system_name = user_input.get("system_name", "").strip()
            zone_count = user_input.get("zone_count", DEFAULT_ZONE_COUNT)

            if not system_name:
                errors["system_name"] = "System name is required"
            elif len(system_name) < 3:
                errors["system_name"] = "System name must be at least 3 characters"
            elif zone_count < 1 or zone_count > 32:
                errors["zone_count"] = "Zone count must be between 1 and 32"
            else:
                # Check for existing entries with same name
                await self.async_set_unique_id(system_name.lower().replace(" ", "_"))
                self._abort_if_unique_id_configured()

                self._system_name = system_name
                self._zone_count = int(zone_count)

                # Proceed to zone configuration
                return await self.async_step_zones()

        # Show form
        data_schema = vol.Schema(
            {
                vol.Required("system_name", default="Smart Sprinkler System"): str,
                vol.Required(
                    "zone_count", default=DEFAULT_ZONE_COUNT
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        mode=selector.NumberSelectorMode.BOX,
                        min=1,
                        max=32,
                        step=1,
                    )
                ),
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
            description_placeholders={
                "system_name": "Smart Sprinkler System",
                "zone_count": str(DEFAULT_ZONE_COUNT),
            },
        )

    async def async_step_zones(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle zone configuration step."""
        errors: Dict[str, str] = {}

        if user_input is not None:
            # Extract zone names
            zone_names = {}
            for i in range(1, self._zone_count + 1):
                zone_name = user_input.get(f"zone_{i}_name", f"Zone {i}").strip()
                if zone_name:
                    zone_names[i] = zone_name
                else:
                    zone_names[i] = f"Zone {i}"

            self._zone_names = zone_names

            # Proceed to zone switch mapping
            return await self.async_step_zone_switches()

        # Build dynamic schema for zone names
        schema_dict = {}
        for i in range(1, self._zone_count + 1):
            schema_dict[vol.Optional(f"zone_{i}_name", default=f"Zone {i}")] = str

        data_schema = vol.Schema(schema_dict)

        return self.async_show_form(
            step_id="zones",
            data_schema=data_schema,
            errors=errors,
            description_placeholders={
                "zone_count": str(self._zone_count),
                "system_name": self._system_name or "Smart Sprinkler System",
            },
        )

    async def async_step_zone_switches(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle zone to switch entity mapping step."""
        errors: Dict[str, str] = {}

        if user_input is not None:
            # Extract zone switch mappings
            zone_switches = {}
            for i in range(1, self._zone_count + 1):
                switch_entity = user_input.get(f"zone_{i}_switch")
                if switch_entity:
                    zone_switches[i] = switch_entity

            self._zone_switches = zone_switches

            # Proceed to optional weather integration
            return await self.async_step_weather()

        # Build dynamic schema for zone switch mappings
        schema_dict = {}
        for i in range(1, self._zone_count + 1):
            schema_dict[vol.Optional(f"zone_{i}_switch")] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain="switch")
            )

        data_schema = vol.Schema(schema_dict)

        return self.async_show_form(
            step_id="zone_switches",
            data_schema=data_schema,
            errors=errors,
            description_placeholders={
                "zone_count": str(self._zone_count),
                "system_name": self._system_name or "Smart Sprinkler System",
            },
        )

    async def async_step_weather(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle weather integration step."""
        if user_input is not None:
            # Create the config entry
            config_data = {
                "system_name": self._system_name,
                "zone_count": self._zone_count,
                "zone_names": self._zone_names,
                "zone_switches": self._zone_switches,
                "weather_entity": user_input.get("weather_entity"),
                "rain_sensor_entity": user_input.get("rain_sensor_entity"),
                "enable_weather_integration": user_input.get(
                    "enable_weather_integration", False
                ),
            }

            return self.async_create_entry(
                title=self._system_name or "Smart Sprinkler System",
                data=config_data,
            )

        # Get available weather entities
        weather_entities = []
        rain_sensor_entities = []

        for state in self.hass.states.async_all():
            if state.entity_id.startswith("weather."):
                weather_entities.append(state.entity_id)
            elif (
                state.entity_id.startswith("binary_sensor.")
                and "rain" in state.entity_id.lower()
            ):
                rain_sensor_entities.append(state.entity_id)

        # Build schema with available entities
        schema_dict = {
            vol.Optional("enable_weather_integration", default=False): bool,
        }

        if weather_entities:
            schema_dict[vol.Optional("weather_entity")] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain="weather")
            )

        if rain_sensor_entities:
            schema_dict[vol.Optional("rain_sensor_entity")] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain="binary_sensor")
            )

        data_schema = vol.Schema(schema_dict)

        return self.async_show_form(
            step_id="weather",
            data_schema=data_schema,
            description_placeholders={
                "system_name": self._system_name or "Smart Sprinkler System",
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Create the options flow."""
        return SmartSprinklerManagerOptionsFlow(config_entry)


class SmartSprinklerManagerOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Smart Sprinkler Manager.

    Multi-step reconfiguration that mirrors the install flow so a user can
    change zone count, per-zone names, and per-zone switch entities after
    install, plus weather/rain-delay preferences — all without deleting and
    re-adding the integration.

    PERSISTENCE DECISION:
        Zone *topology* (zone_count / zone_names / zone_switches) is canonical
        "what the device IS" data, so it is written back to ``entry.data`` via
        ``hass.config_entries.async_update_entry``. ``async_setup_entry`` already
        reads zone config exclusively from ``entry.data``, so on the reload that
        follows the save it picks up the new topology with no extra merge logic.
        User *preferences* (enable_weather_integration, weather_entity,
        rain_sensor_entity, rain_delay_hours) stay in ``entry.options`` — they are
        read live elsewhere (e.g. rain_delay_hours via _get_options_for_system)
        and must not force a reload. The reload listener (async_reload_entry in
        __init__.py) fires on the options update and applies the new topology.
    """

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow.

        NOTE: do NOT assign ``self.config_entry`` — in current Home Assistant it
        is a read-only property the framework injects, and assigning it raises
        AttributeError. The entry is read via ``self.config_entry`` everywhere.
        """
        # Working copies collected across steps before the final save.
        self._zone_count: int = config_entry.data.get(
            CONF_ZONE_COUNT, DEFAULT_ZONE_COUNT
        )
        self._zone_names: Dict[int, str] = {}
        self._zone_switches: Dict[int, str] = {}
        self._prefs: Dict[str, Any] = {}

    @staticmethod
    def _normalize_map(raw: Any) -> Dict[int, Any]:
        """Coerce a stored zone map (int or str keys) to int-keyed dict."""
        result: Dict[int, Any] = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                try:
                    result[int(key)] = value
                except (ValueError, TypeError):
                    continue
        return result

    async def async_step_init(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Step 1: preferences + desired zone count."""
        current_options = self.config_entry.options
        current_count = self.config_entry.data.get(CONF_ZONE_COUNT, DEFAULT_ZONE_COUNT)

        if user_input is not None:
            self._zone_count = int(user_input["zone_count"])
            self._prefs = {
                "enable_weather_integration": user_input.get(
                    "enable_weather_integration", False
                ),
                "rain_delay_hours": int(user_input.get("rain_delay_hours", 24)),
            }
            return await self.async_step_zones()

        data_schema = vol.Schema(
            {
                vol.Required(
                    "zone_count", default=current_count
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        mode=selector.NumberSelectorMode.BOX,
                        min=1,
                        max=32,
                        step=1,
                    )
                ),
                vol.Optional(
                    "enable_weather_integration",
                    default=current_options.get("enable_weather_integration", False),
                ): bool,
                vol.Optional(
                    "rain_delay_hours",
                    default=current_options.get("rain_delay_hours", 24),
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        mode=selector.NumberSelectorMode.BOX,
                        min=1,
                        max=168,  # 1 week
                        step=1,
                        unit_of_measurement="hours",
                    )
                ),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)

    async def async_step_zones(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Step 2: per-zone names, pre-filled with current values."""
        current_names = self._normalize_map(
            self.config_entry.data.get(CONF_ZONE_NAMES, {})
        )

        if user_input is not None:
            for i in range(1, self._zone_count + 1):
                name = (user_input.get(f"zone_{i}_name") or f"Zone {i}").strip()
                self._zone_names[i] = name or f"Zone {i}"
            return await self.async_step_zone_switches()

        schema_dict = {}
        for i in range(1, self._zone_count + 1):
            default_name = current_names.get(i, f"Zone {i}")
            schema_dict[vol.Optional(f"zone_{i}_name", default=default_name)] = str
        return self.async_show_form(
            step_id="zones",
            data_schema=vol.Schema(schema_dict),
            description_placeholders={"zone_count": str(self._zone_count)},
        )

    async def async_step_zone_switches(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Step 3: per-zone switch entities, pre-filled, then save."""
        current_switches = self._normalize_map(
            self.config_entry.data.get(CONF_ZONE_SWITCHES, {})
        )

        if user_input is not None:
            for i in range(1, self._zone_count + 1):
                switch = user_input.get(f"zone_{i}_switch")
                if switch:
                    self._zone_switches[i] = switch
            return await self._save()

        schema_dict = {}
        for i in range(1, self._zone_count + 1):
            field = vol.Optional(f"zone_{i}_switch")
            if i in current_switches:
                field = vol.Optional(f"zone_{i}_switch", default=current_switches[i])
            schema_dict[field] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain="switch")
            )
        return self.async_show_form(
            step_id="zone_switches",
            data_schema=vol.Schema(schema_dict),
            description_placeholders={"zone_count": str(self._zone_count)},
        )

    async def _save(self) -> FlowResult:
        """Persist zone topology to entry.data and prefs to entry.options.

        Zone topology goes to ``entry.data`` (canonical device config that
        ``async_setup_entry`` reads on reload). Switch/name maps are stored with
        string keys to match how the install flow / YAML import store them and
        how ``async_setup_entry`` reads them. Preferences are returned as the
        options entry; the resulting options update triggers async_reload_entry.
        """
        new_data = {
            **self.config_entry.data,
            CONF_ZONE_COUNT: self._zone_count,
            CONF_ZONE_NAMES: {str(k): v for k, v in self._zone_names.items()},
            CONF_ZONE_SWITCHES: {str(k): v for k, v in self._zone_switches.items()},
        }
        self.hass.config_entries.async_update_entry(self.config_entry, data=new_data)
        return self.async_create_entry(title="", data=self._prefs)
