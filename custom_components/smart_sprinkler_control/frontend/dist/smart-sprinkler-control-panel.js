(function () {
  'use strict';

  /**
   * Constants for Smart Sprinkler Control frontend
   *
   * Centralized configuration values for the sprinkler control panel.
   */

  /** Domain name for the integration */
  const DOMAIN = 'smart_sprinkler_control';

  /** Days of week mapping */
  const DAYS_OF_WEEK = [
    { value: 0, label: 'Sunday', short: 'Sun' },
    { value: 1, label: 'Monday', short: 'Mon' },
    { value: 2, label: 'Tuesday', short: 'Tue' },
    { value: 3, label: 'Wednesday', short: 'Wed' },
    { value: 4, label: 'Thursday', short: 'Thu' },
    { value: 5, label: 'Friday', short: 'Fri' },
    { value: 6, label: 'Saturday', short: 'Sat' },
  ];

  /** Service names */
  const SERVICES = {
    START_ZONE: 'start_zone',
    STOP_ZONE: 'stop_zone',
    STOP_ALL_ZONES: 'stop_all_zones',
    ENABLE_RAIN_DELAY: 'enable_rain_delay',
    DISABLE_RAIN_DELAY: 'disable_rain_delay',
    UPDATE_ZONE_SETTINGS: 'update_zone_settings',
    CREATE_SCHEDULE: 'create_schedule',
    DELETE_SCHEDULE: 'delete_schedule',
  };

  /** Panel version */
  const VERSION = '2025.1.0';

  /**
   * ServiceClient - Handles communication with Home Assistant services
   *
   * Provides methods to call sprinkler control services through the HA websocket API.
   */


  class ServiceClient {
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

  /**
   * DataManager - Manages sprinkler system data and state
   *
   * Handles loading, caching, and subscribing to sprinkler system state updates.
   */


  class DataManager {
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

  /**
   * Smart Sprinkler Control Frontend Entry Point
   *
   * Modular architecture with clean separation of concerns.
   * Provides a sidebar panel for managing sprinkler zones and schedules.
   */


  // Prevent redefinition if already loaded
  if (!window.SmartSprinklerControlPanel) {
    class SmartSprinklerControlPanel extends HTMLElement {
      constructor() {
        super();
        this._hass = undefined;
        this._narrow = false;
        this._selectedSystem = null;
        this._systems = [];
        this._modalOpen = false;
        this._editingZone = null;
        this._editingSchedule = null;

        // Initialize modules
        this.serviceClient = new ServiceClient(this._hass);
        this.dataManager = new DataManager(this._hass, this.serviceClient);
      }

      set hass(hass) {
        const oldHass = this._hass;
        this._hass = hass;

        // Store reference for global access
        window.smartSprinklerControlPanel = this;

        // Update modules with new hass
        this.serviceClient.setHass(hass);
        this.dataManager.setHass(hass);

        // Setup event listeners when hass becomes available
        if (hass && (!oldHass || oldHass.connection !== hass.connection)) {
          this.dataManager.setupEventListeners();
          this.dataManager.onDataChange(() => this.loadSystemData());
        }

        // Force reload data if states changed
        if (oldHass && hass && oldHass.states !== hass.states) {
          this.loadSystemData();
        }

        // Don't auto-refresh if modal is open
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
      }

      disconnectedCallback() {
        if (window.smartSprinklerControlPanel === this) {
          delete window.smartSprinklerControlPanel;
        }
        this.dataManager.destroy();
      }

      async loadSystemData(bypassCache = false) {
        this._systems = await this.dataManager.loadSystemData(bypassCache);
        this._selectedSystem = this.dataManager.getSelectedSystem();

        if (!this._modalOpen) {
          this.requestUpdate();
        }
      }

      requestUpdate() {
        this.render();
      }

      // Zone control methods
      async startZone(zoneId, duration = 15) {
        if (!this._selectedSystem) return;

        try {
          await this.serviceClient.startZone(
            this._selectedSystem.entity_id,
            zoneId,
            duration
          );
          this.loadSystemData(true);
        } catch (error) {
          console.error('Failed to start zone:', error);
          this.showError('Failed to start zone');
        }
      }

      async stopZone(zoneId) {
        if (!this._selectedSystem) return;

        try {
          await this.serviceClient.stopZone(
            this._selectedSystem.entity_id,
            zoneId
          );
          this.loadSystemData(true);
        } catch (error) {
          console.error('Failed to stop zone:', error);
          this.showError('Failed to stop zone');
        }
      }

      async stopAllZones() {
        if (!this._selectedSystem) return;

        try {
          await this.serviceClient.stopAllZones(this._selectedSystem.entity_id);
          this.loadSystemData(true);
        } catch (error) {
          console.error('Failed to stop all zones:', error);
          this.showError('Failed to stop all zones');
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
          console.error('Failed to enable rain delay:', error);
          this.showError('Failed to enable rain delay');
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
          console.error('Failed to disable rain delay:', error);
          this.showError('Failed to disable rain delay');
        }
      }

      // Error display
      showError(message) {
        // Simple error display - can be enhanced with toast notifications
        console.error(message);
        alert(message);
      }

      // Render the panel
      render() {
        if (!this._systems.length) {
          this.innerHTML = this.renderNoSystems();
          return;
        }

        this.innerHTML = `
        ${this.renderStyles()}
        <div class="sprinkler-panel">
          ${this.renderHeader()}
          ${this.renderZones()}
          ${this.renderSchedules()}
          ${this.renderWeather()}
        </div>
      `;

        this.attachEventListeners();
      }

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
            border: 2px solid var(--primary-color);
          }
          .zone-card.disabled {
            opacity: 0.6;
          }
          .zone-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }
          .zone-name {
            font-weight: 500;
            font-size: 16px;
          }
          .zone-status {
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--secondary-background-color);
          }
          .zone-status.watering {
            background: var(--success-color, #43a047);
            color: white;
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
        </style>
      `;
      }

      renderHeader() {
        const systemName =
          this._selectedSystem?.attributes?.friendly_name || 'Sprinkler System';
        const isAnyZoneActive = this.dataManager
          .getZones()
          .some((z) => z.status === 'watering');

        return `
        <div class="panel-header">
          <h1>${systemName}</h1>
          <div class="header-actions">
            ${
              isAnyZoneActive
                ? `<button class="btn btn-danger" onclick="SmartSprinklerControlPanel.stopAllZones()">
                    Stop All
                  </button>`
                : ''
            }
          </div>
        </div>
      `;
      }

      renderZones() {
        const zones = this.dataManager.getZones();

        if (zones.length === 0) {
          return `<p>No zones configured.</p>`;
        }

        const zoneCards = zones
          .map((zone) => {
            const isActive = zone.status === 'watering';
            const isDisabled = !zone.enabled;
            const cardClass = `zone-card ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;

            return `
          <div class="${cardClass}" data-zone-id="${zone.id}">
            <div class="zone-header">
              <span class="zone-name">${zone.name || `Zone ${zone.id}`}</span>
              <span class="zone-status ${isActive ? 'watering' : ''}">${zone.status || 'idle'}</span>
            </div>
            <div class="zone-controls">
              ${
                isActive
                  ? `<button class="btn btn-danger" onclick="SmartSprinklerControlPanel.stopZone(${zone.id})">Stop</button>`
                  : `<button class="btn btn-primary" onclick="SmartSprinklerControlPanel.startZone(${zone.id})" ${isDisabled ? 'disabled' : ''}>Start</button>`
              }
            </div>
          </div>
        `;
          })
          .join('');

        return `
        <h2 class="section-title">Zones</h2>
        <div class="zones-grid">${zoneCards}</div>
      `;
      }

      renderSchedules() {
        const schedules = this.dataManager.getSchedules();

        if (schedules.length === 0) {
          return `
          <h2 class="section-title">Schedules</h2>
          <div class="schedules-list">
            <p>No schedules configured.</p>
          </div>
        `;
        }

        const scheduleItems = schedules
          .map((schedule) => {
            const daysText = schedule.days_of_week
              ?.map((d) => DAYS_OF_WEEK[d]?.short)
              .join(', ');

            return `
          <div class="schedule-item">
            <div class="schedule-info">
              <h4>${schedule.name}</h4>
              <p>${schedule.start_time} · ${daysText} · ${schedule.zone_ids?.length || 0} zones</p>
            </div>
            <div>
              <span>${schedule.enabled ? '✓ Active' : 'Disabled'}</span>
            </div>
          </div>
        `;
          })
          .join('');

        return `
        <h2 class="section-title">Schedules</h2>
        <div class="schedules-list">${scheduleItems}</div>
      `;
      }

      renderWeather() {
        const weather = this.dataManager.getWeatherData();

        if (!weather?.weatherEntity) {
          return '';
        }

        return `
        <h2 class="section-title">Weather</h2>
        <div class="weather-card">
          <div class="weather-info">
            <div>
              <p>Weather Entity: ${weather.weatherEntity}</p>
              ${
                weather.rainDelayActive
                  ? `<p class="rain-delay-active">Rain delay active until ${weather.rainDelayUntil || 'unknown'}</p>`
                  : ''
              }
            </div>
            <div>
              ${
                weather.rainDelayActive
                  ? `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.disableRainDelay()">Cancel Rain Delay</button>`
                  : `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.enableRainDelay()">Enable Rain Delay</button>`
              }
            </div>
          </div>
        </div>
      `;
      }

      attachEventListeners() {
        // Event listeners are attached via onclick handlers in the HTML
        // This method can be extended for more complex interactions
      }

      // Static methods for global access from onclick handlers
      static startZone(zoneId, duration = 15) {
        if (window.smartSprinklerControlPanel) {
          window.smartSprinklerControlPanel.startZone(zoneId, duration);
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
    }

    // Register the custom element
    customElements.define('smart-sprinkler-control-panel', SmartSprinklerControlPanel);

    // Export for global access
    window.SmartSprinklerControlPanel = SmartSprinklerControlPanel;
  }

  console.log(`Smart Sprinkler Control Panel v${VERSION} - Loaded`);

})();
//# sourceMappingURL=smart-sprinkler-control-panel.js.map
