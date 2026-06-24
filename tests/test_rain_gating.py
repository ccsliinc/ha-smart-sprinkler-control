"""Unit tests for rainfall-driven watering control.

Covers the two behaviors wired up from the previously-dead WeatherServices:

1. ``SprinklerSystem`` auto-vs-manual rain-delay semantics — an auto-clear must
   never cancel a manually set delay, and a manual enable always takes
   precedence over auto.
2. ``WeatherServices.async_should_skip_schedule`` — skip a run when the 24h
   accumulation meets the schedule's configured ``rain_threshold``, honoring
   ``skip_if_rain`` and adjustable thresholds.
3. ``WeatherServices.async_evaluate_auto_rain_delay`` — enable while raining,
   clear when it stops, and leave a manual delay untouched.

The source modules are imported directly (with the heavy Home Assistant
imports stubbed) so the logic runs without a live HA instance, matching the
isolation style of the existing precipitation tests.
"""

import asyncio
import importlib.util
import sys
import types
from datetime import datetime, time, timedelta
from pathlib import Path

import pytest

_CC = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
)


# --- Stub the heavy HA imports pulled in by the modules under test ----------
for mod_name in (
    "homeassistant",
    "homeassistant.core",
):
    sys.modules.setdefault(mod_name, types.ModuleType(mod_name))
sys.modules["homeassistant.core"].HomeAssistant = object


def _load(mod_name: str, rel_path: str):
    """Load a source module file directly under a private test name."""
    spec = importlib.util.spec_from_file_location(mod_name, _CC / rel_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


# zone.py is pure stdlib — safe to import directly.
zone = _load("ssc_zone_under_test", "models/zone.py")
SprinklerSystem = zone.SprinklerSystem
SprinklerSchedule = zone.SprinklerSchedule


def _make_system() -> "SprinklerSystem":
    """Build a small 2-zone system for delay/skip tests."""
    return SprinklerSystem(system_name="Test", entity_id="sensor.test", zone_count=2)


# ===========================================================================
# Auto-vs-manual rain-delay semantics (model layer)
# ===========================================================================
def test_auto_enable_sets_auto_flag():
    """An auto enable activates the delay and marks it auto."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    assert sys_.rain_delay_active is True
    assert sys_.auto_rain_delay is True


def test_manual_enable_clears_auto_flag():
    """A manual enable takes precedence: auto flag is cleared."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    sys_.enable_rain_delay(24, auto=False)
    assert sys_.rain_delay_active is True
    assert sys_.auto_rain_delay is False


def test_auto_enable_does_not_downgrade_manual():
    """An auto enable must not overwrite an existing manual delay."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=False)  # manual
    sys_.enable_rain_delay(24, auto=True)  # auto attempt
    assert sys_.rain_delay_active is True
    assert sys_.auto_rain_delay is False  # still manual


def test_auto_clear_does_not_cancel_manual_delay():
    """A dry-spell auto-clear leaves a manually set delay in place."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=False)  # manual
    cleared = sys_.disable_rain_delay(auto=True)  # auto clear attempt
    assert cleared is False
    assert sys_.rain_delay_active is True


def test_auto_clear_cancels_auto_delay():
    """An auto-clear DOES cancel a delay that was set automatically."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    cleared = sys_.disable_rain_delay(auto=True)
    assert cleared is True
    assert sys_.rain_delay_active is False
    assert sys_.auto_rain_delay is False


def test_manual_disable_clears_everything():
    """Manual disable clears the delay regardless of how it was set."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    cleared = sys_.disable_rain_delay(auto=False)
    assert cleared is True
    assert sys_.rain_delay_active is False
    assert sys_.auto_rain_delay is False


# ===========================================================================
# WeatherServices: skip-threshold + auto-delay evaluation
# ===========================================================================
# WeatherServices imports the precip module; stub compute_precipitation_totals
# with a controllable fake so tests drive the totals/current_rate directly.
class _FakePrecip:
    """Holds the precip values the next compute call should return."""

    def __init__(self):
        self.total_24h = 0.0
        self.today_total = 0.0
        self.current_rate = 0.0
        self.has_rain_sensor = True

    async def compute(self, _hass):
        """Mimic compute_precipitation_totals output."""
        sensors = {"rain": ["sensor.rain"] if self.has_rain_sensor else [], "snow": []}
        return {
            "hourly": [],
            "today_total": self.today_total,
            "total_24h": self.total_24h,
            "current_rate": self.current_rate,
            "sensors": sensors,
        }


@pytest.fixture
def weather_env():
    """Load WeatherServices with a stubbed precip data source."""
    fake = _FakePrecip()

    # Stub the api.precipitation module so the import inside weather_services
    # resolves to our controllable compute function.
    pkg = types.ModuleType("ssc_pkg")
    api_pkg = types.ModuleType("ssc_pkg.api")
    precip_mod = types.ModuleType("ssc_pkg.api.precipitation")
    precip_mod.compute_precipitation_totals = fake.compute
    models_pkg = types.ModuleType("ssc_pkg.models")
    sys.modules["ssc_pkg"] = pkg
    sys.modules["ssc_pkg.api"] = api_pkg
    sys.modules["ssc_pkg.api.precipitation"] = precip_mod
    sys.modules["ssc_pkg.models"] = models_pkg
    sys.modules["ssc_pkg.models.zone"] = zone

    # Load weather_services.py with its relative imports remapped to ssc_pkg.
    src = (_CC / "services" / "weather_services.py").read_text()
    src = src.replace("from ..api.precipitation", "from ssc_pkg.api.precipitation")
    src = src.replace("from ..models.zone", "from ssc_pkg.models.zone")
    ws_mod = types.ModuleType("ssc_weather_under_test")
    exec(compile(src, "weather_services.py", "exec"), ws_mod.__dict__)

    sys_ = _make_system()
    ws = ws_mod.WeatherServices(hass=object(), sprinkler_system=sys_)
    return ws, sys_, fake


def _schedule(threshold=0.1, skip_if_rain=True):
    """Build a schedule with a given rain threshold."""
    return SprinklerSchedule(
        schedule_id="morning",
        name="Morning",
        zone_ids=[1, 2],
        start_time=time(6, 0),
        days_of_week=list(range(7)),
        rain_threshold=threshold,
        skip_if_rain=skip_if_rain,
    )


def test_skip_when_rain_meets_threshold(weather_env):
    """24h total >= threshold -> skip with a numeric reason."""
    ws, _sys, fake = weather_env
    fake.total_24h = 0.20
    skip, reason = asyncio.run(ws.async_should_skip_schedule(_schedule(0.10)))
    assert skip is True
    assert "0.20in" in reason and "0.10in" in reason


def test_no_skip_when_below_threshold(weather_env):
    """24h total below threshold -> run normally."""
    ws, _sys, fake = weather_env
    fake.total_24h = 0.05
    skip, reason = asyncio.run(ws.async_should_skip_schedule(_schedule(0.10)))
    assert skip is False
    assert reason == ""


def test_threshold_is_configurable(weather_env):
    """A higher schedule threshold prevents a skip at the same rainfall."""
    ws, _sys, fake = weather_env
    fake.total_24h = 0.15
    skip, _ = asyncio.run(ws.async_should_skip_schedule(_schedule(0.50)))
    assert skip is False


def test_skip_disabled_when_skip_if_rain_false(weather_env):
    """skip_if_rain=False never skips, regardless of rainfall."""
    ws, _sys, fake = weather_env
    fake.total_24h = 5.0
    skip, _ = asyncio.run(
        ws.async_should_skip_schedule(_schedule(0.10, skip_if_rain=False))
    )
    assert skip is False


def test_no_skip_without_sensors(weather_env):
    """No precip sensors -> graceful no-skip (don't block watering blind)."""
    ws, _sys, fake = weather_env
    fake.has_rain_sensor = False
    fake.total_24h = 5.0
    skip, _ = asyncio.run(ws.async_should_skip_schedule(_schedule(0.10)))
    assert skip is False


def test_auto_delay_enables_while_raining(weather_env):
    """Current rate > 0 enables an auto rain delay."""
    ws, sys_, fake = weather_env
    fake.current_rate = 1.5
    result = asyncio.run(ws.async_evaluate_auto_rain_delay())
    assert result == "enabled"
    assert sys_.rain_delay_active is True
    assert sys_.auto_rain_delay is True


def test_auto_delay_clears_when_rain_stops(weather_env):
    """Auto delay clears once current rate returns to 0."""
    ws, sys_, fake = weather_env
    fake.current_rate = 1.5
    asyncio.run(ws.async_evaluate_auto_rain_delay())  # enable
    fake.current_rate = 0.0
    result = asyncio.run(ws.async_evaluate_auto_rain_delay())  # clear
    assert result == "cleared"
    assert sys_.rain_delay_active is False


def test_auto_delay_does_not_clear_manual(weather_env):
    """A manual delay survives a dry-spell auto evaluation."""
    ws, sys_, fake = weather_env
    sys_.enable_rain_delay(24, auto=False)  # manual
    fake.current_rate = 0.0
    result = asyncio.run(ws.async_evaluate_auto_rain_delay())
    assert result == "noop"
    assert sys_.rain_delay_active is True
    assert sys_.auto_rain_delay is False


# ===========================================================================
# Lapsed rain-delay expiry (model layer)
# ===========================================================================
def test_expired_delay_does_not_block_start():
    """A rain delay whose end time has passed must not block start_zone."""
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    assert sys_.rain_delay_active is True
    # Force the timer into the past so the delay is lapsed.
    sys_.rain_delay_end_time = datetime.now() - timedelta(seconds=1)
    started = sys_.start_zone(1, 10)
    assert started is True
    assert sys_.rain_delay_active is False


def test_auto_delay_cleared_when_weather_disabled():
    """Model behavior the weather-disabled setup path relies on.

    An auto delay clears under an auto disable, but a manually set delay
    survives an auto disable (it is not silently auto-cleared).
    """
    # Auto delay clears under auto disable.
    sys_ = _make_system()
    sys_.enable_rain_delay(24, auto=True)
    assert sys_.rain_delay_active is True
    cleared = sys_.disable_rain_delay(auto=True)
    assert cleared is True
    assert sys_.rain_delay_active is False

    # Manual delay survives an auto disable.
    sys2 = _make_system()
    sys2.enable_rain_delay(24, auto=False)
    cleared2 = sys2.disable_rain_delay(auto=True)
    assert cleared2 is False
    assert sys2.rain_delay_active is True


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
