"""Precipitation history API for Smart Sprinkler Control."""

import logging
from datetime import timedelta

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
        intensity sensors.
        """
        try:
            rain_sensors, snow_sensors = discover_precipitation_sensors(self.hass)

            _LOGGER.debug("Found rain sensors: %s", rain_sensors)
            _LOGGER.debug("Found snow sensors: %s", snow_sensors)

            all_sensors = rain_sensors + snow_sensors
            if not all_sensors:
                return web.json_response(
                    {
                        "error": "No precipitation sensors found",
                        "hourly": [],
                        "today_total": 0,
                        "total_24h": 0,
                    }
                )

            # Get history for last 24 hours.
            # ALL time handling uses HA's configured local timezone via
            # dt_util so the recorder query window, the hourly bucket labels,
            # and the "today" cutoff are computed in one consistent TZ.
            # (The recorder accepts tz-aware datetimes and normalizes to UTC
            # internally, so passing local-aware times is correct.)
            end_time = dt_util.now()
            start_time = end_time - timedelta(hours=24)

            # Try to get history from recorder
            try:
                recorder = get_instance(self.hass)
                history = await recorder.async_add_executor_job(
                    get_significant_states,
                    self.hass,
                    start_time,
                    end_time,
                    all_sensors,
                    None,  # filters
                    True,  # include_start_time_state
                    True,  # significant_changes_only
                    False,  # no_attributes
                )
            except Exception as e:
                _LOGGER.warning("Could not get history from recorder: %s", e)
                history = {}

            # Build 24 hourly buckets keyed by the *date-aware* local hour
            # (truncated to the top of the hour). Keying by the full local
            # datetime — rather than a bare "%H:00" string — keeps today's
            # 05:00 distinct from yesterday's 05:00, which is required to
            # compute today_total correctly near a day boundary.
            local_now = end_time  # already local-aware (dt_util.now())
            current_hour = local_now.replace(minute=0, second=0, microsecond=0)
            # Oldest bucket first so the output reads chronologically.
            bucket_hours = [current_hour - timedelta(hours=23 - i) for i in range(24)]
            hourly_data = {
                hour_dt: {"rain": 0, "snow": 0, "total": 0} for hour_dt in bucket_hours
            }

            # Calculate accumulation from history.
            # Intensity is in mm/h (or in/h), so integrate rate over time.
            for entity_id, states in history.items():
                is_snow = "snow" in entity_id
                precip_type = "snow" if is_snow else "rain"

                prev_state = None
                prev_time = None

                for state in states:
                    try:
                        invalid = ("unknown", "unavailable", None)
                        value = float(state.state) if state.state not in invalid else 0
                    except (ValueError, TypeError):
                        value = 0

                    # Recorder stores last_updated in UTC; convert to HA's
                    # local timezone so the bucket reflects local hour-of-day.
                    state_time = dt_util.as_local(state.last_updated)

                    if prev_state is not None and prev_time is not None:
                        # Rate * duration (hours) = accumulation.
                        elapsed = (state_time - prev_time).total_seconds()
                        duration_hours = elapsed / 3600
                        accumulation = prev_state * duration_hours

                        # Bucket by the date-aware local hour of the interval
                        # start. Skip intervals that fall outside the window.
                        bucket = prev_time.replace(minute=0, second=0, microsecond=0)
                        if bucket in hourly_data:
                            hourly_data[bucket][precip_type] += accumulation
                            hourly_data[bucket]["total"] += accumulation

                    prev_state = value
                    prev_time = state_time

            # Convert to list format for frontend.
            hourly_list = []
            total_24h = 0
            today_total = 0
            # Local midnight (start of today in HA's configured TZ) so the
            # today-window shares the same TZ as the bucket datetimes above.
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

                # Count toward today only if this bucket is on/after local midnight.
                if hour_dt >= midnight:
                    today_total += data["total"]

            return web.json_response(
                {
                    "hourly": hourly_list,
                    "today_total": round(today_total, 1),
                    "total_24h": round(total_24h, 1),
                    "sensors": {"rain": rain_sensors, "snow": snow_sensors},
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
                },
                status=500,
            )
