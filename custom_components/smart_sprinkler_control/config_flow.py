"""Config flow for Smart Sprinkler Manager integration."""

import logging
from typing import Any, Dict, Optional

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import DEFAULT_ZONE_COUNT, DOMAIN

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
                self._zone_count = zone_count

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
    """Handle options flow for Smart Sprinkler Manager."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        # Get current configuration
        current_options = self.config_entry.options

        data_schema = vol.Schema(
            {
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
                vol.Optional(
                    "soil_moisture_threshold",
                    default=current_options.get("soil_moisture_threshold", 80),
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        mode=selector.NumberSelectorMode.BOX,
                        min=0,
                        max=100,
                        step=5,
                        unit_of_measurement="%",
                    )
                ),
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=data_schema,
        )
