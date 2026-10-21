# Changelog

All notable changes to Smart Sprinkler Control are documented here.

## [2025.1.10] - 2026-10-20

Security release. Everyone running this integration should update. Details of
the individual issues will follow in a security advisory; this entry says what
changed and where, deliberately without reproduction steps.

### Security

- **Unauthenticated arbitrary file read via the panel asset route (critical).**
  The built panel bundle was served by a hand-rolled, unauthenticated
  `HomeAssistantView` that joined a client-supplied filename onto the frontend
  directory. The join did not stay inside that directory, so the route could be
  made to return files elsewhere on the Home Assistant host, including
  credential material. The view is removed outright: the bundle is now served
  by Home Assistant's own static-path handler
  (`hass.http.async_register_static_paths`), which contains requests to the
  registered directory and does not block the event loop. The asset URL moved
  from `/api/smart_sprinkler_control/frontend/<file>` to
  `/smart_sprinkler_control_static/<file>`; the panel registration follows it
  automatically, so no user action is needed. Static assets remain
  unauthenticated by design, because the browser loads panel JavaScript with a
  plain module fetch that carries no auth header. (`api/http.py`,
  `frontend/panel.py`)

- **Unauthenticated precipitation data endpoint.**
  `/api/smart_sprinkler_control/precipitation` set `requires_auth = False`
  while returning precipitation-sensor entity ids and 24 hours of recorder
  history, and running a recorder query on every request. It now requires
  authentication like any other data endpoint. The panel fetches it through
  `hass.callApi`, which carries the viewer's own token, so the chart keeps
  working. (`api/http.py`, `frontend/src/rain-chart.js`)

- **Stored cross-site scripting in the panel.** Zone and schedule names, the
  schedule start time and several other stored or state-sourced values were
  interpolated into panel markup unescaped and assigned via `innerHTML`, so
  stored text could execute in a viewer's session. All 40 interpolation sites
  across the five rendering modules now go through one shared helper
  (`frontend/src/html.js`). Inline event-handler arguments use a separate
  encoder, because an HTML attribute is entity-decoded before its contents are
  compiled as JavaScript and HTML escaping alone does not contain a value
  there. (`frontend/src/html.js` and every render module; bundle rebuilt)

- **No admin gating on configuration services.** All ten services were
  registered for any logged-in user. The three that write stored configuration
  (`update_zone_settings`, `create_schedule`, `delete_schedule`) are now
  admin-only. The seven operational services (`start_zone`, `stop_zone`,
  `stop_all_zones`, `adjust_zone_time`, `enable_rain_delay`,
  `disable_rain_delay`, `run_schedule`) stay available to non-admin users on
  purpose: this is a household system and family members who are non-admin
  Home Assistant users must still be able to run their sprinklers. The panel
  likewise stays visible to non-admins. (`__init__.py`, `frontend/panel.py`)

- **Confused deputy on relayed switch calls.** Service handlers relayed to
  `switch.turn_on` / `switch.turn_off` with a fresh context, so Home Assistant
  evaluated the integration's authority instead of the caller's and never
  applied the caller's per-entity permissions to the valve. All five
  user-initiated relays now forward `call.context`. The remaining relays are
  coordinator- or startup-driven, have no calling user, and each says so in a
  comment. This is what makes leaving the operational services open safe.
  (`__init__.py`)

### Fixed

- Exception text is no longer returned to HTTP clients; the detail goes to the
  log and the client gets a generic message. (`api/precipitation.py`)
- A missing frontend file no longer logs at `error` level on every request;
  that code path is gone with the hand-rolled view.
- `pytest.ini` used the `[tool:pytest]` section header, which is the
  `setup.cfg` name. In a `pytest.ini` the section must be `[pytest]`, so the
  entire file was silently ignored and coverage reporting, `--strict-markers`
  and the marker registry never applied. Fixed, and `asyncio_mode = auto`
  added, without which an `async def` test is collected and SKIPPED, which
  reads as a green run while asserting nothing.
- `VERSION` in `const.py` had drifted to `2025.1.5` while `manifest.json` said
  `2025.1.9`. All five places the version is tracked are now aligned.

### Changed

- CI pins `home-assistant/actions/hassfest` and `hacs/action` to commit SHAs
  instead of the mutable `@master` / `@main` refs.
- New test suites: `tests/test_security_http.py`,
  `tests/test_security_services.py`, `tests/test_security_frontend.py`, and a
  dependency-free JavaScript suite for the escaping helpers
  (`frontend/test/escape-html.test.mjs`, `npm test`), which the Python suite
  also runs.

## [2025.1.4] - 2026-06-02

### Fixed

- **Stale "water time today" on restart/migration.** The day-rollover reset in
  the coordinator only fires when `stats_date` *changes*, so on a first load
  that adopted `stats_date=today` (migration or fresh restore) it kept the
  previous day's per-zone `total_runtime_today` /
  `total_water_used_today` labelled as "today" until the next midnight. Confirmed
  live: zones showed last night's run (zone1=29, zone2=16, ...) on a morning when
  nothing had watered. `async_setup_entry` now reconciles daily totals at load:
  it checks whether any zone's `last_watering_date` is actually today and, if
  NOT, zeroes every zone's daily totals plus the system daily totals and anchors
  `stats_date=today`. If watering DID happen today, legitimate same-day stats are
  preserved across the restart. The coordinator's
  `reset_daily_stats_if_new_day` is unchanged for the HA-stays-up-across-midnight
  case. (`__init__.py` `async_setup_entry`)

## [2025.1.3] - 2026-06-02

### Fixed

- **Daily stats never reset.** Per-zone `total_runtime_today` /
  `total_water_used_today` and the system daily totals accumulated forever with
  no day-rollover reset, so a stale value (e.g. zone 4 `runtime_today=2`) could
  carry across days. The coordinator now zeroes all daily totals once per
  calendar day, before evaluating schedules, via
  `SprinklerSystem.reset_daily_stats_if_new_day()`. The reset date
  (`stats_date`) is persisted to `.storage` so a restart neither double-resets
  nor skips a day, and the first post-restart cycle adopts the stored date
  without wiping restored stats. (`models/zone.py`, `__init__.py`
  `_async_update_data`)

- **Per-zone `last_watering_date` (last run) reset to None on restart.** The
  zone's "last run" timestamp was never serialized, so every Home Assistant
  restart blanked it. It is now persisted to and restored from `.storage`
  (ISO string or None), matching how schedule `last_run_date` is handled.
  (`__init__.py` `_save_system_data` / `async_setup_entry`)

## [2025.1.2] - 2026-06-02

### Fixed

- **Catch-up run on enable/edit of a past-start-time schedule.** Enabling or
  saving an existing schedule mid-day, after its start time had already passed,
  could trigger an immediate "catch-up" watering run because the edit path only
  preserved the old `last_run_date`. The create/edit handler now marks any
  enabled schedule whose start time has already passed today as
  satisfied-for-today (it waits for the next scheduled occurrence) for BOTH new
  and edited schedules. Schedules whose start time is still in the future today
  are left untouched so they still run on time today.
  (`__init__.py` `handle_create_schedule`)

- **`last_run_date` not persisted (re-runs on restart).** A schedule's
  `last_run_date` was never serialized to `.storage`, so every Home Assistant
  restart reset it to `None` and the schedule could re-run. `last_run_date` is
  now serialized as an ISO string (or `null`) on save and parsed back to a
  `datetime` on restore, with the startup-safety marker only applied when no
  genuine "ran today" value was restored.
  (`__init__.py` `_save_system_data` + schedule restore)

- **3 AM controller reconnect shown as per-zone activity.** When the ESPHome
  controller reconnects (~03:02 nightly) every `switch.sprinkler_*` flips
  `unavailable -> off` and the safety all-off fires. `Zone.stop_watering()` now
  only records `last_watering_date` and runtime/water statistics when a real
  watering session actually started (had a `start_time`), so availability
  transitions and the safety all-off can never register as a run. The panel's
  per-zone "active" detection is sourced strictly from the backend zone model
  (`state === 'watering'`) and never from switch entity availability or
  `last_changed`.
  (`models/zone.py` `Zone.stop_watering`, `frontend/src/zone-cards.js`)

### Notes

- Frontend bundle `dist/smart-sprinkler-control-panel.js` rebuilt via
  `npm run build` (esbuild) after the `zone-cards.js` change.
