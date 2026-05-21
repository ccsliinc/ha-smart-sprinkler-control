"""Weather / rain-delay services for Smart Sprinkler Control.

Connects real precipitation data (from ``api.precipitation``) to two watering
behaviors:

1. Auto-skip a scheduled run when recent rainfall (24h accumulation) meets or
   exceeds the schedule's configured ``rain_threshold``.
2. Auto rain-delay while it is *currently* raining, auto-clearing when the rain
   stops — without ever clobbering a delay the user set manually.

Weather-based duration adjustment is intentionally out of scope and is gated
behind an off-by-default flag.
"""

import logging
from typing import Any, Dict, Tuple

from homeassistant.core import HomeAssistant

from ..api.precipitation import compute_precipitation_totals
from ..models.zone import SprinklerSchedule, SprinklerSystem

_LOGGER = logging.getLogger(__name__)

# Default 24h-accumulation threshold (inches) used when a schedule does not
# specify its own rain_threshold. Mirrors DEFAULT_RAIN_THRESHOLD in const.
DEFAULT_RAIN_THRESHOLD = 0.1

# Minimum current rain intensity (sensor's native unit, e.g. mm/h) that counts
# as "actively raining" for the auto rain-delay. Anything above 0 means rain is
# falling now; a tiny floor guards against sensor noise / float dust.
ACTIVE_RAIN_RATE_THRESHOLD = 0.0

# How long an auto rain-delay lasts before its timer would expire on its own.
# The auto logic re-evaluates every coordinator cycle and clears the delay as
# soon as the rain stops, so this is just a safety ceiling.
AUTO_RAIN_DELAY_HOURS = 24


class WeatherServices:
    """Service layer for rainfall-driven sprinkler control."""

    def __init__(self, hass: HomeAssistant, sprinkler_system: SprinklerSystem):
        """Initialize weather services.

        Inputs:
            hass: Home Assistant instance.
            sprinkler_system: The system whose rain delay this controls.
        """
        self.hass = hass
        self.system = sprinkler_system

    async def check_weather_conditions(self) -> Dict[str, Any]:
        """Read current precipitation conditions from the precip data source.

        Outputs:
            dict with:
                total_24h: float — accumulation over the last 24h.
                today_total: float — accumulation since local midnight.
                current_rate: float — live combined rain intensity.
                rain_detected: bool — True when currently raining.
                has_sensors: bool — whether any precip sensor was found.
        """
        totals = await compute_precipitation_totals(self.hass)
        sensors = totals.get("sensors", {"rain": [], "snow": []})
        has_sensors = bool(sensors.get("rain") or sensors.get("snow"))
        current_rate = totals.get("current_rate", 0.0)

        return {
            "total_24h": totals.get("total_24h", 0.0),
            "today_total": totals.get("today_total", 0.0),
            "current_rate": current_rate,
            "rain_detected": current_rate > ACTIVE_RAIN_RATE_THRESHOLD,
            "has_sensors": has_sensors,
        }

    async def async_should_skip_schedule(
        self, schedule: SprinklerSchedule
    ) -> Tuple[bool, str]:
        """Decide whether a scheduled run should be skipped due to recent rain.

        Description:
            Compares the configured per-schedule ``rain_threshold`` against the
            last-24h precipitation accumulation. Independent of the rain-delay
            flag (the caller still applies the manual rain-delay skip too).
        Inputs:
            schedule: The schedule about to run.
        Outputs:
            (skip: bool, reason: str). ``reason`` is empty when not skipping.
        Example:
            skip, why = await ws.async_should_skip_schedule(sched)
            if skip: notify(why)
        """
        if not schedule.skip_if_rain:
            return False, ""

        conditions = await self.check_weather_conditions()
        if not conditions["has_sensors"]:
            return False, ""

        threshold = schedule.rain_threshold or DEFAULT_RAIN_THRESHOLD
        total_24h = conditions["total_24h"]

        if total_24h >= threshold:
            reason = (
                f"{total_24h:.2f}in rain in last 24h " f"≥ {threshold:.2f}in threshold"
            )
            return True, reason

        return False, ""

    async def async_evaluate_auto_rain_delay(self) -> str:
        """Enable/clear the auto rain-delay based on current rain intensity.

        Description:
            Called every coordinator cycle. If it is currently raining and no
            delay is active, enables an *auto* rain delay. If an *auto* delay is
            active and the rain has stopped, clears it. Never touches a delay
            the user set manually.
        Outputs:
            str — one of "enabled", "cleared", "noop" describing what happened.
        """
        conditions = await self.check_weather_conditions()
        if not conditions["has_sensors"]:
            return "noop"

        raining_now = conditions["rain_detected"]
        rate = conditions["current_rate"]

        if raining_now:
            # Only enable if nothing is already delaying. enable_rain_delay with
            # auto=True is a no-op when a manual delay is already active.
            if not self.system.rain_delay_active:
                self.system.enable_rain_delay(AUTO_RAIN_DELAY_HOURS, auto=True)
                _LOGGER.info(
                    "Auto rain-delay ENABLED: currently raining (%.3f intensity)",
                    rate,
                )
                return "enabled"
            return "noop"

        # Not raining now: clear ONLY an auto delay (manual is protected).
        if self.system.rain_delay_active and self.system.auto_rain_delay:
            cleared = self.system.disable_rain_delay(auto=True)
            if cleared:
                _LOGGER.info("Auto rain-delay CLEARED: rain has stopped")
                return "cleared"
        return "noop"
