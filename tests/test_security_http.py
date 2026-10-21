"""Security tests for the Smart Sprinkler Control HTTP surface.

Covers the two unauthenticated-endpoint findings:

- The panel bundle used to be served by a hand-rolled view that joined a
  client-supplied ``{filename}`` onto the dist directory with pathlib. pathlib
  discards the base directory when the right operand is absolute, so
  ``GET /api/smart_sprinkler_control/frontend/%2Fconfig%2Fsecrets.yaml``
  returned any UTF-8 file the HA process could read. Home Assistant core's
  ``security_filter`` middleware blocks ``../`` but not the absolute form.
- ``PrecipitationHistoryView`` set ``requires_auth = False`` on an endpoint that
  returns precipitation-sensor entity ids plus 24h recorder history and runs an
  unbounded recorder query per request.

Every test here carries a POSITIVE CONTROL: it asserts that the legitimate
request still works alongside the malicious one. Without that, a harness fault
(a mocked ``aiohttp.web``, an unregistered route) would make every "attack
blocked" assertion pass for the wrong reason.
"""

from http import HTTPStatus
from pathlib import Path

import pytest
from homeassistant.components.http import HomeAssistantView
from homeassistant.setup import async_setup_component

from custom_components.smart_sprinkler_control.api.http import (
    FRONTEND_DIST_PATH,
    FRONTEND_STATIC_URL,
    PrecipitationHistoryView,
    async_register_http_views,
)

PANEL_JS = "smart-sprinkler-control-panel.js"

# The exact payloads from the finding. The first is the absolute-path form that
# defeated the pathlib join; the rest are the percent-encoded and traversal
# variants. ``/config/.storage/auth`` is the real prize - it holds refresh
# tokens, i.e. full Home Assistant takeover.
ESCAPE_PAYLOADS = [
    "/config/secrets.yaml",
    "%2Fconfig%2Fsecrets.yaml",
    "%2Fconfig%2F.storage%2Fauth",
    "/etc/passwd",
    "%2Fetc%2Fpasswd",
    "../../../../etc/passwd",
    "..%2F..%2F..%2F..%2Fetc%2Fpasswd",
    "....//....//....//etc/passwd",
]


@pytest.fixture
async def http_registered(hass):
    """Register the integration's HTTP surface on a running hass.

    Inputs:
        hass: Home Assistant test instance.
    Outputs:
        None - the static path and precipitation view are registered.
    """
    assert await async_setup_component(hass, "http", {})
    await async_register_http_views(hass)
    await hass.async_block_till_done()


async def test_panel_asset_still_served(hass, hass_client_no_auth, http_registered):
    """POSITIVE CONTROL: the panel bundle is reachable without auth.

    Static frontend assets are *meant* to be unauthenticated - the browser
    loads panel JS with a plain module fetch that carries no HA auth header.
    Requiring auth here would break panel loading for every user. This test
    exists so the containment tests below cannot pass by serving nothing at all.
    """
    client = await hass_client_no_auth()
    resp = await client.get(f"{FRONTEND_STATIC_URL}/{PANEL_JS}")

    assert resp.status == HTTPStatus.OK
    body = await resp.text()
    assert "SmartSprinklerControlPanel" in body


@pytest.mark.parametrize("payload", ESCAPE_PAYLOADS)
async def test_asset_route_cannot_read_outside_dist(
    hass, hass_client_no_auth, http_registered, tmp_path, payload
):
    """No absolute or encoded path escapes the frontend dist directory.

    Asserts on CONTENT, not only on status: a body that contains the secret
    would be the vulnerability regardless of what status code accompanied it.
    """
    client = await hass_client_no_auth()
    resp = await client.get(f"{FRONTEND_STATIC_URL}/{payload}")

    assert (
        resp.status != HTTPStatus.OK
    ), f"{payload!r} was served with 200 - the asset route is not contained"

    body = await resp.text()
    for marker in ("root:", "refresh_token", "secret", "BEGIN"):
        assert marker not in body, f"{payload!r} leaked file content ({marker!r})"


async def test_absolute_path_join_no_longer_reachable(
    hass, hass_client_no_auth, http_registered, tmp_path
):
    """A real secret file outside dist stays unreadable through the asset route.

    This is the finding reproduced end to end: write a file with known contents
    outside the dist directory, then ask for it by absolute path. The old
    hand-rolled view returned it, because ``Path(dist) / "/abs/path"`` is
    ``/abs/path``.
    """
    secret = tmp_path / "secrets.yaml"
    secret.write_text("api_token: SENTINEL_DO_NOT_LEAK\n", encoding="utf-8")

    # Sanity-check the premise of the old bug, so this test documents why the
    # rewrite (rather than a containment patch on the join) was necessary.
    assert Path(str(FRONTEND_DIST_PATH)) / str(secret) == secret

    client = await hass_client_no_auth()
    for variant in (str(secret), str(secret).replace("/", "%2F")):
        resp = await client.get(f"{FRONTEND_STATIC_URL}/{variant}")
        assert resp.status != HTTPStatus.OK
        assert "SENTINEL_DO_NOT_LEAK" not in await resp.text()


async def test_old_handrolled_asset_view_is_gone():
    """The unauthenticated file-serving view no longer exists in the module.

    A containment fix layered on top of the old view would still leave a
    hand-rolled, unauthenticated, event-loop-blocking file reader in the tree.
    The fix was to delete it, so assert the deletion.
    """
    import ast

    from custom_components.smart_sprinkler_control.api import http as http_mod

    assert not hasattr(http_mod, "SmartSprinklerControlFrontendView")

    # Parse rather than grep: this module's own comments mention
    # "requires_auth = False" to warn against reintroducing it, and a text
    # search cannot tell a warning from the real thing.
    tree = ast.parse(Path(http_mod.__file__).read_text(encoding="utf-8"))
    for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
        for stmt in cls.body:
            if not isinstance(stmt, ast.Assign):
                continue
            names = [t.id for t in stmt.targets if isinstance(t, ast.Name)]
            if "requires_auth" in names:
                assert (
                    stmt.value.value is not False
                ), f"{cls.name} disables authentication"


async def test_panel_registration_url_is_actually_served(
    hass, hass_client_no_auth, http_registered
):
    """END TO END: the URL the panel registration hands the browser resolves.

    The asset route moved, so the one thing that must not break is the link
    between the panel's js_url and the static path that serves it. This test
    asserts on what a user's browser actually requests: it registers the panel,
    reads the js_url out of Home Assistant's own panel registry, and fetches
    exactly that, cache-busting query string included. A test that only probed
    a hand-written path would still pass if the two sides disagreed.
    """
    from homeassistant.components import frontend

    from custom_components.smart_sprinkler_control.frontend.panel import (
        async_register_panel,
    )

    # The `frontend` COMPONENT is not set up here: it needs the compiled
    # hass_frontend package, which the test harness does not ship.
    # async_register_built_in_panel only writes the panel registry in
    # hass.data, which is exactly the registry the browser's config is built
    # from, so registering directly tests the real code path.
    await async_register_panel(hass)
    await hass.async_block_till_done()

    panel = hass.data[frontend.DATA_PANELS]["smart-sprinkler-control"]
    js_url = panel.config["_panel_custom"]["js_url"]

    assert js_url.startswith(f"{FRONTEND_STATIC_URL}/"), js_url
    assert "?v=" in js_url, "lost the cache-buster"

    client = await hass_client_no_auth()
    resp = await client.get(js_url)

    assert resp.status == HTTPStatus.OK, f"panel JS 404s at {js_url}"
    body = await resp.text()
    assert "SmartSprinklerControlPanel" in body
    # The real bundle, not an error page.
    assert len(body) > 50_000, f"served only {len(body)} bytes"

    # Non-admins must still get the panel: the gating is at the service layer.
    assert panel.require_admin is False


async def test_precipitation_endpoint_requires_auth(
    hass, hass_client_no_auth, http_registered
):
    """The precipitation data endpoint rejects an unauthenticated request."""
    assert PrecipitationHistoryView.requires_auth is True
    assert HomeAssistantView.requires_auth is True

    client = await hass_client_no_auth()
    resp = await client.get("/api/smart_sprinkler_control/precipitation")

    assert resp.status == HTTPStatus.UNAUTHORIZED
    body = await resp.text()
    assert "hourly" not in body
    assert "sensors" not in body


async def test_precipitation_endpoint_served_when_authenticated(
    hass, hass_client, http_registered
):
    """POSITIVE CONTROL: an authenticated request reaches the handler.

    Proves the 401 above comes from the auth layer and not from a missing
    route, and that the panel (which calls this through ``hass.callApi`` with
    the viewer's token) still works.
    """
    client = await hass_client()
    resp = await client.get("/api/smart_sprinkler_control/precipitation")

    assert resp.status != HTTPStatus.UNAUTHORIZED
    assert resp.status != HTTPStatus.NOT_FOUND


async def test_registration_is_idempotent(hass, http_registered):
    """Registering twice does not raise.

    ``async_register_static_paths`` raises on a duplicate URL, and a config
    entry reload calls the registration path again (neither a view nor a static
    path can be removed), so the run-scoped guard has to hold.
    """
    await async_register_http_views(hass)
    await async_register_http_views(hass)
    await hass.async_block_till_done()


async def test_no_blocking_filesystem_call_in_async_handlers():
    """No async handler in the api package touches the filesystem inline.

    The deleted view called ``Path.exists()`` and ``Path.read_text()`` inside an
    async handler, blocking the event loop on every panel load.
    """
    import ast

    api_dir = Path(
        Path(__file__).resolve().parents[1]
        / "custom_components"
        / "smart_sprinkler_control"
        / "api"
    )
    blocking = {"exists", "read_text", "read_bytes", "open", "stat", "is_file"}
    offenders = []

    for path in sorted(api_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, ast.AsyncFunctionDef):
                continue
            for node in ast.walk(fn):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in blocking
                ):
                    offenders.append(f"{path.name}:{node.lineno} {node.func.attr}()")

    assert not offenders, f"blocking filesystem calls in async handlers: {offenders}"


async def test_precipitation_errors_do_not_leak_exception_text():
    """The 500 path returns a generic message, not ``str(e)``."""
    precip_source = Path(
        Path(__file__).resolve().parents[1]
        / "custom_components"
        / "smart_sprinkler_control"
        / "api"
        / "precipitation.py"
    ).read_text(encoding="utf-8")

    assert '"error": str(e)' not in precip_source
    assert '"error": "Could not load precipitation history"' in precip_source
