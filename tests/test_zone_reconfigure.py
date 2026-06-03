"""Unit tests for live zone reconfiguration (add / remove / switch reassign).

Covers the model-level logic that the OptionsFlow + reload feature depends on:

- B3 add_zone: a new zone appears with the given name and switch.
- B3 remove_zone: the highest zone is removed AND purged from any schedule that
  referenced it (both ``zone_ids`` and ``zone_durations``), with no orphan refs.
- B3 reconcile_zones: growing/shrinking topology from config, with switch
  reassignment reflected on a surviving zone (mirrors what async_setup_entry
  applies after an OptionsFlow save + reload).

These import the plain dataclasses from models/zone.py directly via importlib,
so they need NO running Home Assistant instance (same pattern as the existing
tests in this directory).

DEFERRED (HA-harness coverage TODO): an end-to-end options-flow test using
pytest-homeassistant-custom-component (driving hass.config_entries.options
async_init/async_configure through all steps and asserting the entry reloads
with the new zones) is NOT included here because the dev venv does not have the
HA harness installed. The dependency IS already declared in
pyproject.toml [project.optional-dependencies].dev as
``pytest-homeassistant-custom-component>=0.13.0``; install the dev extra
(``pip install -e '.[dev]'``) to add that layer. The same end-to-end path was
instead exercised live against the dev container (see DEVELOPMENT notes).
"""

import importlib.util
from datetime import time
from pathlib import Path

ZONE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
    / "models"
    / "zone.py"
)

_spec = importlib.util.spec_from_file_location("ssc_zone", ZONE_PATH)
assert _spec and _spec.loader
zone_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(zone_mod)

SprinklerSystem = zone_mod.SprinklerSystem
SprinklerSchedule = zone_mod.SprinklerSchedule


def _make_system(zone_count: int = 6) -> "zone_mod.SprinklerSystem":
    """Build a system with N zones, each given a switch like a configured one."""
    system = SprinklerSystem(
        system_name="Test", entity_id="sensor.test", zone_count=zone_count
    )
    for zid, zone in system.zones.items():
        zone.settings.switch_entity = f"switch.sprinkler_{zid}"
    return system


def test_add_zone_creates_zone_with_name_and_switch():
    """(a) Increasing zone_count -> new zone exists with given name/switch."""
    system = _make_system(6)
    assert 7 not in system.zones

    zone = system.add_zone(7, name="New Patio", switch_entity="switch.sprinkler_7")

    assert 7 in system.zones
    assert system.zones[7] is zone
    assert zone.settings.name == "New Patio"
    assert zone.settings.switch_entity == "switch.sprinkler_7"
    assert system.zone_count == 7


def test_remove_zone_purges_schedule_references():
    """(b) Decreasing zone_count -> highest zone removed AND purged from schedule."""
    system = _make_system(6)
    # Schedule references zone 6 in both zone_ids and zone_durations.
    system.schedules["morning"] = SprinklerSchedule(
        schedule_id="morning",
        name="Morning",
        zone_ids=[1, 5, 6],
        start_time=time(6, 0),
        days_of_week=[0, 2, 4],
        zone_durations={1: 10, 5: 15, 6: 20},
    )

    removed = system.remove_zone(6)

    assert removed is True
    assert 6 not in system.zones
    assert system.zone_count == 5
    sched = system.schedules["morning"]
    # No orphan reference to the removed zone remains.
    assert 6 not in sched.zone_ids
    assert sched.zone_ids == [1, 5]
    assert 6 not in sched.zone_durations
    assert sched.zone_durations == {1: 10, 5: 15}


def test_remove_nonexistent_zone_is_noop():
    """Removing a zone that does not exist returns False and changes nothing."""
    system = _make_system(3)
    assert system.remove_zone(9) is False
    assert system.zone_count == 3
    assert set(system.zones) == {1, 2, 3}


def test_reconcile_grows_topology_with_names_and_switches():
    """reconcile_zones adds new zones with provided name/switch (string keys)."""
    system = _make_system(6)
    system.reconcile_zones(
        zone_count=7,
        zone_names={"7": "Greenhouse"},
        zone_switches={"7": "switch.sprinkler_7"},
    )
    assert set(system.zones) == {1, 2, 3, 4, 5, 6, 7}
    assert system.zone_count == 7
    assert system.zones[7].settings.name == "Greenhouse"
    assert system.zones[7].settings.switch_entity == "switch.sprinkler_7"


def test_reconcile_shrinks_and_purges_schedule():
    """reconcile_zones removes high zones and purges them from schedules."""
    system = _make_system(6)
    system.schedules["s"] = SprinklerSchedule(
        schedule_id="s",
        name="S",
        zone_ids=[4, 5, 6],
        start_time=time(6, 0),
        days_of_week=[0],
        zone_durations={4: 5, 5: 5, 6: 5},
    )
    system.reconcile_zones(zone_count=4, zone_names={}, zone_switches={})
    assert set(system.zones) == {1, 2, 3, 4}
    assert system.zone_count == 4
    sched = system.schedules["s"]
    assert sched.zone_ids == [4]
    assert sched.zone_durations == {4: 5}


def test_reconcile_reassigns_switch_on_surviving_zone():
    """(c) Reassigning a zone's switch updates switch_entity (post-reload model)."""
    system = _make_system(6)
    assert system.zones[3].settings.switch_entity == "switch.sprinkler_3"

    # Same topology, but zone 3 now driven by a different relay.
    system.reconcile_zones(
        zone_count=6,
        zone_names={},
        zone_switches={
            "1": "switch.sprinkler_1",
            "2": "switch.sprinkler_2",
            "3": "switch.sprinkler_99",
            "4": "switch.sprinkler_4",
            "5": "switch.sprinkler_5",
            "6": "switch.sprinkler_6",
        },
    )
    assert system.zones[3].settings.switch_entity == "switch.sprinkler_99"
    # Other zones unchanged.
    assert system.zones[1].settings.switch_entity == "switch.sprinkler_1"


def test_reconcile_preserves_surviving_zone_state():
    """Growing/shrinking preserves statistics on zones that survive."""
    system = _make_system(6)
    system.zones[2].total_runtime_today = 42
    system.reconcile_zones(zone_count=8, zone_names={}, zone_switches={})
    assert system.zones[2].total_runtime_today == 42
    assert set(system.zones) == {1, 2, 3, 4, 5, 6, 7, 8}
