"""Smart Sprinkler Control Custom Panel."""

import logging
import time

from homeassistant.components import frontend
from homeassistant.core import HomeAssistant

from ..const import VERSION

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "/smart-sprinkler-control-panel"
PANEL_TITLE = "Sprinkler Control"
PANEL_ICON = "mdi:sprinkler-variant"
PANEL_CONFIG_PANEL_DOMAIN = "smart_sprinkler_control_panel"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Register the Smart Sprinkler Control panel.

    Args:
        hass: Home Assistant instance
    """
    _LOGGER.debug("Registering Smart Sprinkler Control panel")

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
                    "js_url": f"/api/smart_sprinkler_control/frontend/"
                    f"smart-sprinkler-control-panel.js?v={VERSION}&t="
                    f"{int(time.time())}",
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
