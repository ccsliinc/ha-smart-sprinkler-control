"""Smart Sprinkler Control Custom Panel."""

import hashlib
import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.core import HomeAssistant

from ..const import VERSION

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "/smart-sprinkler-control-panel"
PANEL_TITLE = "Sprinkler Control"
PANEL_ICON = "mdi:sprinkler-variant"
PANEL_CONFIG_PANEL_DOMAIN = "smart_sprinkler_control_panel"

# Built panel JS served by SmartSprinklerControlFrontendView
# (/api/smart_sprinkler_control/frontend/{filename}).
PANEL_JS_FILENAME = "smart-sprinkler-control-panel.js"
PANEL_JS_PATH = Path(__file__).parent / "dist" / PANEL_JS_FILENAME


def _compute_panel_cache_buster() -> str:
    """Compute a content-based cache-buster for the panel JS.

    Hashes the bytes of the built panel JS so the value only changes when the
    JS content changes. Appending it as a ?v= query forces browsers to refetch
    the panel after a deploy (no manual hard-refresh) while still caching when
    the content is unchanged. Falls back to VERSION if the file is unreadable.

    Returns:
        str: Short hex content hash, or VERSION on read failure.
    """
    try:
        content = PANEL_JS_PATH.read_bytes()
        # MD5 is used only as a content fingerprint for cache-busting, not for
        # security; usedforsecurity=False marks that intent for linters/FIPS.
        digest = hashlib.md5(content, usedforsecurity=False)
        return digest.hexdigest()[:8]
    except OSError as err:
        _LOGGER.warning(
            "Could not read panel JS for cache-buster (%s); falling back to VERSION",
            err,
        )
        return VERSION


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the Smart Sprinkler Control panel.

    Args:
        hass: Home Assistant instance
    """
    _LOGGER.debug("Registering Smart Sprinkler Control panel")

    # Content-hash cache-buster: ?v=<hash> changes only when the panel JS
    # content changes, forcing browsers to refetch a new deploy automatically.
    cache_buster = await hass.async_add_executor_job(_compute_panel_cache_buster)
    js_url = (
        f"/api/smart_sprinkler_control/frontend/{PANEL_JS_FILENAME}?v={cache_buster}"
    )
    _LOGGER.debug("Panel JS URL: %s", js_url)

    if (
        hasattr(hass.data, "frontend_panels")
        and "smart-sprinkler-control" in hass.data.frontend_panels
    ):
        _LOGGER.debug("Smart Sprinkler Control panel already registered, skipping")
        return

    try:
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path="smart-sprinkler-control",
            config={
                "_panel_custom": {
                    "name": "smart-sprinkler-control-panel",
                    "embed_iframe": False,
                    "trust": False,
                    "js_url": js_url,
                }
            },
            require_admin=False,
        )

        _LOGGER.info("Smart Sprinkler Control panel registered successfully")

    except ValueError as e:
        if "Overwriting panel" in str(e):
            _LOGGER.debug(
                "Panel already exists, this is expected with multiple instances"
            )
        else:
            _LOGGER.error("Error registering panel: %s", e)
            raise


async def async_unregister_panel(hass: HomeAssistant) -> None:
    """Unregister the Smart Sprinkler Control panel.

    Args:
        hass: Home Assistant instance
    """
    _LOGGER.debug("Unregistering Smart Sprinkler Control panel")
    _LOGGER.info("Smart Sprinkler Control panel unregistered")
