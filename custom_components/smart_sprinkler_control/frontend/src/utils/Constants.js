/**
 * Constants for Smart Sprinkler Control frontend
 *
 * Centralized configuration values for the sprinkler control panel.
 */

/** Domain name for the integration */
export const DOMAIN = 'smart_sprinkler_control';

/** Maximum number of zones supported */
export const MAX_ZONES = 32;

/** Default zone runtime in minutes */
export const DEFAULT_DURATION = 15;

/** Days of week mapping */
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

/** Service names */
export const SERVICES = {
  START_ZONE: 'start_zone',
  STOP_ZONE: 'stop_zone',
  STOP_ALL_ZONES: 'stop_all_zones',
  ADJUST_ZONE_TIME: 'adjust_zone_time',
  ENABLE_RAIN_DELAY: 'enable_rain_delay',
  DISABLE_RAIN_DELAY: 'disable_rain_delay',
  UPDATE_ZONE_SETTINGS: 'update_zone_settings',
  CREATE_SCHEDULE: 'create_schedule',
  DELETE_SCHEDULE: 'delete_schedule',
  RUN_SCHEDULE: 'run_schedule',
};

/** Zone status types */
export const ZONE_STATUS = {
  IDLE: 'idle',
  WATERING: 'watering',
  DISABLED: 'disabled',
};

/** Panel version */
export const VERSION = '2025.1.0';
