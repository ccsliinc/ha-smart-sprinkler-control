"""Precipitation history API for Smart Sprinkler Control."""

import logging
from datetime import datetime, timedelta

from aiohttp import web
from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.history import get_significant_states
from homeassistant.core import HomeAssistant

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

            # Get history for last 24 hours
            end_time = datetime.now()
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

            # Process history into hourly buckets
            hourly_data = {}
            for hour in range(24):
                hour_start = end_time - timedelta(hours=24 - hour)
                hour_key = hour_start.strftime("%H:00")
                hourly_data[hour_key] = {"rain": 0, "snow": 0, "total": 0}

            # Calculate accumulation from history
            # Intensity is in mm/h, so we need to integrate over time
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

                    state_time = state.last_updated

                    if prev_state is not None and prev_time is not None:
                        # Calculate precipitation for the time interval
                        # Rate (mm/h) * duration (hours) = accumulation (mm)
                        elapsed = (state_time - prev_time).total_seconds()
                        duration_hours = elapsed / 3600
                        accumulation = prev_state * duration_hours

                        # Add to the appropriate hour bucket
                        hour_key = prev_time.strftime("%H:00")
                        if hour_key in hourly_data:
                            hourly_data[hour_key][precip_type] += accumulation
                            hourly_data[hour_key]["total"] += accumulation

                    prev_state = value
                    prev_time = state_time

            # Convert to list format for frontend
            hourly_list = []
            total_24h = 0
            today_total = 0
            midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

            for hour in range(24):
                hour_time = end_time - timedelta(hours=24 - hour)
                hour_key = hour_time.strftime("%H:00")
                default = {"rain": 0, "snow": 0, "total": 0}
                data = hourly_data.get(hour_key, default)

                hourly_list.append(
                    {
                        "hour": hour_key,
                        "rain": round(data["rain"], 2),
                        "snow": round(data["snow"], 2),
                        "total": round(data["total"], 2),
                    }
                )

                total_24h += data["total"]

                # Check if this hour is today
                if hour_time >= midnight:
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
