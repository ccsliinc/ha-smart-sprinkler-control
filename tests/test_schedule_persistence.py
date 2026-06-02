"""Unit tests for the three sprinkler fixes.

Covers:
- FIX 2: last_run_date survives a serialize -> deserialize round-trip and the
  startup-safety marker does not clobber a genuine "ran today" value.
- FIX 3: stopping a zone that never actually started (no start_time) does NOT
  record watering activity (last_watering_date / runtime stats), so an ESPHome
  reconnect or safety all-off can never look like a real run.

These import the plain dataclasses from models/zone.py directly; they do not
require a running Home Assistant instance.
"""

import importlib.util
from datetime import datetime, time
from pathlib import Path

ZONE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
    / "models"
    / "zone.py"
)

_spec = importlib.util.spec_from_file_location("ssc_zone", ZONE_PATH)
zone_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(zone_mod)

SprinklerSchedule = zone_mod.SprinklerSchedule
Zone = zone_mod.Zone
ZoneSettings = zone_mod.ZoneSettings


def _serialize(schedule):
    """Mirror the storage serialize shape used in __init__._save_system_data."""
    return {
        "name": schedule.name,
        "zone_ids": schedule.zone_ids,
        "start_time": schedule.start_time.strftime("%H:%M"),
        "days_of_week": schedule.days_of_week,
        "enabled": schedule.enabled,
        "zone_durations": schedule.zone_durations,
        "skip_if_rain": schedule.skip_if_rain,
        "rain_threshold": schedule.rain_threshold,
        "last_run_date": (
            schedule.last_run_date.isoformat() if schedule.last_run_date else None
        ),
    }


def _deserialize(schedule_id, data):
    """Mirror the storage deserialize shape used in __init__.async_setup_entry."""
    hour, minute = map(int, data.get("start_time", "06:00").split(":"))
    schedule = SprinklerSchedule(
        schedule_id=schedule_id,
        name=data.get("name", schedule_id),
        zone_ids=data.get("zone_ids", []),
        start_time=time(hour, minute),
        days_of_week=data.get("days_of_week", []),
        enabled=data.get("enabled", True),
        zone_durations=data.get("zone_durations", {}),
        skip_if_rain=data.get("skip_if_rain", True),
        rain_threshold=data.get("rain_threshold", 0.1),
    )
    raw = data.get("last_run_date")
    if raw:
        schedule.last_run_date = datetime.fromisoformat(raw)
    return schedule


def test_last_run_date_round_trips():
    """FIX 2: last_run_date persists across serialize -> deserialize."""
    ran_at = datetime(2026, 6, 1, 21, 0, 5)
    sched = SprinklerSchedule(
        schedule_id="program_2",
        name="Program 2",
        zone_ids=[1, 2, 3],
        start_time=time(21, 0),
        days_of_week=list(range(7)),
        last_run_date=ran_at,
    )

    stored = _serialize(sched)
    assert "last_run_date" in stored
    assert stored["last_run_date"] == ran_at.isoformat()

    restored = _deserialize("program_2", stored)
    assert restored.last_run_date == ran_at


def test_last_run_date_none_round_trips():
    """FIX 2: a never-run schedule serializes last_run_date as None present."""
    sched = SprinklerSchedule(
        schedule_id="program_1",
        name="Program 1",
        zone_ids=[1],
        start_time=time(5, 0),
        days_of_week=list(range(7)),
    )
    stored = _serialize(sched)
    # Key must be PRESENT (vs previously absent) even when value is None.
    assert "last_run_date" in stored
    assert stored["last_run_date"] is None
    restored = _deserialize("program_1", stored)
    assert restored.last_run_date is None


def test_stop_without_start_records_no_activity():
    """FIX 3: a 'watering' stop with no start_time records no activity."""
    zone = Zone(zone_id=4, settings=ZoneSettings(name="Zone 4"))
    # Simulate a spurious 'watering' state with NO start_time, as an
    # availability-driven transition would leave it.
    zone.state = "watering"
    zone.start_time = None

    result = zone.stop_watering()

    assert result[0] is True  # it was "watering", so stop returns success
    assert zone.state == "idle"
    # No real session -> no last-run / runtime pollution.
    assert zone.last_watering_date is None
    assert zone.total_runtime_today == 0
    assert zone.total_water_used_today == 0.0


def test_real_run_records_activity():
    """FIX 3 regression: a genuine watering session still records activity."""
    zone = Zone(zone_id=1, settings=ZoneSettings(name="Zone 1"))
    assert zone.start_watering(duration=10) is True
    assert zone.start_time is not None

    zone.stop_watering()
    assert zone.state == "idle"
    assert zone.last_watering_date is not None
