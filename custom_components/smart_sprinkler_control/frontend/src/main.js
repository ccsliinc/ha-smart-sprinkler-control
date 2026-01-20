/**
 * Smart Sprinkler Control Frontend Entry Point
 *
 * Modular architecture with clean separation of concerns.
 * Provides a sidebar panel for managing sprinkler zones and schedules.
 */

import { ServiceClient } from './modules/ServiceClient.js';
import { DataManager } from './modules/DataManager.js';
import { DOMAIN, DAYS_OF_WEEK, VERSION } from './utils/Constants.js';

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
