/**
 * ServiceClient - Handles communication with Home Assistant services
 *
 * Provides methods to call sprinkler control services through the HA websocket API.
 */

import { DOMAIN, SERVICES } from '../utils/Constants.js';

export class ServiceClient {
  /**
   * Create a ServiceClient instance
   * @param {Object} hass - Home Assistant object
   */
  constructor(hass) {
    this._hass = hass;
  }

  /**
   * Update the Home Assistant reference
   * @param {Object} hass - Home Assistant object
   */
  setHass(hass) {
    this._hass = hass;
  }

  /**
   * Call a Home Assistant service
   * @param {string} service - Service name
   * @param {Object} data - Service data
   * @returns {Promise} Service call result
   */
  async callService(service, data) {
    if (!this._hass) {
      console.error('ServiceClient: No hass reference');
      throw new Error('Home Assistant connection not available');
    }

    try {
      return await this._hass.callService(DOMAIN, service, data);
    } catch (error) {
      console.error(`ServiceClient: Error calling ${service}:`, error);
      throw error;
    }
  }

  /**
   * Start a sprinkler zone
   * @param {string} entityId - System entity ID
   * @param {number} zoneId - Zone ID (1-based)
   * @param {number} duration - Duration in minutes
   * @returns {Promise} Service call result
   */
  async startZone(entityId, zoneId, duration) {
    return this.callService(SERVICES.START_ZONE, {
      entity_id: entityId,
      zone_id: zoneId,
      duration: duration,
    });
  }

  /**
   * Stop a sprinkler zone
   * @param {string} entityId - System entity ID
   * @param {number} zoneId - Zone ID (1-based)
   * @returns {Promise} Service call result
   */
  async stopZone(entityId, zoneId) {
    return this.callService(SERVICES.STOP_ZONE, {
      entity_id: entityId,
      zone_id: zoneId,
    });
  }

  /**
   * Stop all sprinkler zones
   * @param {string} entityId - System entity ID
   * @returns {Promise} Service call result
   */
  async stopAllZones(entityId) {
    return this.callService(SERVICES.STOP_ALL_ZONES, {
      entity_id: entityId,
    });
  }

  /**
   * Enable rain delay
   * @param {string} entityId - System entity ID
   * @param {number} hours - Delay hours (default 24)
   * @returns {Promise} Service call result
   */
  async enableRainDelay(entityId, hours = 24) {
    return this.callService(SERVICES.ENABLE_RAIN_DELAY, {
      entity_id: entityId,
      hours: hours,
    });
  }

  /**
   * Disable rain delay
   * @param {string} entityId - System entity ID
   * @returns {Promise} Service call result
   */
  async disableRainDelay(entityId) {
    return this.callService(SERVICES.DISABLE_RAIN_DELAY, {
      entity_id: entityId,
    });
  }

  /**
   * Update zone settings
   * @param {string} entityId - System entity ID
   * @param {number} zoneId - Zone ID (1-based)
   * @param {Object} settings - Zone settings to update
   * @returns {Promise} Service call result
   */
  async updateZoneSettings(entityId, zoneId, settings) {
    return this.callService(SERVICES.UPDATE_ZONE_SETTINGS, {
      entity_id: entityId,
      zone_id: zoneId,
      ...settings,
    });
  }

  /**
   * Create a watering schedule
   * @param {string} entityId - System entity ID
   * @param {Object} schedule - Schedule configuration
   * @returns {Promise} Service call result
   */
  async createSchedule(entityId, schedule) {
    return this.callService(SERVICES.CREATE_SCHEDULE, {
      entity_id: entityId,
      ...schedule,
    });
  }

  /**
   * Delete a watering schedule
   * @param {string} entityId - System entity ID
   * @param {string} scheduleId - Schedule ID to delete
   * @returns {Promise} Service call result
   */
  async deleteSchedule(entityId, scheduleId) {
    return this.callService(SERVICES.DELETE_SCHEDULE, {
      entity_id: entityId,
      schedule_id: scheduleId,
    });
  }
}
