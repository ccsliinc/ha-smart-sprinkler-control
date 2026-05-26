"""Precipitation history API for Smart Sprinkler Control."""

import logging
from datetime import timedelta
from typing import Any, Dict

from aiohttp import web
from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

# Device classes that identify a precipitation rate/amount sensor.
# Modern OpenWeatherMap rain/snow sensors report "precipitation_intensity";
# some integrations use the plain "precipitation" class.
PRECIP_DEVICE_CLASSES = ("precipitation", "precipitation_intensity")

# State values that mean "no usable reading" for a precipitation sensor.
_INVALID_STATES = ("unknown", "unavailable", None)


def _discover_precip_unit(hass: HomeAssistant, sensors: list[str]) -> str:
    """Return the precipitation display unit from a discovered sensor.

    Description:
        Reads ``unit_of_measurement`` from the first sensor with a usable
        value, strips a trailing ``/h`` (so ``in/h`` -> ``in``, ``mm/h`` ->
        ``mm``). Falls back to ``"in"`` when nothing reports a unit so the
        frontend always has a label to render.
    Inputs:
        hass: Home Assistant instance.
        sensors: Entity ids of precipitation sensors (rain + snow).
    Outputs:
        str — display unit ("in" or "mm"), default "in".
    """
    for eid in sensors:
        state = hass.states.get(eid)
        if state is None:
            continue
        unit = state.attributes.get("unit_of_measurement")
        if not unit:
            continue
        unit = str(unit).strip()
        if unit.endswith("/h"):
            unit = unit[:-2]
        unit = unit.strip()
        if unit:
            return unit
    return "in"


def _current_rain_rate(hass: HomeAssistant, rain_sensors: list[str]) -> float:
    """Return the current combined rain intensity from rain sensors.

    Description:
        Reads the live state of each discovered rain sensor and sums their
        instantaneous intensity (rate) values. Used to decide whether it is
        *currently* raining (for auto rain-delay). Snow sensors are excluded
        so snow does not trigger a rain delay.
    Inputs:
        hass: Home Assistant instance.
        rain_sensors: Entity ids of rain intensity sensors.
    Outputs:
        float — summed current rain rate (sensor's native unit, mm/h or in/h);
        0.0 when no valid readings.
    """
    total = 0.0
    for eid in rain_sensors:
        state = hass.states.get(eid)
        if state is None or state.state in _INVALID_STATES:
            continue
        try:
            total += float(state.state)
        except (ValueError, TypeError):
            continue
    return round(total, 4)


async def compute_precipitation_totals(hass: HomeAssistant) -> Dict[str, Any]:
    """Compute precipitation accumulation totals and current rain rate.

    Description:
        Single source of truth for precipitation math. Discovers precip
        sensors, integrates recorder intensity history into 24 hourly buckets
        (rate * elapsed-hours), and sums them into ``today_total`` and
        ``total_24h``. Also samples the live rain-sensor states for the current
        rain rate. Both the HTTP history endpoint and the weather/rain-delay
        services consume this so the displayed and gating numbers always match.
    Inputs:
        hass: Home Assistant instance.
    Outputs:
        dict with keys:
            hourly: list[{hour, rain, snow, total}] (oldest first)
            today_total: float (inches/mm since local midnight, 2dp)
            total_24h: float (last-24h accumulation, 2dp)
            current_rate: float (live combined rain intensity, 4dp)
            sensors: {"rain": [...], "snow": [...]}
    Example:
        totals = await compute_precipitation_totals(hass)
        if totals["total_24h"] >= 0.1: skip_watering()
    """
    rain_sensors, snow_sensors = discover_precipitation_sensors(hass)
    all_sensors = rain_sensors + snow_sensors

    current_rate = _current_rain_rate(hass, rain_sensors)
    unit = _discover_precip_unit(hass, all_sensors)

    if not all_sensors:
        return {
            "hourly": [],
            "today_total": 0.0,
            "total_24h": 0.0,
            "current_rate": current_rate,
            "unit": unit,
            "sensors": {"rain": rain_sensors, "snow": snow_sensors},
        }

    # ALL time handling uses HA's configured local timezone via dt_util so the
    # recorder window, the hourly bucket labels, and the "today" cutoff share
    # one consistent TZ. (The recorder normalizes tz-aware datetimes to UTC.)
    end_time = dt_util.now()
    start_time = end_time - timedelta(hours=24)

    try:
        recorder = get_instance(hass)
        history = await recorder.async_add_executor_job(
            get_significant_states,
            hass,
            start_time,
            end_time,
            all_sensors,
            None,  # filters
            True,  # include_start_time_state
            True,  # significant_changes_only
            False,  # no_attributes
        )
    except Exception as e:  # noqa: BLE001 - recorder may be unavailable in tests
        _LOGGER.warning("Could not get history from recorder: %s", e)
        history = {}

    # Build 24 hourly buckets keyed by the date-aware local hour (truncated to
    # the top of the hour). Keying by the full local datetime keeps today's
    # 05:00 distinct from yesterday's 05:00 for a correct today_total.
    current_hour = end_time.replace(minute=0, second=0, microsecond=0)
    bucket_hours = [current_hour - timedelta(hours=23 - i) for i in range(24)]
    hourly_data = {
        hour_dt: {"rain": 0.0, "snow": 0.0, "total": 0.0} for hour_dt in bucket_hours
    }

    # Integrate intensity (mm/h or in/h) over time into accumulation.
    for entity_id, states in history.items():
        precip_type = "snow" if "snow" in entity_id else "rain"
        prev_state = None
        prev_time = None

        for state in states:
            try:
                value = (
                    float(state.state) if state.state not in _INVALID_STATES else 0.0
                )
            except (ValueError, TypeError):
                value = 0.0

            # Recorder stores last_updated in UTC; convert to local hour-of-day.
            state_time = dt_util.as_local(state.last_updated)

            if prev_state is not None and prev_time is not None:
                duration_hours = (state_time - prev_time).total_seconds() / 3600
                accumulation = prev_state * duration_hours
                bucket = prev_time.replace(minute=0, second=0, microsecond=0)
                if bucket in hourly_data:
                    hourly_data[bucket][precip_type] += accumulation
                    hourly_data[bucket]["total"] += accumulation

            prev_state = value
            prev_time = state_time

    hourly_list = []
    total_24h = 0.0
    today_total = 0.0
    midnight = dt_util.start_of_local_day()

    for hour_dt in bucket_hours:
        data = hourly_data[hour_dt]
        hourly_list.append(
            {
                "hour": hour_dt.strftime("%H:00"),
                "rain": round(data["rain"], 2),
                "snow": round(data["snow"], 2),
                "total": round(data["total"], 2),
            }
        )
        total_24h += data["total"]
        if hour_dt >= midnight:
            today_total += data["total"]

    return {
        "hourly": hourly_list,
        "today_total": round(today_total, 2),
        "total_24h": round(total_24h, 2),
        "current_rate": current_rate,
        "unit": unit,
        "sensors": {"rain": rain_sensors, "snow": snow_sensors},
    }


def discover_precipitation_sensors(hass: HomeAssistant) -> tuple[list[str], list[str]]:
    """Discover rain and snow precipitation sensors.

    Primary match is by device_class (robust across integrations); a
    name-based match (``openweathermap`` + ``intensity``) is kept as a
    fallback for back-compat with the original brittle discovery.

    Args:
        hass: Home Assistant instance.

    Returns:
        Tuple of (rain_sensor_ids, snow_sensor_ids). Snow is classified
        by "snow" appearing in the entity_id or friendly name; everything
        else is treated as rain.
    """
    rain_sensors: list[str] = []
    snow_sensors: list[str] = []

    for eid in hass.states.async_entity_ids("sensor"):
        state = hass.states.get(eid)
        if state is None:
            continue

        device_class = state.attributes.get("device_class")
        by_device_class = device_class in PRECIP_DEVICE_CLASSES
        by_name = "openweathermap" in eid and "intensity" in eid

        if not (by_device_class or by_name):
            continue

        name = str(state.attributes.get("friendly_name", "")).lower()
        if "snow" in eid or "snow" in name:
            snow_sensors.append(eid)
        else:
            rain_sensors.append(eid)

    return rain_sensors, snow_sensors


class PrecipitationAPI:
    """API for fetching precipitation history data."""

    def __init__(self, hass: HomeAssistant):
        """Initialize the API."""
        self.hass = hass

    async def get_precipitation_history(self, request: web.Request) -> web.Response:
        """Get precipitation history for the last 24 hours.

        Returns hourly precipitation totals from rain and snow
        intensity sensors. Delegates the math to
        ``compute_precipitation_totals`` so the endpoint and the rain-delay
        services share a single source of truth.
        """
        try:
            totals = await compute_precipitation_totals(self.hass)

            if not (totals["sensors"]["rain"] or totals["sensors"]["snow"]):
                return web.json_response(
                    {
                        "error": "No precipitation sensors found",
                        "hourly": [],
                        "today_total": 0,
                        "total_24h": 0,
                        "unit": totals.get("unit", "in"),
                    }
                )

            # current_rate is internal to gating decisions; the frontend
            # contract is hourly/today_total/total_24h/unit/sensors.
            return web.json_response(
                {
                    "hourly": totals["hourly"],
                    "today_total": totals["today_total"],
                    "total_24h": totals["total_24h"],
                    "unit": totals.get("unit", "in"),
                    "sensors": totals["sensors"],
                }
            )

        except Exception as e:
            _LOGGER.exception("Error fetching precipitation history: %s", e)
            return web.json_response(
                {
                    "error": str(e),
                    "hourly": [],
                    "today_total": 0,
                    "total_24h": 0,
                    "unit": "in",
                },
                status=500,
            )
