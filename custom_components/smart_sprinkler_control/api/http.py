"""HTTP views and static frontend path for Smart Sprinkler Control."""

import logging
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.core import HomeAssistant

from ..const import DOMAIN
from .precipitation import PrecipitationAPI

_LOGGER = logging.getLogger(__name__)

# Public URL prefix the built panel bundle is served from.
#
# SECURITY: the panel bundle used to be served by a hand-rolled
# HomeAssistantView that joined a client-supplied `{filename}` onto the dist
# directory with pathlib. pathlib DISCARDS the base directory when the right
# operand is absolute (Path("/a/b") / "/etc/passwd" == Path("/etc/passwd")), so
# an absolute request path escaped the dist directory entirely and returned any
# UTF-8 file the Home Assistant process could read. HA core's security_filter
# middleware rejects "../" traversal but NOT the absolute form.
#
# Static assets are now served by HA's own static-path handler, which resolves
# the request against this root and refuses anything outside it, serves off the
# event loop, and needs no hand-written containment check.
FRONTEND_STATIC_URL = "/smart_sprinkler_control_static"

# On-disk directory that backs FRONTEND_STATIC_URL (the built panel bundle).
FRONTEND_DIST_PATH = Path(__file__).parent.parent / "frontend" / "dist"

# Key under hass.data holding run-scoped (not entry-scoped) registration flags.
# Static paths and views are process-wide and cannot be registered twice.
RUNTIME_DATA_KEY = f"{DOMAIN}_runtime"


class PrecipitationHistoryView(HomeAssistantView):
    """Authenticated view serving 24h precipitation history for the panel.

    SECURITY: this view exposes precipitation-sensor entity ids and recorder
    history, and runs a recorder query per request. It inherits
    ``HomeAssistantView.requires_auth = True`` deliberately - do NOT add a
    ``requires_auth = False`` override. The panel fetches it through
    ``hass.callApi``, which carries the viewer's Home Assistant auth token.
    """

    url = "/api/smart_sprinkler_control/precipitation"
    name = "api:smart_sprinkler_control:precipitation"

    def __init__(self, precip_api: PrecipitationAPI) -> None:
        """Initialize the view.

        Inputs:
            precip_api: PrecipitationAPI instance that performs the query.
        Outputs:
            None.
        """
        self._precip_api = precip_api

    async def get(self, request: web.Request) -> web.Response:
        """Handle GET request for precipitation history.

        Inputs:
            request: HTTP request (already authenticated by HA).
        Outputs:
            web.Response - JSON precipitation history payload.
        """
        return await self._precip_api.get_precipitation_history(request)


async def async_register_http_views(hass: HomeAssistant) -> None:
    """Register the static frontend path and the precipitation data API.

    Description:
        Registers, exactly once per Home Assistant run, the static path that
        serves the built panel bundle and the authenticated precipitation view.
        Both are process-wide: ``async_register_static_paths`` raises if the
        same URL is registered twice, and HA logs "View ... is already
        registered" for a duplicate view. A config-entry reload calls this
        again (the unload side cannot remove either), so the guard lives in a
        run-scoped ``hass.data`` namespace rather than per-entry data.
    Inputs:
        hass: Home Assistant instance.
    Outputs:
        None.
    """
    _LOGGER.debug("Registering Smart Sprinkler Control HTTP views")

    runtime = hass.data.setdefault(RUNTIME_DATA_KEY, {})

    if not runtime.get("static_path_registered"):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    FRONTEND_STATIC_URL,
                    str(FRONTEND_DIST_PATH),
                    # cache_headers=False: the panel URL is cache-busted with a
                    # content hash (see frontend/panel.py), so long-lived
                    # caching would only ever pin a stale bundle.
                    False,
                )
            ]
        )
        runtime["static_path_registered"] = True
        _LOGGER.info(
            "Registered Smart Sprinkler Control static path %s -> %s",
            FRONTEND_STATIC_URL,
            FRONTEND_DIST_PATH,
        )

    if not runtime.get("precipitation_view_registered"):
        hass.http.register_view(PrecipitationHistoryView(PrecipitationAPI(hass)))
        runtime["precipitation_view_registered"] = True
        _LOGGER.info("Smart Sprinkler Control HTTP views registered")


async def async_unregister_http_views(hass: HomeAssistant) -> None:
    """Note that HTTP views and static paths outlive the config entry.

    Description:
        Home Assistant has no public API to remove a registered view or static
        path, so both intentionally persist for the life of the process. The
        run-scoped flags in ``hass.data[RUNTIME_DATA_KEY]`` are left in place so
        a later entry setup does not attempt a duplicate registration.
    Inputs:
        hass: Home Assistant instance.
    Outputs:
        None.
    """
    _LOGGER.debug(
        "Smart Sprinkler Control HTTP views remain registered for this HA run"
    )
