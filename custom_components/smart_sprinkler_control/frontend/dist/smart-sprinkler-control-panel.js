(() => {
  // src/constants.js
  var DOMAIN = "smart_sprinkler_control";
  var DAYS_OF_WEEK = [
    { value: 0, label: "Sunday", short: "Sun" },
    { value: 1, label: "Monday", short: "Mon" },
    { value: 2, label: "Tuesday", short: "Tue" },
    { value: 3, label: "Wednesday", short: "Wed" },
    { value: 4, label: "Thursday", short: "Thu" },
    { value: 5, label: "Friday", short: "Fri" },
    { value: 6, label: "Saturday", short: "Sat" }
  ];
  var SERVICES = {
    START_ZONE: "start_zone",
    STOP_ZONE: "stop_zone",
    STOP_ALL_ZONES: "stop_all_zones",
    ADJUST_ZONE_TIME: "adjust_zone_time",
    ENABLE_RAIN_DELAY: "enable_rain_delay",
    DISABLE_RAIN_DELAY: "disable_rain_delay",
    UPDATE_ZONE_SETTINGS: "update_zone_settings",
    CREATE_SCHEDULE: "create_schedule",
    DELETE_SCHEDULE: "delete_schedule",
    RUN_SCHEDULE: "run_schedule"
  };
  var VERSION = "2025.1.0";

  // src/service-client.js
  var ServiceClient = class {
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
        console.error("ServiceClient: No hass reference");
        throw new Error("Home Assistant connection not available");
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
        duration
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
        zone_id: zoneId
      });
    }
    /**
     * Stop all sprinkler zones
     * @param {string} entityId - System entity ID
     * @returns {Promise} Service call result
     */
    async stopAllZones(entityId) {
      return this.callService(SERVICES.STOP_ALL_ZONES, {
        entity_id: entityId
      });
    }
    /**
     * Adjust the remaining time for a running zone
     * @param {string} entityId - System entity ID
     * @param {number} zoneId - Zone ID (1-based)
     * @param {number} newDuration - New remaining duration in minutes
     * @returns {Promise} Service call result
     */
    async adjustZoneTime(entityId, zoneId, newDuration) {
      return this.callService(SERVICES.ADJUST_ZONE_TIME, {
        entity_id: entityId,
        zone_id: zoneId,
        duration: newDuration
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
        hours
      });
    }
    /**
     * Disable rain delay
     * @param {string} entityId - System entity ID
     * @returns {Promise} Service call result
     */
    async disableRainDelay(entityId) {
      return this.callService(SERVICES.DISABLE_RAIN_DELAY, {
        entity_id: entityId
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
        ...settings
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
        ...schedule
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
        schedule_id: scheduleId
      });
    }
    /**
     * Run a schedule immediately
     * @param {string} entityId - System entity ID
     * @param {string} scheduleId - Schedule ID to run
     * @returns {Promise} Service call result
     */
    async runSchedule(entityId, scheduleId) {
      return this.callService(SERVICES.RUN_SCHEDULE, {
        entity_id: entityId,
        schedule_id: scheduleId
      });
    }
  };

  // src/data-manager.js
  var DataManager = class {
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
      if (this._unsubscribe && typeof this._unsubscribe === "function") {
        this._unsubscribe();
        this._unsubscribe = null;
      }
      try {
        this._unsubscribe = await this._hass.connection.subscribeEvents(
          (event) => this._handleStateChange(event),
          "state_changed"
        );
      } catch (e) {
        console.warn("Failed to subscribe to state changes:", e);
      }
    }
    /**
     * Check if connection is healthy and re-subscribe if needed
     * @returns {boolean} True if connection is healthy
     */
    async checkConnection() {
      if (!this._hass || !this._hass.connection) {
        console.warn("[SSC] No hass connection available");
        return false;
      }
      const currentConnId = this._hass.connection.options?.auth?.access_token?.substring(0, 8) || "unknown";
      if (this._connectionId && this._connectionId !== currentConnId) {
        console.log("[SSC] Connection changed, re-subscribing...");
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
      const isOurEntity = entityId.includes("sprinkler") || this._systems.some((sys) => sys.entity_id === entityId);
      if (isOurEntity) {
        console.log("[SSC] State changed for:", entityId);
        if (event.data?.new_state) {
          const newState = event.data.new_state;
          const system = this._systems.find((sys) => sys.entity_id === entityId);
          if (system) {
            system.state = newState;
            system.attributes = newState.attributes;
            console.log("[SSC] Updated cached system state:", newState.state);
          }
          if (this._selectedSystem?.entity_id === entityId) {
            this._selectedSystem.state = newState;
            this._selectedSystem.attributes = newState.attributes;
          }
        }
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
      const sprinklerEntities = [];
      for (const [entityId, state] of Object.entries(this._hass.states)) {
        if (entityId.startsWith("sensor.") && state.attributes?.integration === DOMAIN) {
          sprinklerEntities.push({
            entity_id: entityId,
            state,
            attributes: state.attributes
          });
        }
      }
      this._systems = sprinklerEntities;
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
      const freshState = this._hass.states[this._selectedSystem.entity_id];
      const zones = freshState?.attributes?.zones || {};
      return Object.entries(zones).map(([id, data]) => ({
        id: parseInt(id, 10),
        ...data
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
        id,
        ...data
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
        rainDelayUntil: attrs.rain_delay_until
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
  };

  // src/styles.js
  var styleMethods = {
    renderStyles() {
      return `
    <style>
      .sprinkler-panel {
        padding: 16px;
        max-width: 1200px;
        margin: 0 auto;
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .panel-header h1 {
        margin: 0;
        font-size: 24px;
      }
      .header-actions {
        display: flex;
        gap: 8px;
      }
      .zones-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }
      .zone-card {
        background: var(--card-background-color);
        border-radius: 8px;
        padding: 16px;
        box-shadow: var(--ha-card-box-shadow, 0 2px 2px rgba(0,0,0,0.1));
      }
      .zone-card.active {
        border: 2px solid var(--info-color, #2196f3);
        animation: pulse-border 2s ease-in-out infinite;
      }
      @keyframes pulse-border {
        0%, 100% {
          border-color: var(--info-color, #2196f3);
          box-shadow: 0 0 8px rgba(33, 150, 243, 0.3);
        }
        50% {
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 16px rgba(33, 150, 243, 0.6);
        }
      }
      .zone-card.disabled {
        opacity: 0.6;
      }
      .zone-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
        position: relative;
      }
      .zone-header-left {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        flex: 1;
      }
      .zone-icon {
        --mdc-icon-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--secondary-text-color);
      }
      .zone-icon.running {
        color: var(--info-color, #2196f3);
        animation: icon-pulse 1.5s ease-in-out infinite;
      }
      .zone-icon.idle {
        color: var(--secondary-text-color);
      }
      .zone-icon.idle {
        color: var(--secondary-text-color);
      }
      .zone-icon.disabled-icon {
        opacity: 0.4;
      }
      @keyframes icon-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
      }
      .zone-title-block {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .zone-name {
        font-weight: 500;
        font-size: 16px;
        line-height: 1.2;
      }
      .zone-number {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .zone-settings-btn {
        background: none;
        border: none;
        padding: 4px;
        cursor: pointer;
        font-size: 18px;
        color: var(--secondary-text-color);
        opacity: 0.7;
        transition: opacity 0.2s, color 0.2s;
        line-height: 1;
        min-width: 32px;
        min-height: 32px;
      }
      .zone-settings-btn:hover {
        opacity: 1;
        color: var(--primary-text-color);
      }
      .zone-status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .zone-status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        font-weight: 500;
      }
      .zone-status.idle {
        background: var(--secondary-background-color);
        color: var(--secondary-text-color);
      }
      .zone-status.watering {
        background: var(--success-color, #43a047);
        color: white;
      }
      .zone-status.scheduled {
        background: var(--warning-color, #ff9800);
        color: white;
      }
      .zone-status.rain-delayed {
        background: var(--info-color, #2196f3);
        color: white;
      }
      .zone-status.disabled-status {
        background: var(--disabled-color, #9e9e9e);
        color: white;
        opacity: 0.7;
      }
      .zone-stats {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
        padding: 8px;
        background: var(--secondary-background-color);
        border-radius: 6px;
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .zone-stat-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .zone-stat-row ha-icon {
        --mdc-icon-size: 14px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }
      .zone-stat-label {
        font-weight: 400;
        min-width: 40px;
      }
      .zone-stat-value {
        font-weight: 500;
        color: var(--primary-text-color);
        margin-left: auto;
      }
      .zone-time-info {
        margin-bottom: 12px;
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .zone-time-info .time-remaining {
        color: var(--success-color, #43a047);
        font-weight: 500;
      }
      .zone-time-info .time-today {
        font-size: 12px;
      }
      /* Progress ring and countdown styles */
      .zone-progress-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin: 16px 0;
      }
      .progress-ring-wrapper {
        position: relative;
        width: 120px;
        height: 120px;
      }
      .progress-ring {
        transform: rotate(-90deg);
        width: 120px;
        height: 120px;
      }
      .progress-ring-bg {
        fill: none;
        stroke: var(--secondary-background-color, #e0e0e0);
        stroke-width: 8;
      }
      .progress-ring-progress {
        fill: none;
        stroke: var(--info-color, #2196f3);
        stroke-width: 8;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.5s ease;
      }
      .countdown-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .countdown-time {
        font-size: 28px;
        font-weight: 600;
        color: var(--primary-text-color);
        line-height: 1;
      }
      .countdown-label {
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-top: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .elapsed-time {
        font-size: 13px;
        color: var(--secondary-text-color);
        margin-top: 8px;
      }
      /* Time adjustment buttons */
      .time-adjust-controls {
        display: flex;
        gap: 12px;
        margin-top: 12px;
      }
      .time-adjust-btn {
        padding: 8px 16px;
        border: 1px solid var(--divider-color);
        border-radius: 20px;
        background: transparent;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        transition: all 0.2s;
      }
      .time-adjust-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(var(--rgb-primary-color), 0.1);
      }
      .time-adjust-btn:active {
        transform: scale(0.95);
      }
      .time-adjust-btn.subtract {
        color: var(--error-color, #f44336);
      }
      .time-adjust-btn.subtract:hover {
        border-color: var(--error-color, #f44336);
        background: rgba(244, 67, 54, 0.1);
      }
      .time-adjust-btn.add {
        color: var(--success-color, #43a047);
      }
      .time-adjust-btn.add:hover {
        border-color: var(--success-color, #43a047);
        background: rgba(67, 160, 71, 0.1);
      }
      .zone-controls {
        display: flex;
        gap: 8px;
      }
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      }
      .btn-primary {
        background: var(--primary-color);
        color: var(--text-primary-color);
      }
      .btn-primary:hover {
        opacity: 0.9;
      }
      .btn-danger {
        background: var(--error-color, #f44336);
        color: white;
      }
      .btn-secondary {
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
      }
      .section-title {
        font-size: 18px;
        font-weight: 500;
        margin: 24px 0 12px 0;
      }
      .schedules-list {
        background: var(--card-background-color);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 24px;
      }
      .schedule-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid var(--divider-color);
      }
      .schedule-item:last-child {
        border-bottom: none;
      }
      .schedule-info h4 {
        margin: 0 0 4px 0;
      }
      .schedule-info p {
        margin: 0;
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .weather-card {
        background: var(--card-background-color);
        border-radius: 8px;
        padding: 16px;
      }
      .weather-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .rain-delay-active {
        background: var(--warning-color, #ff9800);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
      }
      /* Debug section styles */
      .debug-section {
        background: var(--card-background-color);
        border-radius: 8px;
        padding: 16px;
        margin-top: 24px;
        border: 2px dashed var(--warning-color, #ff9800);
      }
      .debug-section h3 {
        margin: 16px 0 8px 0;
        font-size: 14px;
        color: var(--secondary-text-color);
      }
      .debug-section h3:first-child {
        margin-top: 0;
      }
      .debug-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        font-family: monospace;
      }
      .debug-table th,
      .debug-table td {
        padding: 8px;
        text-align: left;
        border-bottom: 1px solid var(--divider-color);
      }
      .debug-table th {
        background: var(--secondary-background-color);
        font-weight: 500;
      }
      .entity-state {
        font-weight: bold;
      }
      .state-on {
        color: var(--success-color, #43a047);
      }
      .state-off {
        color: var(--secondary-text-color);
      }
      .btn-small {
        padding: 4px 8px;
        font-size: 12px;
      }
      .debug-warning {
        background: var(--warning-color, #ff9800);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-weight: 500;
      }
      /* Compact debug styles */
      .debug-compact {
        padding: 8px;
        margin-top: 12px;
        font-size: 11px;
      }
      .debug-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
      }
      .debug-col {
        min-width: 0;
      }
      .debug-label {
        font-weight: 600;
        color: var(--secondary-text-color);
        margin-bottom: 2px;
        font-size: 10px;
        text-transform: uppercase;
      }
      .debug-value {
        font-family: monospace;
        margin-bottom: 8px;
      }
      .debug-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 8px;
      }
      .debug-chip {
        padding: 2px 6px;
        border-radius: 3px;
        background: var(--secondary-background-color);
        font-family: monospace;
        font-size: 10px;
        cursor: pointer;
      }
      .debug-chip.on {
        background: var(--success-color, #43a047);
        color: white;
      }
      .debug-chip.off {
        opacity: 0.6;
      }
      .debug-row {
        display: flex;
        gap: 8px;
        font-family: monospace;
        margin-bottom: 2px;
      }
      .debug-row span {
        min-width: 0;
      }
      .btn-xs {
        padding: 2px 8px;
        font-size: 10px;
      }
      /* Loading button state */
      .btn.loading {
        opacity: 0.7;
        cursor: wait;
      }
      .btn.loading::after {
        content: '';
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-left: 8px;
        border: 2px solid transparent;
        border-top-color: currentColor;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      /* Modal styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease-out;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .modal-content {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 24px;
        min-width: 320px;
        max-width: 400px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.2s ease-out;
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--divider-color);
      }
      .modal-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
      }
      .modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--secondary-text-color);
        padding: 4px;
        line-height: 1;
      }
      .modal-close:hover {
        color: var(--primary-text-color);
      }
      .duration-display {
        text-align: center;
        margin: 24px 0;
      }
      .duration-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
      }
      .duration-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid var(--primary-color);
        background: transparent;
        color: var(--primary-color);
        font-size: 24px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .duration-btn:hover {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
      }
      .duration-btn:active {
        transform: scale(0.95);
      }
      .duration-value {
        font-size: 48px;
        font-weight: 600;
        min-width: 120px;
        color: var(--primary-text-color);
      }
      .duration-unit {
        font-size: 16px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
      .quick-durations {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
        margin: 20px 0;
      }
      .quick-duration-btn {
        padding: 8px 16px;
        border: 1px solid var(--divider-color);
        border-radius: 20px;
        background: transparent;
        cursor: pointer;
        font-size: 14px;
        color: var(--primary-text-color);
        transition: all 0.2s;
      }
      .quick-duration-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }
      .quick-duration-btn.selected {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-color);
      }
      .modal-actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
      }
      .modal-actions .btn {
        flex: 1;
        padding: 12px 24px;
        font-size: 16px;
      }
      .modal-zone-info {
        text-align: center;
        color: var(--secondary-text-color);
        font-size: 14px;
        margin-bottom: 8px;
      }
      /* Settings modal form styles */
      .settings-modal {
        min-width: 340px;
      }
      .modal-footer {
        display: flex;
        gap: 12px;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--divider-color);
      }
      .modal-footer .btn {
        flex: 1;
      }
      .settings-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form-group label {
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      .form-group .optional {
        font-weight: 400;
        font-size: 11px;
        opacity: 0.7;
      }
      .form-input {
        padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        font-size: 14px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
      }
      .form-input:focus {
        outline: none;
        border-color: var(--primary-color);
      }
      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .checkbox-label input[type="checkbox"] {
        width: 18px;
        height: 18px;
      }
      .form-divider {
        height: 1px;
        background: var(--divider-color);
        margin: 4px 0;
      }
      /* Schedule styles */
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 24px 0 12px 0;
      }
      .section-header .section-title {
        margin: 0;
      }
      .btn-sm {
        padding: 6px 12px;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .btn-sm ha-icon {
        --mdc-icon-size: 16px;
      }
      .no-schedules {
        color: var(--secondary-text-color);
        font-style: italic;
        padding: 12px 0;
      }
      .schedule-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--divider-color);
        gap: 12px;
      }
      .schedule-item:last-child {
        border-bottom: none;
      }
      .schedule-info {
        flex: 1;
        min-width: 0;
      }
      .schedule-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .schedule-header h4 {
        margin: 0;
        font-size: 15px;
        font-weight: 500;
      }
      .schedule-status {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 500;
      }
      .schedule-status.active {
        background: var(--success-color, #43a047);
        color: white;
      }
      .schedule-status.disabled {
        background: var(--disabled-color, #9e9e9e);
        color: white;
      }
      .schedule-details {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .schedule-details span {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .schedule-details ha-icon {
        --mdc-icon-size: 14px;
      }
      .schedule-actions {
        display: flex;
        gap: 4px;
      }
      .btn-icon {
        background: none;
        border: none;
        padding: 8px;
        cursor: pointer;
        border-radius: 50%;
        color: var(--secondary-text-color);
        transition: all 0.2s;
      }
      .btn-icon:hover {
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
      }
      .btn-icon ha-icon {
        --mdc-icon-size: 20px;
      }
      .btn-danger-icon:hover {
        background: rgba(244, 67, 54, 0.1);
        color: var(--error-color, #f44336);
      }
      /* Schedule modal styles */
      .schedule-modal {
        min-width: 340px;
        max-width: 420px;
      }
      .schedule-modal .modal-body {
        padding: 0 4px;
      }
      .schedule-form {
        max-height: 55vh;
        overflow-y: auto;
      }
      .schedule-form .form-group {
        margin-bottom: 12px;
      }
      .schedule-form .form-group label {
        margin-bottom: 4px;
        font-size: 12px;
      }
      .form-row-2col {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        margin-bottom: 12px;
      }
      .form-row-2col .form-group {
        margin-bottom: 0;
      }
      .form-row-2col input[type="time"] {
        width: 110px;
      }
      .day-toggle-group {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .day-toggle-btn {
        padding: 6px 10px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: transparent;
        cursor: pointer;
        font-size: 12px;
        color: var(--primary-text-color);
        transition: all 0.2s;
        min-width: 40px;
      }
      .day-toggle-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }
      .day-toggle-btn.selected {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-color);
      }
      .zone-select-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow-y: auto;
        padding: 6px 8px;
        background: var(--secondary-background-color);
        border-radius: 6px;
      }
      .zone-select-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
      }
      .zone-select-label {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        flex: 1;
        font-size: 13px;
      }
      .zone-select-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
      }
      .zone-duration-row {
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .form-input-sm {
        width: 50px;
        padding: 3px 6px;
        font-size: 12px;
      }
      .duration-label {
        font-size: 11px;
        color: var(--secondary-text-color);
      }
      .form-group-inline {
        display: flex;
        gap: 20px;
        margin-top: 8px;
      }
      .checkbox-label-inline {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 13px;
      }
      .checkbox-label-inline input[type="checkbox"] {
        width: 16px;
        height: 16px;
      }
      .btn-run:hover {
        background: rgba(67, 160, 71, 0.1);
        color: var(--success-color, #43a047);
      }
      /* Zone checkbox group */
      .zone-checkbox-group {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        padding: 6px 8px;
        background: var(--secondary-background-color);
        border-radius: 6px;
      }
      .zone-checkbox-label {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
      }
      .zone-checkbox-label input {
        width: 14px;
        height: 14px;
      }
      .label-hint {
        font-weight: 400;
        font-size: 10px;
        color: var(--secondary-text-color);
      }
      /* Fire order list */
      .fire-order-list {
        background: var(--secondary-background-color);
        border-radius: 6px;
        padding: 4px;
        min-height: 40px;
      }
      .fire-order-empty {
        padding: 12px;
        text-align: center;
        color: var(--secondary-text-color);
        font-size: 12px;
        font-style: italic;
      }
      .fire-order-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--card-background-color);
        border-radius: 4px;
        margin-bottom: 4px;
        cursor: grab;
        transition: background 0.15s, box-shadow 0.15s;
      }
      .fire-order-item:last-child {
        margin-bottom: 0;
      }
      .fire-order-item:hover {
        background: var(--card-background-color);
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .fire-order-item.dragging {
        opacity: 0.5;
        background: var(--primary-color);
      }
      .fire-order-handle {
        color: var(--secondary-text-color);
        font-size: 12px;
        cursor: grab;
      }
      .fire-order-num {
        background: var(--primary-color);
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
      }
      .fire-order-name {
        flex: 1;
        font-size: 13px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fire-order-duration {
        width: 45px;
        padding: 2px 4px;
        font-size: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        background: var(--card-background-color);
        text-align: center;
      }
      .fire-order-unit {
        font-size: 11px;
        color: var(--secondary-text-color);
      }
    </style>
  `;
    }
  };

  // src/rain-chart.js
  var rainChartMethods = {
    _startRainRefresh() {
      if (this._rainRefreshInterval) return;
      this._rainRefreshInterval = setInterval(async () => {
        if (document.visibilityState !== "visible") return;
        const data = await this._getCachedRainData(true);
        this._applyRainData(data);
      }, this._rainFetchInterval);
    },
    /**
     * Stop the precipitation refresh timer.
     */
    _stopRainRefresh() {
      if (this._rainRefreshInterval) {
        clearInterval(this._rainRefreshInterval);
        this._rainRefreshInterval = null;
      }
    },
    _renderRainGraph() {
      return `
    <div class="rain-graph-container" style="
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(0, 255, 255, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      height: 180px;
      box-sizing: border-box;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; color: #00ffff; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
          Precipitation (24h)
        </h3>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span id="rain-today" style="color: #00ffff; font-size: 12px; font-weight: bold;">Today: 0.0 mm</span>
          <span id="rain-total" style="color: #888; font-size: 12px;">24h: 0.0 mm</span>
        </div>
      </div>
      <div style="height: 120px; position: relative;">
        <canvas id="rainChart"></canvas>
      </div>
    </div>
  `;
    },
    /**
     * Get rain data from backend API which fetches Home Assistant history.
     * Falls back to empty data on API errors.
     */
    async _getRainData() {
      if (!this._hass) {
        console.log("[SSC] No hass available");
        return this._getEmptyRainData("no hass");
      }
      try {
        const response = await fetch("/api/smart_sprinkler_control/precipitation");
        if (!response.ok) {
          console.warn("[SSC] Precipitation API error:", response.status);
          return this._getEmptyRainData("api error");
        }
        const data = await response.json();
        console.log("[SSC] Precipitation data from API:", data);
        if (data.error) {
          console.warn("[SSC] API returned error:", data.error);
          return this._getEmptyRainData(data.error);
        }
        const labels = data.hourly.map((h) => h.hour);
        const chartData = data.hourly.map((h) => h.total);
        const hasRain = data.sensors?.rain?.length > 0;
        const hasSnow = data.sensors?.snow?.length > 0;
        let source = "live";
        if (hasSnow && hasRain) source = "live (rain+snow)";
        else if (hasSnow) source = "live (snow)";
        else if (hasRain) source = "live (rain)";
        return {
          labels,
          data: chartData,
          total: data.total_24h || 0,
          today: data.today_total || 0,
          source,
          currentRate: chartData[chartData.length - 1] || 0
        };
      } catch (error) {
        console.error("[SSC] Error fetching precipitation data:", error);
        return this._getEmptyRainData("fetch error");
      }
    },
    /**
     * Generate empty rain data when no sensor is available.
     * Shows zeros so user knows there's no data, rather than fake mock data.
     */
    _getEmptyRainData(reason) {
      const now = /* @__PURE__ */ new Date();
      const labels = [];
      const data = [];
      for (let i = 23; i >= 0; i--) {
        const hour = new Date(now - i * 60 * 60 * 1e3);
        labels.push(hour.getHours().toString().padStart(2, "0") + ":00");
        data.push(0);
      }
      return { labels, data, total: 0, today: 0, source: reason, currentRate: 0 };
    },
    /**
     * Return cached precipitation data, fetching from the backend only
     * when the cache is stale (older than the throttle interval) or empty.
     * Deduplicates concurrent callers via a shared in-flight promise so a
     * burst of renders triggers at most one network request.
     *
     * @param {boolean} [force=false] Bypass the throttle and refetch now.
     * @returns {Promise<Object>} Normalized rain data object.
     */
    async _getCachedRainData(force = false) {
      const now = Date.now();
      const fresh = this._rainData && now - this._rainLastFetch < this._rainFetchInterval;
      if (fresh && !force) {
        return this._rainData;
      }
      if (this._rainFetchInflight) {
        return this._rainFetchInflight;
      }
      this._rainFetchInflight = (async () => {
        const data = await this._getRainData();
        this._rainData = data;
        this._rainLastFetch = Date.now();
        this._rainFetchInflight = null;
        return data;
      })();
      return this._rainFetchInflight;
    },
    /**
     * Push the current cached dataset into the existing chart and refresh
     * the summary labels. Does NOT create or destroy the chart.
     *
     * @param {Object} rainData Normalized rain data object.
     */
    _applyRainData(rainData) {
      if (!rainData) return;
      const { labels, data, total, source } = rainData;
      const todayEl = this.querySelector("#rain-today");
      const totalEl = this.querySelector("#rain-total");
      if (todayEl) {
        const todayNum = typeof rainData.today === "number" ? rainData.today : parseFloat(rainData.today) || 0;
        todayEl.textContent = `Today: ${todayNum.toFixed(1)} mm`;
      }
      if (totalEl) {
        const totalNum = typeof total === "number" ? total : parseFloat(total) || 0;
        const sourceLabel = source === "no sensor" ? " (no sensor)" : source === "no hass" ? " (no hass)" : "";
        totalEl.textContent = `24h: ${totalNum.toFixed(1)} mm${sourceLabel}`;
      }
      if (this._rainChart) {
        this._rainChart.data.labels = labels;
        this._rainChart.data.datasets[0].data = data;
        this._rainChart.update();
      }
    },
    /**
     * Initialize the rain chart ONCE against the #rainChart canvas using the
     * cached dataset. Subsequent renders reuse the same chart instance and
     * only update its data (see _applyRainData) — the chart is never
     * destroyed/recreated per render, which is what caused the old flicker
     * loop. If the chart already exists for the live canvas, this just
     * re-applies the cached data and returns.
     */
    async _initRainChart() {
      if (this._chartInitializing) return;
      const canvas = this.querySelector("#rainChart");
      if (!canvas || typeof Chart === "undefined") {
        return;
      }
      const rainData = await this._getCachedRainData();
      if (this._rainChart && this._rainChart.canvas === canvas) {
        this._applyRainData(rainData);
        return;
      }
      this._chartInitializing = true;
      if (this._rainChart) {
        this._rainChart.destroy();
        this._rainChart = null;
      }
      const existingChart = Chart.getChart(canvas);
      if (existingChart) {
        existingChart.destroy();
      }
      const ctx = canvas.getContext("2d");
      const { labels, data } = rainData;
      this._rainChart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Rain (mm)",
            data,
            borderColor: "#00ffff",
            backgroundColor: "rgba(0, 255, 255, 0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: "#00ffff"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              titleColor: "#00ffff",
              bodyColor: "#fff",
              borderColor: "rgba(0, 255, 255, 0.3)",
              borderWidth: 1,
              callbacks: {
                label: (context) => `${context.parsed.y.toFixed(2)} mm`
              }
            }
          },
          scales: {
            x: {
              grid: {
                color: "rgba(255, 255, 255, 0.05)"
              },
              ticks: {
                color: "#666",
                font: { size: 10 },
                maxTicksLimit: 8
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: "rgba(255, 255, 255, 0.05)"
              },
              ticks: {
                color: "#666",
                font: { size: 10 },
                callback: (value) => value + " mm"
              }
            }
          }
        }
      });
      this._chartInitializing = false;
      this._applyRainData(rainData);
    },
    /**
     * Load Chart.js library dynamically if not already loaded.
     * Returns a promise that resolves when Chart.js is ready.
     */
    _loadChartJs() {
      return new Promise((resolve) => {
        if (typeof Chart !== "undefined") {
          resolve();
          return;
        }
        if (window._chartJsLoading) {
          window._chartJsLoading.then(resolve);
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
        script.async = true;
        window._chartJsLoading = new Promise((res) => {
          script.onload = () => {
            res();
            resolve();
          };
          script.onerror = () => {
            console.error("[SSC] Failed to load Chart.js");
            res();
            resolve();
          };
        });
        document.head.appendChild(script);
      });
    }
  };

  // src/zone-cards.js
  var zoneCardMethods = {
    renderHeader() {
      const systemName = this._selectedSystem?.attributes?.system_name || this._selectedSystem?.attributes?.friendly_name || "Sprinkler System";
      const isAnyZoneActive = this.dataManager.getZones().some((z) => z.state === "watering" || z.is_running);
      return `
    <div class="panel-header">
      <h1>${systemName}</h1>
      <div class="header-actions">
        ${isAnyZoneActive ? `<button class="btn btn-danger" onclick="SmartSprinklerControlPanel.stopAllZones()">
                Stop All
              </button>` : ""}
      </div>
    </div>
  `;
    },
    renderZones() {
      const zones = this.dataManager.getZones();
      if (zones.length === 0) {
        return `<p>No zones configured.</p>`;
      }
      const zoneCards = zones.map((zone) => {
        const isActive = zone.state === "watering" || zone.is_running;
        const isDisabled = !zone.enabled;
        const isScheduled = zone.state === "scheduled";
        const isRainDelayed = zone.state === "rain_delayed";
        const cardClass = `zone-card ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}`;
        const iconClass = isActive ? "running" : isDisabled ? "idle disabled-icon" : "idle";
        const zoneIconName = isActive ? "mdi:sprinkler" : "mdi:sprinkler-variant";
        let statusClass = "idle";
        let statusText = "Idle";
        if (isActive) {
          statusClass = "watering";
          statusText = zone.remaining_time ? `${zone.remaining_time}m left` : "Running";
        } else if (isDisabled) {
          statusClass = "disabled-status";
          statusText = "Disabled";
        } else if (isScheduled) {
          statusClass = "scheduled";
          statusText = "Scheduled";
        } else if (isRainDelayed) {
          statusClass = "rain-delayed";
          statusText = "Rain Delayed";
        }
        let cardContent = "";
        if (isActive) {
          cardContent = this._renderProgressRing(zone);
        } else {
          cardContent = this._renderZoneStats(zone);
        }
        return `
      <div class="${cardClass}" data-zone-id="${zone.id}">
        <div class="zone-header">
          <div class="zone-header-left">
            <ha-icon class="zone-icon ${iconClass}" icon="${zoneIconName}"></ha-icon>
            <div class="zone-title-block">
              <span class="zone-name">${zone.name || `Zone ${zone.id}`}</span>
              <span class="zone-number">Zone ${zone.id}</span>
            </div>
          </div>
          <button class="zone-settings-btn" onclick="SmartSprinklerControlPanel.showZoneSettings(${zone.id})" title="Zone Settings">\u2699\uFE0F</button>
        </div>
        <div class="zone-status-row">
          <span class="zone-status ${statusClass}">${statusText}</span>
        </div>
        ${cardContent}
        <div class="zone-controls">
          ${isActive ? `<button class="btn btn-danger" onclick="SmartSprinklerControlPanel.stopZone(${zone.id})">Stop</button>` : `<button class="btn btn-primary btn-start" onclick="SmartSprinklerControlPanel.showDurationModal(${zone.id})" ${isDisabled || this._loadingZones?.has(zone.id) ? "disabled" : ""}>${this._loadingZones?.has(zone.id) ? "Starting..." : "Start"}</button>`}
        </div>
      </div>
    `;
      }).join("");
      return `
    <h2 class="section-title">Zones</h2>
    <div class="zones-grid">${zoneCards}</div>
  `;
    },
    _renderZoneStats(zone) {
      const stats = [];
      stats.push({
        icon: "mdi:timer-outline",
        label: "Default",
        value: `${zone.duration || 15} min`
      });
      if (zone.flow_rate && zone.flow_rate > 0) {
        stats.push({
          icon: "mdi:water",
          label: "Flow",
          value: `${zone.flow_rate} GPM`
        });
      }
      if (zone.area_sqft && zone.area_sqft > 0) {
        stats.push({
          icon: "mdi:grid",
          label: "Area",
          value: `${zone.area_sqft} sq ft`
        });
      }
      if (zone.runtime_today && zone.runtime_today > 0) {
        stats.push({
          icon: "mdi:chart-bar",
          label: "Today",
          value: `${zone.runtime_today} min`
        });
      }
      if (zone.last_run) {
        const lastRunDate = new Date(zone.last_run);
        const formattedDate = lastRunDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        stats.push({
          icon: "mdi:calendar",
          label: "Last",
          value: formattedDate
        });
      }
      const statsRows = stats.map((stat) => `
    <div class="zone-stat-row">
      <ha-icon icon="${stat.icon}"></ha-icon>
      <span class="zone-stat-label">${stat.label}</span>
      <span class="zone-stat-value">${stat.value}</span>
    </div>
  `).join("");
      return `
    <div class="zone-stats">
      ${statsRows}
    </div>
  `;
    },
    _renderProgressRing(zone) {
      const tracking = this._zoneStartTimes?.get(zone.id);
      let totalSeconds, remainingSeconds, elapsedSeconds;
      if (tracking) {
        const now = Date.now();
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1e3);
        totalSeconds = tracking.totalDuration;
        remainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
        elapsedSeconds = totalSeconds - remainingSeconds;
      } else {
        totalSeconds = (zone.watering_duration || zone.remaining_time || 30) * 60;
        remainingSeconds = (zone.remaining_time || 0) * 60;
        elapsedSeconds = totalSeconds - remainingSeconds;
      }
      const progress = totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0;
      const radius = 45;
      const circumference = 2 * Math.PI * radius;
      const strokeDashoffset = circumference * progress;
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const countdownTime = `${mins}:${secs.toString().padStart(2, "0")}`;
      const totalMins = Math.floor(totalSeconds / 60);
      const remainingMinsFloor = Math.floor(remainingSeconds / 60);
      const remainingDisplay = remainingMinsFloor < 1 && remainingSeconds > 0 ? `<1m / ${totalMins}m` : `${remainingMinsFloor}m / ${totalMins}m`;
      return `
    <div class="zone-progress-container">
      <div class="progress-ring-wrapper">
        <svg class="progress-ring" viewBox="0 0 100 100">
          <circle class="progress-ring-bg" cx="50" cy="50" r="${radius}" />
          <circle class="progress-ring-progress" cx="50" cy="50" r="${radius}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${strokeDashoffset}" />
        </svg>
        <div class="countdown-overlay">
          <span class="countdown-time">${countdownTime}</span>
          <span class="countdown-label">remaining</span>
        </div>
      </div>
      <span class="elapsed-time">${remainingDisplay}</span>
      <div class="time-adjust-controls">
        <button class="time-adjust-btn subtract" onclick="SmartSprinklerControlPanel.adjustRunningTime(${zone.id}, -5)">-5 min</button>
        <button class="time-adjust-btn add" onclick="SmartSprinklerControlPanel.adjustRunningTime(${zone.id}, 5)">+5 min</button>
      </div>
    </div>
  `;
    },
    renderWeather() {
      const weather = this.dataManager.getWeatherData();
      if (!weather?.weatherEntity) {
        return "";
      }
      return `
    <h2 class="section-title">Weather</h2>
    <div class="weather-card">
      <div class="weather-info">
        <div>
          <p>Weather Entity: ${weather.weatherEntity}</p>
          ${weather.rainDelayActive ? `<p class="rain-delay-active">Rain delay active until ${weather.rainDelayUntil || "unknown"}</p>` : ""}
        </div>
        <div>
          ${weather.rainDelayActive ? `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.disableRainDelay()">Cancel Rain Delay</button>` : `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.enableRainDelay()">Enable Rain Delay</button>`}
        </div>
      </div>
    </div>
  `;
    },
    renderNoSystems() {
      return `
    <ha-card>
      <div class="card-header">
        <h1>Smart Sprinkler Control</h1>
      </div>
      <div class="card-content">
        <p>No Smart Sprinkler Control systems found.</p>
        <p>Please configure a sprinkler system first through the integration settings.</p>
      </div>
    </ha-card>
  `;
    }
  };

  // src/schedules.js
  var scheduleMethods = {
    renderSchedules() {
      const schedules = this.dataManager.getSchedules();
      const scheduleItems = schedules.length === 0 ? '<p class="no-schedules">No schedules configured. Create one to automate watering.</p>' : schedules.map((schedule) => {
        const daysText = schedule.days_of_week?.map((d) => DAYS_OF_WEEK[d]?.short).filter(Boolean).join(", ") || "No days";
        const zoneCount = schedule.zone_ids?.length || 0;
        const statusClass = schedule.enabled ? "active" : "disabled";
        const statusText = schedule.enabled ? "Active" : "Disabled";
        return `
        <div class="schedule-item">
          <div class="schedule-info">
            <div class="schedule-header">
              <h4>${schedule.name || "Unnamed Schedule"}</h4>
              <span class="schedule-status ${statusClass}">${statusText}</span>
            </div>
            <div class="schedule-details">
              <span class="schedule-time">
                <ha-icon icon="mdi:clock-outline"></ha-icon>
                ${schedule.start_time || "00:00"}
              </span>
              <span class="schedule-days">
                <ha-icon icon="mdi:calendar"></ha-icon>
                ${daysText}
              </span>
              <span class="schedule-zones">
                <ha-icon icon="mdi:sprinkler-variant"></ha-icon>
                ${zoneCount} zone${zoneCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div class="schedule-actions">
            <button class="btn btn-icon btn-run" onclick="SmartSprinklerControlPanel.runScheduleNow('${schedule.id}')" title="Run Now">
              <ha-icon icon="mdi:play"></ha-icon>
            </button>
            <button class="btn btn-icon" onclick="SmartSprinklerControlPanel.showEditScheduleModal('${schedule.id}')" title="Edit">
              <ha-icon icon="mdi:pencil"></ha-icon>
            </button>
            <button class="btn btn-icon btn-danger-icon" onclick="SmartSprinklerControlPanel.deleteSchedule('${schedule.id}')" title="Delete">
              <ha-icon icon="mdi:delete"></ha-icon>
            </button>
          </div>
        </div>
      `;
      }).join("");
      return `
    <div class="section-header">
      <h2 class="section-title">Schedules</h2>
      <button class="btn btn-primary btn-sm" onclick="SmartSprinklerControlPanel.showCreateScheduleModal()">
        <ha-icon icon="mdi:plus"></ha-icon>
        Add Schedule
      </button>
    </div>
    <div class="schedules-list">${scheduleItems}</div>
  `;
    },
    showCreateScheduleModal() {
      this._editingSchedule = null;
      const zones = this.dataManager.getZones();
      this._scheduleFormData = {
        schedule_id: `schedule_${Date.now()}`,
        name: "",
        start_time: "06:00",
        days_of_week: [],
        zone_ids: [],
        zone_durations: {},
        enabled: true,
        skip_if_rain: true
      };
      zones.forEach((z) => {
        this._scheduleFormData.zone_durations[z.id] = z.duration || 15;
      });
      this._scheduleModalOpen = true;
      this._modalOpen = true;
      this.render();
    },
    showEditScheduleModal(scheduleId) {
      const schedules = this.dataManager.getSchedules();
      const schedule = schedules.find((s) => s.id === scheduleId);
      if (!schedule) return;
      this._editingSchedule = schedule;
      this._scheduleFormData = {
        schedule_id: schedule.id,
        name: schedule.name || "",
        start_time: schedule.start_time || "06:00",
        days_of_week: [...schedule.days_of_week || []],
        zone_ids: [...schedule.zone_ids || []],
        zone_durations: { ...schedule.zone_durations || {} },
        enabled: schedule.enabled !== false,
        skip_if_rain: schedule.skip_if_rain !== false
      };
      this._scheduleModalOpen = true;
      this._modalOpen = true;
      this.render();
    },
    closeScheduleModal(event) {
      if (event && event.target.classList.contains("modal-content")) {
        return;
      }
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._scheduleFormData = null;
      this._modalOpen = false;
      this.render();
    },
    updateScheduleField(field, value) {
      if (!this._scheduleFormData) return;
      this._scheduleFormData[field] = value;
    },
    toggleScheduleDay(dayValue) {
      if (!this._scheduleFormData) return;
      const days = this._scheduleFormData.days_of_week;
      const idx = days.indexOf(dayValue);
      if (idx >= 0) {
        days.splice(idx, 1);
      } else {
        days.push(dayValue);
        days.sort((a, b) => a - b);
      }
      this._updateScheduleModalDisplay();
    },
    toggleScheduleZone(zoneId) {
      if (!this._scheduleFormData) return;
      const zones = this._scheduleFormData.zone_ids;
      const idx = zones.indexOf(zoneId);
      if (idx >= 0) {
        zones.splice(idx, 1);
      } else {
        zones.push(zoneId);
      }
      this._updateScheduleModalDisplay();
      this._updateFireOrderList();
    },
    _updateFireOrderList() {
      const container = this.querySelector(".fire-order-list");
      if (!container) return;
      const zones = this.dataManager.getZones();
      const selectedIds = this._scheduleFormData?.zone_ids || [];
      if (selectedIds.length === 0) {
        container.innerHTML = '<div class="fire-order-empty">Select zones above</div>';
        return;
      }
      container.innerHTML = selectedIds.map((zoneId, index) => {
        const zone = zones.find((z) => z.id === zoneId);
        const name = zone?.name || `Zone ${zoneId}`;
        const duration = this._scheduleFormData.zone_durations[zoneId] || zone?.duration || 15;
        return `
      <div class="fire-order-item" draggable="true" data-zone-id="${zoneId}">
        <span class="fire-order-handle">\u2630</span>
        <span class="fire-order-num">${index + 1}</span>
        <span class="fire-order-name">${name}</span>
        <input type="number" class="fire-order-duration" value="${duration}" min="1" max="120"
               onchange="SmartSprinklerControlPanel.updateZoneDuration(${zoneId}, this.value)">
        <span class="fire-order-unit">min</span>
      </div>
    `;
      }).join("");
      this._attachDragHandlers();
    },
    _attachDragHandlers() {
      const container = this.querySelector(".fire-order-list");
      if (!container) return;
      const items = container.querySelectorAll(".fire-order-item");
      items.forEach((item) => {
        item.addEventListener("dragstart", (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.dataset.zoneId);
          item.classList.add("dragging");
        });
        item.addEventListener("dragend", () => {
          item.classList.remove("dragging");
        });
        item.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const dragging = container.querySelector(".dragging");
          if (dragging && dragging !== item) {
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
              container.insertBefore(dragging, item);
            } else {
              container.insertBefore(dragging, item.nextSibling);
            }
          }
        });
        item.addEventListener("drop", (e) => {
          e.preventDefault();
          const newOrder = Array.from(container.querySelectorAll(".fire-order-item")).map((el) => parseInt(el.dataset.zoneId));
          this._scheduleFormData.zone_ids = newOrder;
          this._updateFireOrderList();
        });
      });
    },
    updateZoneDuration(zoneId, duration) {
      if (!this._scheduleFormData) return;
      this._scheduleFormData.zone_durations[zoneId] = parseInt(duration) || 15;
    },
    _updateScheduleModalDisplay() {
      const dayBtns = this.querySelectorAll(".day-toggle-btn");
      dayBtns.forEach((btn) => {
        const day = parseInt(btn.dataset.day);
        const isSelected = this._scheduleFormData?.days_of_week.includes(day);
        btn.classList.toggle("selected", isSelected);
      });
      const zoneChecks = this.querySelectorAll(".zone-checkbox");
      zoneChecks.forEach((chk) => {
        const zoneId = parseInt(chk.dataset.zoneId);
        chk.checked = this._scheduleFormData?.zone_ids.includes(zoneId);
      });
    },
    async saveSchedule() {
      if (!this._scheduleFormData || !this._selectedSystem) return;
      const data = this._scheduleFormData;
      if (!data.name.trim()) {
        this.showError("Schedule name is required");
        return;
      }
      if (data.days_of_week.length === 0) {
        this.showError("Select at least one day");
        return;
      }
      if (data.zone_ids.length === 0) {
        this.showError("Select at least one zone");
        return;
      }
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._modalOpen = false;
      this.render();
      try {
        const zoneDurations = {};
        data.zone_ids.forEach((zoneId) => {
          zoneDurations[zoneId] = data.zone_durations[zoneId] || 15;
        });
        const scheduleData = {
          schedule_id: data.schedule_id,
          name: data.name.trim(),
          start_time: data.start_time,
          days_of_week: data.days_of_week,
          zone_ids: data.zone_ids,
          zone_durations: zoneDurations,
          enabled: data.enabled,
          skip_if_rain: data.skip_if_rain
        };
        await this.serviceClient.createSchedule(
          this._selectedSystem.entity_id,
          scheduleData
        );
        await this.loadSystemData(true);
      } catch (error) {
        console.error("[SSC] Failed to save schedule:", error);
        this.showError("Failed to save schedule");
      }
    },
    async deleteSchedule(scheduleId) {
      if (!this._selectedSystem) return;
      if (!confirm("Delete this schedule?")) return;
      try {
        await this.serviceClient.deleteSchedule(
          this._selectedSystem.entity_id,
          scheduleId
        );
        await this.loadSystemData(true);
      } catch (error) {
        console.error("[SSC] Failed to delete schedule:", error);
        this.showError("Failed to delete schedule");
      }
    },
    async runScheduleNow(scheduleId) {
      if (!this._selectedSystem) return;
      console.log("[SSC] Running schedule:", scheduleId);
      try {
        await this.serviceClient.runSchedule(
          this._selectedSystem.entity_id,
          scheduleId
        );
        await this.loadSystemData(true);
      } catch (error) {
        console.error("[SSC] Failed to run schedule:", error);
        this.showError("Failed to run schedule");
      }
    },
    renderScheduleModal() {
      if (!this._scheduleModalOpen || !this._scheduleFormData) {
        return "";
      }
      const data = this._scheduleFormData;
      const zones = this.dataManager.getZones();
      const isEditing = this._editingSchedule !== null;
      const dayButtons = DAYS_OF_WEEK.map((day) => {
        const isSelected = data.days_of_week.includes(day.value);
        return `
      <button type="button" class="day-toggle-btn ${isSelected ? "selected" : ""}"
              data-day="${day.value}"
              onclick="SmartSprinklerControlPanel.toggleScheduleDay(${day.value})">
        ${day.short}
      </button>
    `;
      }).join("");
      const zoneCheckboxes = zones.map((zone) => {
        const isSelected = data.zone_ids.includes(zone.id);
        return `
      <label class="zone-checkbox-label">
        <input type="checkbox" class="zone-checkbox" data-zone-id="${zone.id}"
               ${isSelected ? "checked" : ""}
               onchange="SmartSprinklerControlPanel.toggleScheduleZone(${zone.id})">
        <span>${zone.name || `Zone ${zone.id}`}</span>
      </label>
    `;
      }).join("");
      const fireOrderItems = data.zone_ids.map((zoneId, index) => {
        const zone = zones.find((z) => z.id === zoneId);
        const name = zone?.name || `Zone ${zoneId}`;
        const duration = data.zone_durations[zoneId] || zone?.duration || 15;
        return `
      <div class="fire-order-item" draggable="true" data-zone-id="${zoneId}">
        <span class="fire-order-handle">\u2630</span>
        <span class="fire-order-num">${index + 1}</span>
        <span class="fire-order-name">${name}</span>
        <input type="number" class="fire-order-duration" value="${duration}" min="1" max="120"
               onchange="SmartSprinklerControlPanel.updateZoneDuration(${zoneId}, this.value)">
        <span class="fire-order-unit">min</span>
      </div>
    `;
      }).join("");
      const fireOrderContent = data.zone_ids.length === 0 ? '<div class="fire-order-empty">Select zones above</div>' : fireOrderItems;
      return `
    <div class="modal-overlay" onclick="SmartSprinklerControlPanel.closeScheduleModal(event)">
      <div class="modal-content schedule-modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>${isEditing ? "Edit Schedule" : "Create Schedule"}</h2>
          <button class="modal-close" onclick="SmartSprinklerControlPanel.closeScheduleModal()">&times;</button>
        </div>
        <div class="modal-body schedule-form">
          <div class="form-row-2col">
            <div class="form-group">
              <label>Schedule Name</label>
              <input type="text" class="form-input" value="${data.name}"
                     placeholder="e.g., Morning Watering"
                     onchange="SmartSprinklerControlPanel.updateScheduleField('name', this.value)">
            </div>
            <div class="form-group">
              <label>Start Time</label>
              <input type="time" class="form-input" value="${data.start_time}"
                     onchange="SmartSprinklerControlPanel.updateScheduleField('start_time', this.value)">
            </div>
          </div>
          <div class="form-group">
            <label>Days</label>
            <div class="day-toggle-group">
              ${dayButtons}
            </div>
          </div>
          <div class="form-group">
            <label>Select Zones</label>
            <div class="zone-checkbox-group">
              ${zoneCheckboxes}
            </div>
          </div>
          <div class="form-group">
            <label>Fire Order <span class="label-hint">(drag to reorder)</span></label>
            <div class="fire-order-list">
              ${fireOrderContent}
            </div>
          </div>
          <div class="form-group-inline">
            <label class="checkbox-label-inline">
              <input type="checkbox" ${data.enabled ? "checked" : ""}
                     onchange="SmartSprinklerControlPanel.updateScheduleField('enabled', this.checked)">
              Enabled
            </label>
            <label class="checkbox-label-inline">
              <input type="checkbox" ${data.skip_if_rain ? "checked" : ""}
                     onchange="SmartSprinklerControlPanel.updateScheduleField('skip_if_rain', this.checked)">
              Skip if Rain
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.closeScheduleModal()">Cancel</button>
          <button class="btn btn-primary" onclick="SmartSprinklerControlPanel.saveSchedule()">
            ${isEditing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  `;
    }
  };

  // src/modals.js
  var modalMethods = {
    renderDurationModal() {
      if (!this._durationModalOpen || !this._durationModalZone) {
        return "";
      }
      const zone = this._durationModalZone;
      const duration = this._selectedDuration;
      const quickDurations = [5, 10, 15, 30, 45, 60, 90];
      const quickButtons = quickDurations.map((d) => {
        const isSelected = d === duration;
        const label = d >= 60 ? `${d / 60}h` : `${d}m`;
        return `
      <button class="quick-duration-btn ${isSelected ? "selected" : ""}"
              onclick="SmartSprinklerControlPanel.setDuration(${d})">
        ${label}
      </button>
    `;
      }).join("");
      return `
    <div class="modal-overlay" onclick="SmartSprinklerControlPanel.closeDurationModal(event)">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>Start Zone</h2>
          <button class="modal-close" onclick="SmartSprinklerControlPanel.closeDurationModal()">&times;</button>
        </div>
        <p class="modal-zone-info">${zone.name || `Zone ${zone.id}`}</p>
        <div class="duration-display">
          <div class="duration-controls">
            <button class="duration-btn" onclick="SmartSprinklerControlPanel.adjustDuration(-5)">\u2212</button>
            <div>
              <div class="duration-value">${duration}</div>
              <div class="duration-unit">minutes</div>
            </div>
            <button class="duration-btn" onclick="SmartSprinklerControlPanel.adjustDuration(5)">+</button>
          </div>
        </div>
        <div class="quick-durations">
          ${quickButtons}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.closeDurationModal()">Cancel</button>
          <button class="btn btn-primary" onclick="SmartSprinklerControlPanel.confirmStartZone()">Start</button>
        </div>
      </div>
    </div>
  `;
    },
    // Duration modal methods
    showDurationModal(zoneId) {
      const zones = this.dataManager.getZones();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) return;
      this._durationModalZone = zone;
      this._durationModalOpen = true;
      this._selectedDuration = zone.duration || 30;
      this._modalOpen = true;
      this.render();
    },
    closeDurationModal(event) {
      if (event && event.target.classList.contains("modal-content")) {
        return;
      }
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._modalOpen = false;
      this.render();
    },
    setDuration(minutes) {
      this._selectedDuration = Math.max(1, Math.min(180, minutes));
      this._updateModalDisplay();
    },
    adjustDuration(delta) {
      this._selectedDuration = Math.max(1, Math.min(180, this._selectedDuration + delta));
      this._updateModalDisplay();
    },
    /**
     * Update only the modal display elements without full re-render.
     * Prevents flickering when adjusting duration.
     */
    _updateModalDisplay() {
      const durationValue = this.querySelector(".duration-value");
      if (durationValue) {
        durationValue.textContent = this._selectedDuration;
      }
      const quickButtons = this.querySelectorAll(".quick-duration-btn");
      quickButtons.forEach((btn) => {
        const btnDuration = parseInt(btn.textContent.replace(/[mh]/g, ""));
        const actualDuration = btn.textContent.includes("h") ? btnDuration * 60 : btnDuration;
        btn.classList.toggle("selected", actualDuration === this._selectedDuration);
      });
    },
    async confirmStartZone() {
      if (!this._durationModalZone) return;
      const zoneId = this._durationModalZone.id;
      const duration = this._selectedDuration;
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._modalOpen = false;
      this.render();
      await this.startZone(zoneId, duration);
    },
    showZoneSettings(zoneId) {
      const zones = this.dataManager.getZones();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) return;
      this._settingsModalZone = zone;
      this._settingsModalOpen = true;
      this._settingsFormData = {
        name: zone.name || `Zone ${zone.id}`,
        duration: zone.duration || 15,
        enabled: zone.enabled !== false,
        flow_rate: zone.flow_rate || "",
        area_sqft: zone.area_sqft || ""
      };
      this._modalOpen = true;
      this.render();
    },
    closeSettingsModal(event) {
      if (event && event.target.classList.contains("modal-content")) {
        return;
      }
      this._settingsModalOpen = false;
      this._settingsModalZone = null;
      this._modalOpen = false;
      this.render();
    },
    updateSettingsField(field, value) {
      if (!this._settingsFormData) return;
      this._settingsFormData[field] = value;
    },
    async saveZoneSettings() {
      if (!this._settingsModalZone || !this._selectedSystem) return;
      const zoneId = this._settingsModalZone.id;
      const data = this._settingsFormData;
      this._settingsModalOpen = false;
      this._settingsModalZone = null;
      this._modalOpen = false;
      this.render();
      try {
        const settings = {
          name: data.name,
          duration: parseInt(data.duration) || 15,
          enabled: data.enabled
        };
        if (data.flow_rate && parseFloat(data.flow_rate) > 0) {
          settings.flow_rate = parseFloat(data.flow_rate);
        }
        if (data.area_sqft && parseFloat(data.area_sqft) > 0) {
          settings.area_sqft = parseFloat(data.area_sqft);
        }
        await this.serviceClient.updateZoneSettings(
          this._selectedSystem.entity_id,
          zoneId,
          settings
        );
        await this.loadSystemData(true);
      } catch (error) {
        console.error("[SSC] Failed to save zone settings:", error);
        this.showError("Failed to save zone settings");
      }
    },
    renderZoneSettingsModal() {
      if (!this._settingsModalOpen || !this._settingsModalZone) {
        return "";
      }
      const zone = this._settingsModalZone;
      const data = this._settingsFormData || {};
      return `
    <div class="modal-overlay" onclick="SmartSprinklerControlPanel.closeSettingsModal(event)">
      <div class="modal-content settings-modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>Zone ${zone.id} Settings</h2>
          <button class="modal-close" onclick="SmartSprinklerControlPanel.closeSettingsModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="settings-form">
            <div class="form-group">
              <label>Zone Name</label>
              <input type="text" class="form-input" value="${data.name || ""}"
                onchange="SmartSprinklerControlPanel.updateSettingsField('name', this.value)">
            </div>
            <div class="form-group">
              <label>Default Duration (minutes)</label>
              <input type="number" class="form-input" min="1" max="120" value="${data.duration || 15}"
                onchange="SmartSprinklerControlPanel.updateSettingsField('duration', this.value)">
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" ${data.enabled ? "checked" : ""}
                  onchange="SmartSprinklerControlPanel.updateSettingsField('enabled', this.checked)">
                Zone Enabled
              </label>
            </div>
            <div class="form-divider"></div>
            <div class="form-group">
              <label>Flow Rate (GPM) <span class="optional">optional</span></label>
              <input type="number" class="form-input" step="0.1" min="0" value="${data.flow_rate || ""}"
                placeholder="e.g., 2.5"
                onchange="SmartSprinklerControlPanel.updateSettingsField('flow_rate', this.value)">
            </div>
            <div class="form-group">
              <label>Area (sq ft) <span class="optional">optional</span></label>
              <input type="number" class="form-input" min="0" value="${data.area_sqft || ""}"
                placeholder="e.g., 500"
                onchange="SmartSprinklerControlPanel.updateSettingsField('area_sqft', this.value)">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.closeSettingsModal()">Cancel</button>
          <button class="btn btn-primary" onclick="SmartSprinklerControlPanel.saveZoneSettings()">Save</button>
        </div>
      </div>
    </div>
  `;
    }
  };

  // src/panel.js
  var SmartSprinklerControlPanel = class extends HTMLElement {
    constructor() {
      super();
      this._hass = void 0;
      this._narrow = false;
      this._selectedSystem = null;
      this._systems = [];
      this._modalOpen = false;
      this._editingZone = null;
      this._editingSchedule = null;
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._selectedDuration = 30;
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._scheduleFormData = null;
      this._countdownInterval = null;
      this._healthCheckInterval = null;
      this._zoneStartTimes = /* @__PURE__ */ new Map();
      this._renderSignature = null;
      this._rainChart = null;
      this._chartInitializing = false;
      this._rainData = null;
      this._rainLastFetch = 0;
      this._rainFetchInterval = 5 * 60 * 1e3;
      this._rainFetchInflight = null;
      this._rainRefreshInterval = null;
      this._visibilityHandler = null;
      this.serviceClient = new ServiceClient(this._hass);
      this.dataManager = new DataManager(this._hass, this.serviceClient);
    }
    set hass(hass) {
      const oldHass = this._hass;
      this._hass = hass;
      window.smartSprinklerControlPanel = this;
      this.serviceClient.setHass(hass);
      this.dataManager.setHass(hass);
      if (hass && (!oldHass || oldHass.connection !== hass.connection)) {
        this.dataManager.setupEventListeners();
        this.dataManager.onDataChange(() => this.loadSystemData());
      }
      if (oldHass && hass && oldHass.states !== hass.states) {
        this.loadSystemData();
      }
      if (!this._modalOpen) {
        this.loadSystemData();
      }
    }
    set narrow(narrow) {
      this._narrow = narrow;
    }
    connectedCallback() {
      window.smartSprinklerControlPanel = this;
      this.loadSystemData();
      this.render();
      this._startCountdownTimer();
      this._startHealthCheck();
      this._startRainRefresh();
      this._visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          console.log("[SSC] Tab became visible, checking panel state...");
          if (this._hass) {
            this.dataManager.setHass(this._hass);
            this.dataManager.setupEventListeners();
          }
          const content = this.innerHTML?.trim();
          if (!content || content.length < 100 || !this.querySelector(".sprinkler-panel")) {
            console.warn("[SSC] Panel empty after wake, forcing re-render");
            this.render();
          } else {
            this.loadSystemData();
          }
          setTimeout(async () => {
            if (!this._rainChart || !this.querySelector("#rainChart")) {
              await this._initRainChart();
            }
          }, 200);
        }
      };
      document.addEventListener("visibilitychange", this._visibilityHandler);
    }
    disconnectedCallback() {
      if (window.smartSprinklerControlPanel === this) {
        delete window.smartSprinklerControlPanel;
      }
      this._stopCountdownTimer();
      this._stopHealthCheck();
      this._stopRainRefresh();
      if (this._rainChart) {
        this._rainChart.destroy();
        this._rainChart = null;
      }
      if (this._visibilityHandler) {
        document.removeEventListener("visibilitychange", this._visibilityHandler);
        this._visibilityHandler = null;
      }
      this.dataManager.destroy();
    }
    /**
     * Start the countdown timer interval for updating progress rings.
     * Updates every second when zones are running.
     */
    _startCountdownTimer() {
      if (this._countdownInterval) return;
      this._countdownInterval = setInterval(() => {
        const zones = this.dataManager.getZones();
        const hasRunningZone = zones.some((z) => z.state === "watering" || z.is_running);
        if (hasRunningZone && !this._modalOpen) {
          this._updateCountdownDisplays();
        }
      }, 1e3);
    }
    /**
     * Stop the countdown timer interval.
     */
    _stopCountdownTimer() {
      if (this._countdownInterval) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
      }
    }
    /**
     * Start the throttled precipitation refresh timer. Forces a cache
     * refetch every _rainFetchInterval (5 min) and pushes new data into the
     * existing chart via update() — it never rebuilds the chart, so it
     * cannot cause flicker. Renders in between reuse the cached data.
     */
    _startHealthCheck() {
      if (this._healthCheckInterval) return;
      this._healthCheckInterval = setInterval(async () => {
        const content = this.innerHTML?.trim();
        if (!content || content.length < 100) {
          console.warn("[SSC] Panel appears empty, forcing re-render");
          this.render();
          return;
        }
        const isHealthy = await this.dataManager.checkConnection();
        if (!isHealthy) {
          console.warn("[SSC] Connection unhealthy, attempting recovery");
          if (this._hass) {
            this.dataManager.setHass(this._hass);
            await this.dataManager.setupEventListeners();
            this.loadSystemData();
          }
          return;
        }
        const zones = this.dataManager.getZones();
        const hasRunningZone = zones.some((z) => z.state === "watering" || z.is_running);
        const timeSinceUpdate = Date.now() - this.dataManager.getLastUpdate();
        if (hasRunningZone && timeSinceUpdate > 6e4) {
          console.warn("[SSC] Data appears stale, re-subscribing");
          await this.dataManager.setupEventListeners();
          this.loadSystemData();
        }
      }, 3e4);
    }
    /**
     * Stop health check interval
     */
    _stopHealthCheck() {
      if (this._healthCheckInterval) {
        clearInterval(this._healthCheckInterval);
        this._healthCheckInterval = null;
      }
    }
    /**
     * Update countdown displays without full re-render.
     * Uses DOM manipulation for smooth updates.
     */
    _updateCountdownDisplays() {
      const zones = this.dataManager.getZones();
      const now = Date.now();
      zones.forEach((zone) => {
        const isRunning = zone.state === "watering" || zone.is_running;
        if (!isRunning) {
          this._zoneStartTimes.delete(zone.id);
          return;
        }
        const card = this.querySelector(`[data-zone-id="${zone.id}"]`);
        if (!card) return;
        if (!this._zoneStartTimes.has(zone.id)) {
          const totalSeconds2 = (zone.watering_duration || zone.remaining_time || 30) * 60;
          this._zoneStartTimes.set(zone.id, {
            startedAt: now,
            initialRemaining: totalSeconds2,
            // Start at full duration
            totalDuration: totalSeconds2
          });
          console.log("[SSC] Initialized tracking for zone", zone.id, ":", totalSeconds2, "seconds");
        }
        const tracking = this._zoneStartTimes.get(zone.id);
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1e3);
        const remainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
        const totalSeconds = tracking.totalDuration;
        const elapsedSeconds = totalSeconds - remainingSeconds;
        const progress = totalSeconds > 0 ? elapsedSeconds / totalSeconds : 0;
        const countdownEl = card.querySelector(".countdown-time");
        if (countdownEl) {
          const mins = Math.floor(remainingSeconds / 60);
          const secs = remainingSeconds % 60;
          countdownEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
        }
        const elapsedEl = card.querySelector(".elapsed-time");
        if (elapsedEl) {
          const totalMins = Math.floor(totalSeconds / 60);
          const remainingMinsFloor = Math.floor(remainingSeconds / 60);
          elapsedEl.textContent = remainingMinsFloor < 1 && remainingSeconds > 0 ? `<1m / ${totalMins}m` : `${remainingMinsFloor}m / ${totalMins}m`;
        }
        const progressRing = card.querySelector(".progress-ring-progress");
        if (progressRing) {
          const circumference = 2 * Math.PI * 45;
          const offset = circumference * progress;
          progressRing.style.strokeDashoffset = offset;
        }
        const statusBadge = card.querySelector(".zone-status");
        if (statusBadge) {
          const remainingMins = Math.ceil(remainingSeconds / 60);
          statusBadge.textContent = `${remainingMins}m left`;
        }
        if (remainingSeconds <= 0) {
          if (!this._stoppingZones) this._stoppingZones = /* @__PURE__ */ new Set();
          if (!this._stoppingZones.has(zone.id)) {
            this._stoppingZones.add(zone.id);
            this._zoneStartTimes.delete(zone.id);
            console.log("[SSC] Timer reached zero for zone", zone.id, "- stopping zone");
            this.stopZone(zone.id).then(() => {
              setTimeout(() => this._stoppingZones?.delete(zone.id), 5e3);
            });
          }
        }
      });
    }
    async loadSystemData(bypassCache = false) {
      this._systems = await this.dataManager.loadSystemData(bypassCache);
      this._selectedSystem = this.dataManager.getSelectedSystem();
      this._syncCountdownTracking();
      if (!this._modalOpen) {
        const signature = this._computeRenderSignature();
        if (bypassCache || signature !== this._renderSignature) {
          this._renderSignature = signature;
          this.requestUpdate();
        }
      }
    }
    /**
     * Compute a lightweight signature of the sprinkler-relevant state used by
     * render(). Used to suppress redundant full re-renders on unrelated hass
     * pushes. Excludes per-second countdown fields (remaining_time) since those
     * are handled by _updateCountdownDisplays() without a full render.
     * @returns {string} Stable signature of render-affecting state.
     */
    _computeRenderSignature() {
      const sel = this._selectedSystem?.entity_id || "";
      const systems = (this._systems || []).map((s) => s.entity_id).sort().join(",");
      const zones = this.dataManager.getZones().map((z) => [
        z.id,
        z.state,
        z.is_running ? 1 : 0,
        z.enabled ? 1 : 0,
        z.name,
        z.watering_duration,
        z.duration
      ]);
      const schedules = this.dataManager.getSchedules().map((s) => [
        s.id,
        s.enabled ? 1 : 0,
        s.name,
        s.next_run
      ]);
      const weather = this.dataManager.getWeatherData() || {};
      return JSON.stringify({
        sel,
        systems,
        zones,
        schedules,
        rainDelayActive: weather.rainDelayActive,
        rainDelayUntil: weather.rainDelayUntil
      });
    }
    /**
     * Sync local countdown tracking with backend state.
     * Resets tracking for zones where backend time differs significantly.
     */
    _syncCountdownTracking() {
      const zones = this.dataManager.getZones();
      const now = Date.now();
      zones.forEach((zone) => {
        const isRunning = zone.state === "watering" || zone.is_running;
        const tracking = this._zoneStartTimes.get(zone.id);
        if (!isRunning) {
          this._zoneStartTimes.delete(zone.id);
          return;
        }
        if (tracking) {
          const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1e3);
          const ourRemainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
          const backendRemainingSeconds = (zone.remaining_time || 0) * 60;
          if (Math.abs(ourRemainingSeconds - backendRemainingSeconds) > 30) {
            console.log("[SSC] Resyncing zone", zone.id, "tracking with backend");
            this._zoneStartTimes.set(zone.id, {
              startedAt: now,
              initialRemaining: backendRemainingSeconds,
              totalDuration: (zone.watering_duration || zone.remaining_time || 30) * 60
            });
          }
        }
      });
    }
    requestUpdate() {
      this.render();
    }
    // Zone control methods
    async startZone(zoneId, duration = 15) {
      console.log("[SSC] startZone called:", zoneId, duration, "at", (/* @__PURE__ */ new Date()).toISOString());
      if (!this._selectedSystem) {
        console.error("[SSC] No selected system!");
        return;
      }
      if (!this._loadingZones) this._loadingZones = /* @__PURE__ */ new Set();
      this._loadingZones.add(zoneId);
      this._updateZoneLoadingState(zoneId, true);
      try {
        console.log("[SSC] Calling service for entity:", this._selectedSystem.entity_id);
        await this.serviceClient.startZone(
          this._selectedSystem.entity_id,
          zoneId,
          duration
        );
        console.log("[SSC] Service call completed at", (/* @__PURE__ */ new Date()).toISOString());
        await this._pollForStateChange(zoneId, "watering", 8e3);
      } catch (error) {
        console.error("[SSC] Failed to start zone:", error);
        this.showError("Failed to start zone");
      } finally {
        this._loadingZones?.delete(zoneId);
        this._updateZoneLoadingState(zoneId, false);
      }
    }
    /**
     * Update zone card UI to show/hide loading state without full re-render.
     */
    _updateZoneLoadingState(zoneId, isLoading) {
      const card = this.querySelector(`.zone-card[data-zone-id="${zoneId}"]`);
      if (!card) return;
      const startBtn = card.querySelector(".btn-start");
      if (startBtn) {
        startBtn.disabled = isLoading;
        startBtn.textContent = isLoading ? "Starting..." : "Start";
        startBtn.classList.toggle("loading", isLoading);
      }
    }
    async _pollForStateChange(zoneId, expectedState, timeoutMs) {
      const startTime = Date.now();
      const pollInterval = 200;
      while (Date.now() - startTime < timeoutMs) {
        this.render();
        const zones = this.dataManager.getZones();
        const zone = zones.find((z) => z.id === zoneId);
        if (zone?.state === expectedState) {
          console.log("[SSC] State updated to", expectedState, "after", Date.now() - startTime, "ms");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      console.log("[SSC] Timeout waiting for state change, forcing render");
      this.render();
    }
    async _delayedRefresh(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await this.loadSystemData(true);
    }
    async stopZone(zoneId) {
      console.log("[SSC] stopZone called:", zoneId, "at", (/* @__PURE__ */ new Date()).toISOString());
      if (!this._selectedSystem) return;
      try {
        await this.serviceClient.stopZone(
          this._selectedSystem.entity_id,
          zoneId
        );
        console.log("[SSC] Stop service completed at", (/* @__PURE__ */ new Date()).toISOString());
        await this._pollForStateChange(zoneId, "idle", 3e3);
      } catch (error) {
        console.error("Failed to stop zone:", error);
        this.showError("Failed to stop zone");
      }
    }
    async stopAllZones() {
      if (!this._selectedSystem) return;
      try {
        await this.serviceClient.stopAllZones(this._selectedSystem.entity_id);
        this.loadSystemData(true);
      } catch (error) {
        console.error("Failed to stop all zones:", error);
        this.showError("Failed to stop all zones");
      }
    }
    /**
     * Show zone settings modal/panel (placeholder for future implementation).
     *
     * @param {number} zoneId - The zone ID to show settings for
     */
    showZoneSettings(zoneId) {
      console.log("[SSC] showZoneSettings called for zone:", zoneId);
      const zones = this.dataManager.getZones();
      const zone = zones.find((z) => z.id === zoneId);
      if (zone) {
        console.log("[SSC] Zone settings:", zone);
        alert(`Zone Settings for "${zone.name || `Zone ${zone.id}`}"

Settings panel coming soon!`);
      }
    }
    /**
     * Adjust the remaining time for a currently running zone.
     *
     * @param {number} zoneId - The zone ID to adjust
     * @param {number} deltaMinutes - Minutes to add (positive) or subtract (negative)
     */
    async adjustRunningTime(zoneId, deltaMinutes) {
      console.log("[SSC] adjustRunningTime called:", zoneId, deltaMinutes);
      if (!this._selectedSystem) return;
      const zones = this.dataManager.getZones();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone || zone.state !== "watering" && !zone.is_running) {
        console.warn("[SSC] Zone not running, cannot adjust time");
        return;
      }
      let currentRemainingSeconds;
      const tracking = this._zoneStartTimes.get(zoneId);
      if (tracking) {
        const now = Date.now();
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1e3);
        currentRemainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
      } else {
        currentRemainingSeconds = (zone.remaining_time || 0) * 60;
      }
      const currentRemainingMinutes = Math.ceil(currentRemainingSeconds / 60);
      const newRemaining = Math.max(5, currentRemainingMinutes + deltaMinutes);
      console.log("[SSC] Current remaining:", currentRemainingMinutes, "min, new:", newRemaining, "min");
      try {
        await this.serviceClient.adjustZoneTime(
          this._selectedSystem.entity_id,
          zoneId,
          newRemaining
        );
        console.log("[SSC] Time adjustment completed");
        if (tracking) {
          const now = Date.now();
          const elapsedSoFar = Math.floor((now - tracking.startedAt) / 1e3);
          const elapsedFromOriginal = tracking.totalDuration - tracking.initialRemaining + elapsedSoFar;
          const newTotal = Math.max(newRemaining * 60, elapsedFromOriginal + newRemaining * 60);
          this._zoneStartTimes.set(zoneId, {
            startedAt: now,
            initialRemaining: newRemaining * 60,
            totalDuration: newTotal
          });
        }
        await this.loadSystemData(true);
      } catch (error) {
        console.error("[SSC] Failed to adjust zone time:", error);
        this.showError("Failed to adjust zone time");
      }
    }
    // Rain delay methods
    async enableRainDelay(hours = 24) {
      if (!this._selectedSystem) return;
      try {
        await this.serviceClient.enableRainDelay(
          this._selectedSystem.entity_id,
          hours
        );
        this.loadSystemData(true);
      } catch (error) {
        console.error("Failed to enable rain delay:", error);
        this.showError("Failed to enable rain delay");
      }
    }
    async disableRainDelay() {
      if (!this._selectedSystem) return;
      try {
        await this.serviceClient.disableRainDelay(
          this._selectedSystem.entity_id
        );
        this.loadSystemData(true);
      } catch (error) {
        console.error("Failed to disable rain delay:", error);
        this.showError("Failed to disable rain delay");
      }
    }
    // Error display
    showError(message) {
      console.error(message);
      alert(message);
    }
    // Debug: Toggle a switch entity directly
    async toggleSwitch(entityId) {
      if (!this._hass) return;
      const currentState = this._hass.states[entityId]?.state;
      const service = currentState === "on" ? "turn_off" : "turn_on";
      const domain = entityId.split(".")[0];
      try {
        await this._hass.callService(domain, service, {
          entity_id: entityId
        });
        setTimeout(() => this.loadSystemData(true), 500);
      } catch (error) {
        console.error("Failed to toggle switch:", error);
        this.showError(`Failed to toggle ${entityId}`);
      }
    }
    // Debug: Stop all sprinkler switches directly
    async stopAllSwitches() {
      if (!this._hass) return;
      const switchEntities = Object.keys(this._hass.states).filter((id) => id.startsWith("switch.sprinkler_") || id.startsWith("input_boolean.zone_"));
      try {
        for (const entityId of switchEntities) {
          const domain = entityId.split(".")[0];
          await this._hass.callService(domain, "turn_off", {
            entity_id: entityId
          });
        }
        setTimeout(() => this.loadSystemData(true), 500);
      } catch (error) {
        console.error("Failed to stop all switches:", error);
        this.showError("Failed to stop all switches");
      }
    }
    /**
     * Render the rain accumulation graph section.
     * Shows last 24 hours of rain data.
     */
    render() {
      if (!this._systems.length) {
        this.innerHTML = this.renderNoSystems();
        return;
      }
      this.innerHTML = `
    ${this.renderStyles()}
    <div class="sprinkler-panel">
      ${this.renderHeader()}
      ${this._renderRainGraph()}
      ${this.renderZones()}
      ${this.renderSchedules()}
      ${this.renderWeather()}
      ${this.renderDebugSection()}
    </div>
    ${this.renderDurationModal()}
    ${this.renderZoneSettingsModal()}
    ${this.renderScheduleModal()}
  `;
      this.attachEventListeners();
      this._loadChartJs().then(() => {
        setTimeout(async () => await this._initRainChart(), 50);
      });
    }
    renderDebugSection() {
      if (!this._hass) return "";
      const systemEntity = this._selectedSystem?.entity_id;
      const systemState = systemEntity ? this._hass.states[systemEntity] : null;
      const switchEntities = Object.entries(this._hass.states).filter(([id]) => id.startsWith("switch.sprinkler_")).sort(([a], [b]) => a.localeCompare(b));
      const zoneStateEntities = Object.entries(this._hass.states).filter(([id]) => id.startsWith("input_boolean.zone_")).sort(([a], [b]) => a.localeCompare(b));
      switchEntities.map(([entityId, state]) => {
        const isOn = state.state === "on";
        return `
      <tr>
        <td>${entityId}</td>
        <td class="entity-state ${isOn ? "state-on" : "state-off"}">${state.state}</td>
        <td>${state.attributes?.friendly_name || "-"}</td>
        <td>
          <button class="btn btn-small ${isOn ? "btn-danger" : "btn-primary"}"
                  onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">
            ${isOn ? "Turn Off" : "Turn On"}
          </button>
        </td>
      </tr>
    `;
      }).join("");
      zoneStateEntities.map(([entityId, state]) => {
        const isOn = state.state === "on";
        return `
      <tr>
        <td>${entityId}</td>
        <td class="entity-state ${isOn ? "state-on" : "state-off"}">${state.state}</td>
        <td>
          <button class="btn btn-small ${isOn ? "btn-danger" : "btn-primary"}"
                  onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">
            ${isOn ? "Turn Off" : "Turn On"}
          </button>
        </td>
      </tr>
    `;
      }).join("");
      const compactSwitchRows = switchEntities.map(([entityId, state]) => {
        const zoneNum = entityId.replace("switch.sprinkler_", "");
        const isOn = state.state === "on";
        return `<span class="debug-chip ${isOn ? "on" : "off"}" onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">Z${zoneNum}: ${isOn ? "ON" : "off"}</span>`;
      }).join("");
      return `
    <h2 class="section-title" style="font-size:14px;margin:12px 0 8px;">\u{1F527} Debug</h2>
    <div class="debug-section debug-compact">
      <div class="debug-grid">
        <div class="debug-col">
          <div class="debug-label">System</div>
          <div class="debug-value">${systemState?.state || "-"} (${systemState?.attributes?.active_zones || 0} active)</div>
          <div class="debug-label">Switches</div>
          <div class="debug-chips">${compactSwitchRows}</div>
          <button class="btn btn-danger btn-xs" onclick="SmartSprinklerControlPanel.stopAllSwitches()">Stop All</button>
        </div>
        <div class="debug-col">
          ${this._renderTimerDebugCompact()}
        </div>
        <div class="debug-col">
          ${this._renderZoneDebugCompact()}
        </div>
      </div>
    </div>
  `;
    }
    /**
     * Render compact timer debug - just running zones.
     */
    _renderTimerDebugCompact() {
      const zones = this.dataManager.getZones();
      const now = Date.now();
      const runningZones = zones.filter((z) => z.state === "watering" || z.is_running);
      if (runningZones.length === 0) {
        return '<div class="debug-label">Timer</div><div class="debug-value">No zones running</div>';
      }
      const rows = runningZones.map((zone) => {
        const tracking = this._zoneStartTimes?.get(zone.id);
        let localRemain = "-";
        if (tracking) {
          const elapsed = Math.floor((now - tracking.startedAt) / 1e3);
          const remainSec = Math.max(0, tracking.initialRemaining - elapsed);
          localRemain = `${Math.floor(remainSec / 60)}:${(remainSec % 60).toString().padStart(2, "0")}`;
        }
        return `
      <div class="debug-row">
        <span>Z${zone.id}</span>
        <span>BE:${zone.remaining_time ?? "-"}/${zone.watering_duration ?? "-"}m</span>
        <span>Local:${localRemain}</span>
      </div>`;
      }).join("");
      return `<div class="debug-label">Timer (Running)</div>${rows}`;
    }
    /**
     * Render compact zone states.
     */
    _renderZoneDebugCompact() {
      const zones = this.dataManager.getZones();
      const rows = zones.map((z) => {
        const st = z.state === "watering" ? "RUN" : z.state === "idle" ? "idle" : z.state;
        return `<span class="debug-chip ${z.state === "watering" ? "on" : ""}">${z.id}:${st}</span>`;
      }).join("");
      return `<div class="debug-label">Zone States</div><div class="debug-chips">${rows}</div>`;
    }
    attachEventListeners() {
      if (this._scheduleModalOpen) {
        this._attachDragHandlers();
      }
    }
    // Static methods for global access from onclick handlers
    static startZone(zoneId, duration = 15) {
      console.log("[SSC] Static startZone called:", zoneId);
      console.log("[SSC] window.smartSprinklerControlPanel:", window.smartSprinklerControlPanel);
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.startZone(zoneId, duration);
      } else {
        console.error("[SSC] No panel instance found!");
      }
    }
    static stopZone(zoneId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.stopZone(zoneId);
      }
    }
    static stopAllZones() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.stopAllZones();
      }
    }
    static enableRainDelay(hours = 24) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.enableRainDelay(hours);
      }
    }
    static disableRainDelay() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.disableRainDelay();
      }
    }
    static toggleSwitch(entityId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.toggleSwitch(entityId);
      }
    }
    static stopAllSwitches() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.stopAllSwitches();
      }
    }
    static showDurationModal(zoneId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.showDurationModal(zoneId);
      }
    }
    static closeDurationModal(event) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.closeDurationModal(event);
      }
    }
    static setDuration(minutes) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.setDuration(minutes);
      }
    }
    static adjustDuration(delta) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.adjustDuration(delta);
      }
    }
    static confirmStartZone() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.confirmStartZone();
      }
    }
    static adjustRunningTime(zoneId, deltaMinutes) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.adjustRunningTime(zoneId, deltaMinutes);
      }
    }
    static showZoneSettings(zoneId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.showZoneSettings(zoneId);
      }
    }
    static closeSettingsModal(event) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.closeSettingsModal(event);
      }
    }
    static updateSettingsField(field, value) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.updateSettingsField(field, value);
      }
    }
    static saveZoneSettings() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.saveZoneSettings();
      }
    }
    static showCreateScheduleModal() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.showCreateScheduleModal();
      }
    }
    static showEditScheduleModal(scheduleId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.showEditScheduleModal(scheduleId);
      }
    }
    static closeScheduleModal(event) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.closeScheduleModal(event);
      }
    }
    static updateScheduleField(field, value) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.updateScheduleField(field, value);
      }
    }
    static toggleScheduleDay(dayValue) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.toggleScheduleDay(dayValue);
      }
    }
    static toggleScheduleZone(zoneId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.toggleScheduleZone(zoneId);
      }
    }
    static updateZoneDuration(zoneId, duration) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.updateZoneDuration(zoneId, duration);
      }
    }
    static saveSchedule() {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.saveSchedule();
      }
    }
    static deleteSchedule(scheduleId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.deleteSchedule(scheduleId);
      }
    }
    static runScheduleNow(scheduleId) {
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.runScheduleNow(scheduleId);
      }
    }
  };
  Object.assign(
    SmartSprinklerControlPanel.prototype,
    styleMethods,
    rainChartMethods,
    zoneCardMethods,
    scheduleMethods,
    modalMethods
  );
  if (!window.SmartSprinklerControlPanel) {
    customElements.define("smart-sprinkler-control-panel", SmartSprinklerControlPanel);
    window.SmartSprinklerControlPanel = SmartSprinklerControlPanel;
  }
  console.log(`Smart Sprinkler Control Panel v${VERSION} - Loaded`);
})();
