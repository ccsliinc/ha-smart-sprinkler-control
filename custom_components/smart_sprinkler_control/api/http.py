"""HTTP views for Smart Sprinkler Control frontend."""

import logging
from pathlib import Path

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


class SmartSprinklerControlFrontendView(HomeAssistantView):
    """View to serve Smart Sprinkler Control frontend files."""

    requires_auth = False
    url = "/api/smart_sprinkler_control/frontend/{filename}"
    name = "api:smart_sprinkler_control:frontend"

    def __init__(self, hass: HomeAssistant):
        """Initialize the view.

        Args:
            hass: Home Assistant instance
        """
        self.hass = hass
        self.frontend_path = Path(__file__).parent.parent / "frontend" / "dist"

    async def get(self, request: web.Request, filename: str) -> web.Response:
        """Serve frontend files.

        Args:
            request: HTTP request
            filename: Requested filename

        Returns:
            HTTP response with file content
        """
        try:
            file_path = self.frontend_path / filename

            if not file_path.exists():
                _LOGGER.error("Frontend file not found: %s", file_path)
                return web.Response(text=f"File not found: {filename}", status=404)

            content = await self.hass.async_add_executor_job(
                lambda: file_path.read_text(encoding="utf-8")
            )

            content_type = "application/javascript"
            if filename.endswith(".css"):
                content_type = "text/css"
            elif filename.endswith(".html"):
                content_type = "text/html"
            elif filename.endswith(".map"):
                content_type = "application/json"

            _LOGGER.debug("Serving frontend file: %s", filename)

            return web.Response(
                text=content,
                content_type=content_type,
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

        except Exception as e:
            _LOGGER.error("Error serving frontend file %s: %s", filename, e)
            return web.Response(text=f"Error serving file: {e}", status=500)


async def async_register_http_views(hass: HomeAssistant) -> None:
    """Register HTTP views for Smart Sprinkler Control.

    Args:
        hass: Home Assistant instance
    """
    _LOGGER.debug("Registering Smart Sprinkler Control HTTP views")
    hass.http.register_view(SmartSprinklerControlFrontendView(hass))
    _LOGGER.info("Smart Sprinkler Control HTTP views registered")


async def async_unregister_http_views(hass: HomeAssistant) -> None:
    """Unregister HTTP views for Smart Sprinkler Control.

    Args:
        hass: Home Assistant instance
    """
    _LOGGER.debug("Unregistering Smart Sprinkler Control HTTP views")
    _LOGGER.info("Smart Sprinkler Control HTTP views unregistered")
