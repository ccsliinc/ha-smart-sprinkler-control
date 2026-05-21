"""Unit tests for precipitation sensor discovery.

Covers the device_class-based discovery introduced to replace the brittle
entity-id name matching, plus the name-based fallback and the empty case.
"""

import importlib.util
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Stub the heavy Home Assistant imports pulled in at module import time so the
# discovery logic can be tested in isolation without a running HA instance.
for mod_name in (
    "aiohttp",
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.recorder",
    "homeassistant.components.recorder.history",
    "homeassistant.core",
    "homeassistant.util",
    "homeassistant.util.dt",
):
    sys.modules.setdefault(mod_name, types.ModuleType(mod_name))

sys.modules["aiohttp"].web = MagicMock()
sys.modules["homeassistant.components.recorder"].get_instance = MagicMock()
sys.modules["homeassistant.components.recorder.history"].get_significant_states = (
    MagicMock()
)
sys.modules["homeassistant.core"].HomeAssistant = object
# precipitation.py imports `from homeassistant.util import dt as dt_util`; the
# discovery tests don't exercise time handling, so a MagicMock stub suffices.
sys.modules["homeassistant.util"].dt = sys.modules["homeassistant.util.dt"]

# Import the function under test directly from the source file.
_PRECIP_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
    / "api"
    / "precipitation.py"
)
_spec = importlib.util.spec_from_file_location("precipitation_under_test", _PRECIP_PATH)
precipitation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(precipitation)
discover_precipitation_sensors = precipitation.discover_precipitation_sensors


@dataclass
class FakeState:
    """Minimal stand-in for a Home Assistant State object."""

    attributes: dict = field(default_factory=dict)


class FakeStates:
    """Minimal stand-in for hass.states with the methods discovery uses."""

    def __init__(self, sensors: dict):
        """Store a mapping of entity_id -> attributes dict."""
        self._sensors = sensors

    def async_entity_ids(self, domain=None):
        """Return entity ids, optionally filtered by domain prefix."""
        ids = list(self._sensors)
        if domain:
            return [eid for eid in ids if eid.startswith(f"{domain}.")]
        return ids

    def get(self, entity_id):
        """Return a FakeState for the given entity id, or None."""
        attrs = self._sensors.get(entity_id)
        return FakeState(attributes=attrs) if attrs is not None else None


class FakeHass:
    """Minimal hass with a .states attribute."""

    def __init__(self, sensors: dict):
        """Build fake hass from an entity_id -> attributes mapping."""
        self.states = FakeStates(sensors)


def test_discovers_by_device_class():
    """Sensors are found by device_class regardless of entity_id name."""
    hass = FakeHass(
        {
            "sensor.backyard_rain_gauge": {
                "device_class": "precipitation_intensity",
                "friendly_name": "Backyard Rain Gauge",
            },
            "sensor.roof_snow_meter": {
                "device_class": "precipitation",
                "friendly_name": "Roof Snow Meter",
            },
            "sensor.living_room_temp": {"device_class": "temperature"},
        }
    )

    rain, snow = discover_precipitation_sensors(hass)

    assert rain == ["sensor.backyard_rain_gauge"]
    assert snow == ["sensor.roof_snow_meter"]


def test_name_based_fallback_still_works():
    """Legacy OWM sensors lacking a precip device_class match by name."""
    hass = FakeHass(
        {
            "sensor.openweathermap_rain_intensity": {"device_class": "none"},
            "sensor.openweathermap_snow_intensity": {"device_class": "none"},
        }
    )

    rain, snow = discover_precipitation_sensors(hass)

    assert rain == ["sensor.openweathermap_rain_intensity"]
    assert snow == ["sensor.openweathermap_snow_intensity"]


def test_returns_empty_when_no_precip_sensors():
    """No matching sensors yields empty lists (graceful, no error)."""
    hass = FakeHass(
        {
            "sensor.living_room_temp": {"device_class": "temperature"},
            "sensor.front_door": {"device_class": "door"},
        }
    )

    rain, snow = discover_precipitation_sensors(hass)

    assert rain == []
    assert snow == []


def test_snow_classified_by_friendly_name():
    """A precip sensor named for snow is bucketed as snow, not rain."""
    hass = FakeHass(
        {
            "sensor.weather_precip_a": {
                "device_class": "precipitation_intensity",
                "friendly_name": "Backyard Snow Rate",
            },
        }
    )

    rain, snow = discover_precipitation_sensors(hass)

    assert rain == []
    assert snow == ["sensor.weather_precip_a"]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
