/**
 * DataManager - Manages sprinkler system data and state.
 */
import { DOMAIN } from './constants.js';

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
    this._connectionId = null;
    this._lastUpdate = Date.now();
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
  async setupEventListeners() {
    if (!this._hass || !this._hass.connection) {
      return;
    }

    // Unsubscribe from previous listener
    if (this._unsubscribe && typeof this._unsubscribe === 'function') {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // Subscribe to state changes (returns a promise with unsubscribe function)
    try {
      this._unsubscribe = await this._hass.connection.subscribeEvents(
        (event) => this._handleStateChange(event),
        'state_changed'
      );
    } catch (e) {
      console.warn('Failed to subscribe to state changes:', e);
    }
  }

  /**
   * Check if connection is healthy and re-subscribe if needed
   * @returns {boolean} True if connection is healthy
   */
  async checkConnection() {
    if (!this._hass || !this._hass.connection) {
      console.warn('[SSC] No hass connection available');
      return false;
    }

    // Check if connection ID changed (indicates reconnection)
    const currentConnId = this._hass.connection.options?.auth?.access_token?.substring(0, 8) || 'unknown';
    if (this._connectionId && this._connectionId !== currentConnId) {
      console.log('[SSC] Connection changed, re-subscribing...');
      await this.setupEventListeners();
    }
    this._connectionId = currentConnId;

    return true;
  }

  /**
   * Handle state change events
   * @param {Object} event - State change event
   */
  _handleStateChange(event) {
    this._lastUpdate = Date.now();
    const entityId = event.data?.entity_id;
    if (!entityId) return;

    // Check if this is a sprinkler system entity or if we haven't loaded yet
    const isOurEntity =
      entityId.includes('sprinkler') ||
      this._systems.some((sys) => sys.entity_id === entityId);

    if (isOurEntity) {
      console.log('[SSC] State changed for:', entityId);

      // Update our cached state from the event's new_state
      if (event.data?.new_state) {
        const newState = event.data.new_state;
        // Update the system in our cache
        const system = this._systems.find((sys) => sys.entity_id === entityId);
        if (system) {
          system.state = newState;
          system.attributes = newState.attributes;
          console.log('[SSC] Updated cached system state:', newState.state);
        }
        // Also update selected system if it matches
        if (this._selectedSystem?.entity_id === entityId) {
          this._selectedSystem.state = newState;
          this._selectedSystem.attributes = newState.attributes;
        }
      }

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
   * Always reads fresh from hass.states to ensure up-to-date data
   * @returns {Array} Array of zone objects
   */
  getZones() {
    if (!this._selectedSystem || !this._hass) {
      return [];
    }

    // Always read fresh from hass.states, not from cached _selectedSystem
    const freshState = this._hass.states[this._selectedSystem.entity_id];
    const zones = freshState?.attributes?.zones || {};
    return Object.entries(zones).map(([id, data]) => ({
      id: parseInt(id, 10),
      ...data,
    }));
  }

  /**
   * Get schedules for selected system
   * Always reads fresh from hass.states
   * @returns {Array} Array of schedule objects
   */
  getSchedules() {
    if (!this._selectedSystem || !this._hass) {
      return [];
    }

    const freshState = this._hass.states[this._selectedSystem.entity_id];
    const schedules = freshState?.attributes?.schedules || {};
    return Object.entries(schedules).map(([id, data]) => ({
      id: id,
      ...data,
    }));
  }

  /**
   * Get weather data for selected system
   * Always reads fresh from hass.states
   * @returns {Object|null} Weather data
   */
  getWeatherData() {
    if (!this._selectedSystem || !this._hass) {
      return null;
    }

    const freshState = this._hass.states[this._selectedSystem.entity_id];
    const attrs = freshState?.attributes || {};
    return {
      weatherEntity: attrs.weather_entity_id,
      rainDelayActive: attrs.rain_delay_active,
      rainDelayUntil: attrs.rain_delay_until,
    };
  }

  /**
   * Get timestamp of last state update
   * @returns {number} Timestamp in milliseconds
   */
  getLastUpdate() {
    return this._lastUpdate;
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
