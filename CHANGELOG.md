# Changelog

All notable changes to Smart Sprinkler Control are documented here.

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
