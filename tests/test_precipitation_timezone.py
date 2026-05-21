"""Unit tests for local-timezone bucketing in the precipitation API.

Regression coverage for the bug where rainfall was bucketed by the recorded
state's ``last_updated`` in UTC while "today"/midnight were computed locally,
causing hourly bars to land at the wrong hour-of-day (off by the UTC offset)
and ``today_total`` to read 0 even when ``hourly`` had rain.

These tests pin a fixed "now" and feed UTC-stamped recorder states, then assert
the accumulation lands in the LOCAL hour bucket and that ``today_total`` counts
in-window rain (no longer undercounting to 0).
"""

import asyncio
import importlib.util
import sys
import types
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

# Test timezone: US/Pacific (UTC-7 in summer) — a large offset makes the
# UTC-vs-local distinction unambiguous.
_TZ = ZoneInfo("America/Los_Angeles")
# Fixed reference instant: 2026-05-21 12:30 UTC == 05:30 local (PDT, UTC-7).
_NOW_UTC = datetime(2026, 5, 21, 12, 30, tzinfo=ZoneInfo("UTC"))
_NOW_LOCAL = _NOW_UTC.astimezone(_TZ)


class _FakeDtUtil(types.ModuleType):
    """Real (not mock) dt_util stub honoring a fixed local timezone."""

    def now(self):
        """Return current local-aware time (pinned for the test)."""
        return _NOW_LOCAL

    def as_local(self, value: datetime) -> datetime:
        """Convert any datetime to the test local timezone."""
        return value.astimezone(_TZ)

    def start_of_local_day(self) -> datetime:
        """Return local midnight of the pinned 'today'."""
        return _NOW_LOCAL.replace(hour=0, minute=0, second=0, microsecond=0)


# Stub the heavy Home Assistant imports pulled in at module import time.
for mod_name in (
    "aiohttp",
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.recorder",
    "homeassistant.components.recorder.history",
    "homeassistant.core",
    "homeassistant.util",
):
    sys.modules.setdefault(mod_name, types.ModuleType(mod_name))

_fake_dt = _FakeDtUtil("homeassistant.util.dt")
sys.modules["homeassistant.util.dt"] = _fake_dt
sys.modules["homeassistant.util"].dt = _fake_dt

sys.modules["aiohttp"].web = MagicMock()
sys.modules["homeassistant.components.recorder"].get_instance = MagicMock()
sys.modules["homeassistant.components.recorder.history"].get_significant_states = (
    MagicMock()
)
sys.modules["homeassistant.core"].HomeAssistant = object


# web.json_response just echoes the dict back so the test can inspect it.
def _json_response(payload, status=200):
    """Capture the response payload for assertions."""
    resp = MagicMock()
    resp.payload = payload
    resp.status = status
    return resp


sys.modules["aiohttp"].web.json_response = _json_response

# Import the module under test directly from the source file.
_PRECIP_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
    / "api"
    / "precipitation.py"
)
_spec = importlib.util.spec_from_file_location(
    "precipitation_tz_under_test", _PRECIP_PATH
)
precipitation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(precipitation)


@dataclass
class FakeState:
    """Minimal stand-in for a Home Assistant State object."""

    state: str
    last_updated: datetime
    attributes: dict = field(default_factory=dict)


class FakeStates:
    """hass.states stub exposing only what the API touches."""

    def __init__(self, sensors: dict):
        """Store entity_id -> attributes for discovery."""
        self._sensors = sensors

    def async_entity_ids(self, domain=None):
        """Return entity ids filtered by domain."""
        ids = list(self._sensors)
        return [e for e in ids if e.startswith(f"{domain}.")] if domain else ids

    def get(self, entity_id):
        """Return a FakeState carrying just the discovery attributes."""
        attrs = self._sensors.get(entity_id)
        return FakeState("0", _NOW_LOCAL, attrs) if attrs is not None else None


class FakeRecorder:
    """Recorder stub whose executor job runs the callable synchronously."""

    def __init__(self, history):
        """Store the canned history dict to return."""
        self._history = history

    async def async_add_executor_job(self, func, *args):
        """Ignore the real query; return the canned history."""
        return self._history


class FakeHass:
    """Minimal hass with the .states attribute used by discovery."""

    def __init__(self, sensors):
        """Build fake hass from an entity_id -> attributes mapping."""
        self.states = FakeStates(sensors)


def _run(coro):
    """Run an async coroutine to completion for the test."""
    return asyncio.run(coro)


def test_rain_buckets_at_local_hour_and_today_total_nonzero(monkeypatch):
    """A UTC-stamped rain interval lands in the LOCAL hour bucket.

    The recorded states sit at 12:00-12:20 UTC, which is 05:00-05:20 local
    (PDT). At a steady 12 in/h over 20 minutes the integral is ~4 in. The bug
    bucketed this at "12:00" (UTC) and excluded it from today_total; the fix
    must bucket it at "05:00" (local) and include it in today_total.
    """
    monkeypatch.setattr(precipitation, "get_instance", lambda hass: _recorder)

    sensors = {
        "sensor.pipeline_test_rain": {
            "device_class": "precipitation_intensity",
            "friendly_name": "Pipeline Test Rain",
        }
    }

    # Two states 20 min apart, both today, stamped in UTC.
    t0 = datetime(2026, 5, 21, 12, 0, tzinfo=ZoneInfo("UTC"))
    t1 = t0 + timedelta(minutes=20)
    history = {
        "sensor.pipeline_test_rain": [
            FakeState("12", t0),
            FakeState("12", t1),
        ]
    }
    global _recorder
    _recorder = FakeRecorder(history)

    hass = FakeHass(sensors)
    api = precipitation.PrecipitationAPI(hass)
    resp = _run(api.get_precipitation_history(MagicMock()))
    payload = resp.payload

    by_hour = {row["hour"]: row for row in payload["hourly"]}

    # 12:00 UTC == 05:00 local (PDT). The fix must bucket at local hour.
    assert by_hour["05:00"]["rain"] > 0, payload["hourly"]
    assert by_hour.get("12:00", {"rain": 0})["rain"] == 0, "must not bucket at UTC hour"

    # ~12 in/h * (20/60) h ~= 4 in; allow generous tolerance.
    assert by_hour["05:00"]["rain"] == pytest.approx(4.0, abs=0.5)

    # today_total must include the in-window rain (the bug read 0 here).
    assert payload["today_total"] > 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
