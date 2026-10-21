"""Security tests for the Smart Sprinkler Control service layer.

Two findings are covered, and the split between them is deliberate:

- NO ADMIN GATING: all ten services were registered with
  ``hass.services.async_register``, so any logged-in user could rewrite zone
  settings and schedules. Only the three CONFIGURATION MUTATORS are gated. The
  seven OPERATIONAL services stay open on purpose - this is a household
  irrigation system and non-admin family members must still be able to run
  their sprinklers. A test asserts that too, so a future "harden everything"
  change cannot quietly lock them out.
- CONFUSED DEPUTY: the integration relayed to ``switch.turn_on`` with a FRESH
  context, so Home Assistant evaluated the integration's authority instead of
  the caller's and the per-entity control policy never reached the valve.
  Operational services being open is only safe BECAUSE the caller's context is
  forwarded, which makes these two tests a matched pair.
"""

import ast
from pathlib import Path

import pytest
from homeassistant.core import Context, HomeAssistant, ServiceCall
from homeassistant.exceptions import Unauthorized

from custom_components.smart_sprinkler_control import _register_services
from custom_components.smart_sprinkler_control.const import DOMAIN
from custom_components.smart_sprinkler_control.models.zone import SprinklerSystem

ADMIN_ONLY_SERVICES = ("update_zone_settings", "create_schedule", "delete_schedule")

OPERATIONAL_SERVICES = (
    "start_zone",
    "stop_zone",
    "stop_all_zones",
    "adjust_zone_time",
    "enable_rain_delay",
    "disable_rain_delay",
    "run_schedule",
)

SYSTEM_ENTITY_ID = "sensor.test_sprinkler_system"
ZONE_SWITCH = "switch.zone_1_valve"

# Minimal valid payload per service, so the voluptuous schema passes and the
# call reaches the permission check rather than failing validation first.
SERVICE_PAYLOADS = {
    "start_zone": {"zone_id": 1, "duration": 10},
    "stop_zone": {"zone_id": 1},
    "stop_all_zones": {},
    "adjust_zone_time": {"zone_id": 1, "duration": 10},
    "enable_rain_delay": {"hours": 6},
    "disable_rain_delay": {},
    "run_schedule": {"schedule_id": "sched_1"},
    "update_zone_settings": {"zone_id": 1, "name": "Front Lawn"},
    "create_schedule": {
        "schedule_id": "sched_1",
        "name": "Morning",
        "zone_ids": [1],
        "start_time": "06:00",
        "days_of_week": [1],
    },
    "delete_schedule": {"schedule_id": "sched_1"},
}


def _payload(service: str) -> dict:
    """Return the full service payload including the required entity_id.

    Inputs:
        service: Service name.
    Outputs:
        dict - call data for hass.services.async_call.
    """
    return {"entity_id": SYSTEM_ENTITY_ID, **SERVICE_PAYLOADS[service]}


@pytest.fixture
async def sprinkler_services(hass: HomeAssistant):
    """Register the services against a minimal in-memory system.

    Inputs:
        hass: Home Assistant test instance.
    Outputs:
        SprinklerSystem - the system the services operate on.
    """
    system = SprinklerSystem(
        system_name="Test Sprinkler System",
        entity_id=SYSTEM_ENTITY_ID,
        zone_count=1,
    )
    system.add_zone(1, name="Zone 1", switch_entity=ZONE_SWITCH)

    hass.data[DOMAIN] = {"entry_1": {"system": system}, SYSTEM_ENTITY_ID: system}
    await _register_services(hass)
    await hass.async_block_till_done()
    return system


async def test_all_ten_services_are_registered(hass, sprinkler_services):
    """POSITIVE CONTROL: every service exists.

    Without this, the Unauthorized assertions below could pass simply because a
    service was never registered.
    """
    for service in ADMIN_ONLY_SERVICES + OPERATIONAL_SERVICES:
        assert hass.services.has_service(DOMAIN, service), f"{service} missing"

    assert len(ADMIN_ONLY_SERVICES) + len(OPERATIONAL_SERVICES) == 10


@pytest.mark.parametrize("service", ADMIN_ONLY_SERVICES)
async def test_config_mutators_reject_non_admin(
    hass, sprinkler_services, hass_read_only_user, service
):
    """The three configuration mutators refuse a non-admin caller."""
    with pytest.raises(Unauthorized):
        await hass.services.async_call(
            DOMAIN,
            service,
            _payload(service),
            blocking=True,
            context=Context(user_id=hass_read_only_user.id),
        )


@pytest.mark.parametrize("service", ADMIN_ONLY_SERVICES)
async def test_config_mutators_allow_admin(
    hass, sprinkler_services, hass_admin_user, service
):
    """POSITIVE CONTROL: an admin can still call the configuration mutators.

    Proves the Unauthorized above comes from the admin gate and not from a
    schema error or a missing system.
    """
    await hass.services.async_call(
        DOMAIN,
        service,
        _payload(service),
        blocking=True,
        context=Context(user_id=hass_admin_user.id),
    )


@pytest.mark.parametrize("service", OPERATIONAL_SERVICES)
async def test_operational_services_stay_open_to_non_admin(
    hass, sprinkler_services, hass_read_only_user, service
):
    """A non-admin household member can still operate the sprinklers.

    This is a product requirement, not an oversight. If a future change wraps
    these in async_register_admin_service, this test fails loudly instead of
    the panel silently breaking for every non-admin user in the house.
    """
    await hass.services.async_call(
        DOMAIN,
        service,
        _payload(service),
        blocking=True,
        context=Context(user_id=hass_read_only_user.id),
    )


async def test_relayed_switch_call_carries_caller_context(
    hass, sprinkler_services, hass_read_only_user
):
    """start_zone relays to switch.turn_on with the CALLER's context.

    This is the confused-deputy fix: Home Assistant can only apply the caller's
    entity permissions to the valve if the relayed call carries the caller's
    context. A fresh context makes the call look like it came from the
    integration itself, and the policy check never sees a user.
    """
    seen: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        """Stand in for the real switch domain and record the call."""
        seen.append(call)

    hass.services.async_register("switch", "turn_on", record)
    hass.services.async_register("switch", "turn_off", record)

    caller = Context(user_id=hass_read_only_user.id)
    await hass.services.async_call(
        DOMAIN, "start_zone", _payload("start_zone"), blocking=True, context=caller
    )
    await hass.async_block_till_done()

    assert seen, "start_zone did not relay to the switch domain at all"
    relayed = seen[-1]
    assert relayed.data["entity_id"] == ZONE_SWITCH
    assert relayed.context.user_id == hass_read_only_user.id, (
        "relayed call lost the caller's user_id - entity permissions on the "
        "valve would never be evaluated"
    )
    assert relayed.context.id == caller.id


async def test_every_handler_relay_forwards_context():
    """Static audit: no service handler relays with a fresh context.

    The runtime test above covers start_zone. This walks the AST so a relay
    added to any other handler later cannot silently reintroduce the bug: any
    ``hass.services.async_call`` lexically inside a ``handle_*`` function must
    pass ``context=call.context``.
    """
    source = Path(
        Path(__file__).resolve().parents[1]
        / "custom_components"
        / "smart_sprinkler_control"
        / "__init__.py"
    ).read_text(encoding="utf-8")

    offenders = []
    for fn in ast.walk(ast.parse(source)):
        if not isinstance(fn, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        if not fn.name.startswith("handle_"):
            continue
        for node in ast.walk(fn):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "async_call"
            ):
                continue
            ctx = next((k for k in node.keywords if k.arg == "context"), None)
            if ctx is None or ast.unparse(ctx.value) != "call.context":
                offenders.append(f"{fn.name}:{node.lineno}")

    assert not offenders, f"relays without the caller's context: {offenders}"


async def test_config_mutators_use_the_admin_helper():
    """Static audit: the three mutators are registered via the admin helper.

    Guards against the gate being removed by a future refactor that keeps the
    handlers but reverts to plain async_register.
    """
    source = Path(
        Path(__file__).resolve().parents[1]
        / "custom_components"
        / "smart_sprinkler_control"
        / "__init__.py"
    ).read_text(encoding="utf-8")
    tree = ast.parse(source)

    admin_registered = set()
    plain_registered = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = node.func.attr
        if name not in ("async_register_admin_service", "async_register"):
            continue
        # Service name is the 3rd positional arg for the admin helper and the
        # 2nd for hass.services.async_register.
        idx = 2 if name == "async_register_admin_service" else 1
        if len(node.args) <= idx:
            continue
        target = admin_registered if idx == 2 else plain_registered
        target.add(ast.unparse(node.args[idx]))

    for const_name in (
        "SERVICE_UPDATE_ZONE_SETTINGS",
        "SERVICE_CREATE_SCHEDULE",
        "SERVICE_DELETE_SCHEDULE",
    ):
        assert const_name in admin_registered, f"{const_name} is not admin-gated"
        assert const_name not in plain_registered
