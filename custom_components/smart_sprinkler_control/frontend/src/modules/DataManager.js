/**
 * DataManager - Manages sprinkler system data and state
 *
 * Handles loading, caching, and subscribing to sprinkler system state updates.
 */

import { DOMAIN } from '../utils/Constants.js';

export class DataManager {
  /**
   * Create a DataManager instance
   * @param {Object} hass - Home Assistant object
   * @param {ServiceClient} serviceClient - Service client instance
   */
  constructor(hass, serviceClient) {
    this._hass = hass;
    this._serviceClient = serviceClient;
    this._systems = [];
    this._selectedSystem = null;
    this._unsubscribe = null;
  }

  /**
   * Update the Home Assistant reference
   * @param {Object} hass - Home Assistant object
   */
  setHass(hass) {
    this._hass = hass;
  }

  /**
   * Set up event listeners for state changes
   */
  setupEventListeners() {
    if (!this._hass || !this._hass.connection) {
      return;
    }

    // Unsubscribe from previous listener
    if (this._unsubscribe) {
      this._unsubscribe();
    }

    // Subscribe to state changes
    this._unsubscribe = this._hass.connection.subscribeEvents(
      (event) => this._handleStateChange(event),
      'state_changed'
    );
  }

  /**
   * Handle state change events
   * @param {Object} event - State change event
   */
  _handleStateChange(event) {
    const entityId = event.data?.entity_id;
    if (!entityId) return;

    // Check if this is a sprinkler system entity
    const isOurEntity = this._systems.some(
      (sys) => sys.entity_id === entityId
    );

    if (isOurEntity) {
      // Trigger a refresh
      this._onDataChange?.();
    }
  }

  /**
   * Set callback for data changes
   * @param {Function} callback - Callback function
   */
  onDataChange(callback) {
    this._onDataChange = callback;
  }

  /**
   * Load sprinkler system data from Home Assistant
   * @param {boolean} bypassCache - Force fresh load
   * @returns {Array} Array of sprinkler system entities
   */
  async loadSystemData(bypassCache = false) {
    if (!this._hass) {
      return [];
    }

    // Find all smart_sprinkler_control sensor entities
    const sprinklerEntities = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (
        entityId.startsWith('sensor.') &&
        state.attributes?.integration === DOMAIN
      ) {
        sprinklerEntities.push({
          entity_id: entityId,
          state: state,
          attributes: state.attributes,
        });
      }
    }

    this._systems = sprinklerEntities;

    // Auto-select first system if none selected
    if (!this._selectedSystem && sprinklerEntities.length > 0) {
      this._selectedSystem = sprinklerEntities[0];
    }

    return sprinklerEntities;
  }

  /**
   * Get currently selected system
   * @returns {Object|null} Selected system
   */
  getSelectedSystem() {
    return this._selectedSystem;
  }

  /**
   * Set the selected system
   * @param {string} entityId - Entity ID to select
   */
  setSelectedSystem(entityId) {
    this._selectedSystem = this._systems.find(
      (sys) => sys.entity_id === entityId
    );
  }

  /**
   * Get zone data for selected system
   * @returns {Array} Array of zone objects
   */
  getZones() {
    if (!this._selectedSystem) {
      return [];
    }

    const zones = this._selectedSystem.attributes?.zones || {};
    return Object.entries(zones).map(([id, data]) => ({
      id: parseInt(id, 10),
      ...data,
    }));
  }

  /**
   * Get schedules for selected system
   * @returns {Array} Array of schedule objects
   */
  getSchedules() {
    if (!this._selectedSystem) {
      return [];
    }

    const schedules = this._selectedSystem.attributes?.schedules || {};
    return Object.entries(schedules).map(([id, data]) => ({
      id: id,
      ...data,
    }));
  }

  /**
   * Get weather data for selected system
   * @returns {Object|null} Weather data
   */
  getWeatherData() {
    if (!this._selectedSystem) {
      return null;
    }

    return {
      weatherEntity: this._selectedSystem.attributes?.weather_entity_id,
      rainDelayActive: this._selectedSystem.attributes?.rain_delay_active,
      rainDelayUntil: this._selectedSystem.attributes?.rain_delay_until,
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }
}
