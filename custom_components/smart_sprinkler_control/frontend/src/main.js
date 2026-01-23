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

      // Duration picker modal state
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._selectedDuration = 30; // Default 30 minutes

      // Schedule modal state
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._scheduleFormData = null;

      // Countdown timer state
      this._countdownInterval = null;
      this._healthCheckInterval = null;
      this._zoneStartTimes = new Map(); // Track when each zone started

      // Rain chart state
      this._rainChart = null;

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
      this._startCountdownTimer();
      this._startHealthCheck();
    }

    disconnectedCallback() {
      if (window.smartSprinklerControlPanel === this) {
        delete window.smartSprinklerControlPanel;
      }
      this._stopCountdownTimer();
      this._stopHealthCheck();
      // Clean up rain chart
      if (this._rainChart) {
        this._rainChart.destroy();
        this._rainChart = null;
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
        const hasRunningZone = zones.some(z => z.state === 'watering' || z.is_running);
        if (hasRunningZone && !this._modalOpen) {
          this._updateCountdownDisplays();
        }
      }, 1000);
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
     * Start health check interval to detect stale connections
     */
    _startHealthCheck() {
      if (this._healthCheckInterval) return;

      this._healthCheckInterval = setInterval(async () => {
        // Check if panel content is empty (black screen)
        const content = this.innerHTML?.trim();
        if (!content || content.length < 100) {
          console.warn('[SSC] Panel appears empty, forcing re-render');
          this.render();
          return;
        }

        // Check connection health
        const isHealthy = await this.dataManager.checkConnection();
        if (!isHealthy) {
          console.warn('[SSC] Connection unhealthy, attempting recovery');
          if (this._hass) {
            this.dataManager.setHass(this._hass);
            await this.dataManager.setupEventListeners();
            this.loadSystemData();
          }
          return;
        }

        // Check for stale data (no updates in 60s while zones running)
        const zones = this.dataManager.getZones();
        const hasRunningZone = zones.some(z => z.state === 'watering' || z.is_running);
        const timeSinceUpdate = Date.now() - this.dataManager.getLastUpdate();

        if (hasRunningZone && timeSinceUpdate > 60000) {
          console.warn('[SSC] Data appears stale, re-subscribing');
          await this.dataManager.setupEventListeners();
          this.loadSystemData();
        }
      }, 30000); // Check every 30 seconds
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

      zones.forEach(zone => {
        const isRunning = zone.state === 'watering' || zone.is_running;

        // Clean up stopped zones from tracking
        if (!isRunning) {
          this._zoneStartTimes.delete(zone.id);
          return;
        }

        const card = this.querySelector(`[data-zone-id="${zone.id}"]`);
        if (!card) return;

        // Initialize tracking for newly started zones
        if (!this._zoneStartTimes.has(zone.id)) {
          // Use watering_duration (total session duration) as the source of truth
          // Don't use remaining_time here - it may be truncated by backend
          const totalSeconds = (zone.watering_duration || zone.remaining_time || 30) * 60;
          // For a newly started zone, initialRemaining should equal totalDuration
          // The backend remaining_time may already be truncated, so we trust watering_duration
          this._zoneStartTimes.set(zone.id, {
            startedAt: now,
            initialRemaining: totalSeconds,  // Start at full duration
            totalDuration: totalSeconds
          });
          console.log('[SSC] Initialized tracking for zone', zone.id, ':', totalSeconds, 'seconds');
        }

        const tracking = this._zoneStartTimes.get(zone.id);
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1000);
        const remainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
        const totalSeconds = tracking.totalDuration;
        const elapsedSeconds = totalSeconds - remainingSeconds;
        const progress = totalSeconds > 0 ? (elapsedSeconds / totalSeconds) : 0;

        // Update countdown text (MM:SS)
        const countdownEl = card.querySelector('.countdown-time');
        if (countdownEl) {
          const mins = Math.floor(remainingSeconds / 60);
          const secs = remainingSeconds % 60;
          countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        // Update remaining/total display (counting down) - use floor so 4:15 shows as 4m
        const elapsedEl = card.querySelector('.elapsed-time');
        if (elapsedEl) {
          const totalMins = Math.floor(totalSeconds / 60);
          const remainingMinsFloor = Math.floor(remainingSeconds / 60);
          elapsedEl.textContent = remainingMinsFloor < 1 && remainingSeconds > 0
            ? `<1m / ${totalMins}m`
            : `${remainingMinsFloor}m / ${totalMins}m`;
        }

        // Update progress ring (depletes as time passes - starts full, ends empty)
        const progressRing = card.querySelector('.progress-ring-progress');
        if (progressRing) {
          const circumference = 2 * Math.PI * 45;
          // Reverse: progress goes 0->1, so offset goes 0->circumference (full->empty)
          const offset = circumference * progress;
          progressRing.style.strokeDashoffset = offset;
        }

        // Update status badge
        const statusBadge = card.querySelector('.zone-status');
        if (statusBadge) {
          const remainingMins = Math.ceil(remainingSeconds / 60);
          statusBadge.textContent = `${remainingMins}m left`;
        }

        // If timer reaches zero, stop the zone (only once)
        if (remainingSeconds <= 0) {
          // Check if we already triggered stop for this zone
          if (!this._stoppingZones) this._stoppingZones = new Set();
          if (!this._stoppingZones.has(zone.id)) {
            this._stoppingZones.add(zone.id);
            this._zoneStartTimes.delete(zone.id);
            console.log('[SSC] Timer reached zero for zone', zone.id, '- stopping zone');
            this.stopZone(zone.id).then(() => {
              // Clear the stopping flag after a delay
              setTimeout(() => this._stoppingZones?.delete(zone.id), 5000);
            });
          }
        }
      });
    }

    async loadSystemData(bypassCache = false) {
      this._systems = await this.dataManager.loadSystemData(bypassCache);
      this._selectedSystem = this.dataManager.getSelectedSystem();

      // Sync countdown tracking with backend state
      this._syncCountdownTracking();

      if (!this._modalOpen) {
        this.requestUpdate();
      }
    }

    /**
     * Sync local countdown tracking with backend state.
     * Resets tracking for zones where backend time differs significantly.
     */
    _syncCountdownTracking() {
      const zones = this.dataManager.getZones();
      const now = Date.now();

      zones.forEach(zone => {
        const isRunning = zone.state === 'watering' || zone.is_running;
        const tracking = this._zoneStartTimes.get(zone.id);

        if (!isRunning) {
          // Zone stopped - remove tracking
          this._zoneStartTimes.delete(zone.id);
          return;
        }

        if (tracking) {
          // Compare our tracked time with backend time
          const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1000);
          const ourRemainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
          const backendRemainingSeconds = (zone.remaining_time || 0) * 60;

          // If difference > 30 seconds, resync with backend
          if (Math.abs(ourRemainingSeconds - backendRemainingSeconds) > 30) {
            console.log('[SSC] Resyncing zone', zone.id, 'tracking with backend');
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
      console.log('[SSC] startZone called:', zoneId, duration, 'at', new Date().toISOString());

      if (!this._selectedSystem) {
        console.error('[SSC] No selected system!');
        return;
      }

      // Set loading state
      if (!this._loadingZones) this._loadingZones = new Set();
      this._loadingZones.add(zoneId);
      this._updateZoneLoadingState(zoneId, true);

      try {
        console.log('[SSC] Calling service for entity:', this._selectedSystem.entity_id);
        await this.serviceClient.startZone(
          this._selectedSystem.entity_id,
          zoneId,
          duration
        );
        console.log('[SSC] Service call completed at', new Date().toISOString());

        // Poll for state change since event propagation can be delayed
        await this._pollForStateChange(zoneId, 'watering', 8000);
      } catch (error) {
        console.error('[SSC] Failed to start zone:', error);
        this.showError('Failed to start zone');
      } finally {
        // Clear loading state
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

      const startBtn = card.querySelector('.btn-start');
      if (startBtn) {
        startBtn.disabled = isLoading;
        startBtn.textContent = isLoading ? 'Starting...' : 'Start';
        startBtn.classList.toggle('loading', isLoading);
      }
    }

    async _pollForStateChange(zoneId, expectedState, timeoutMs) {
      const startTime = Date.now();
      const pollInterval = 200; // Check every 200ms

      while (Date.now() - startTime < timeoutMs) {
        // Force re-render to pick up any state changes
        this.render();

        // Check if the zone state matches what we expect
        const zones = this.dataManager.getZones();
        const zone = zones.find(z => z.id === zoneId);

        if (zone?.state === expectedState) {
          console.log('[SSC] State updated to', expectedState, 'after', Date.now() - startTime, 'ms');
          return;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      console.log('[SSC] Timeout waiting for state change, forcing render');
      this.render();
    }

    async _delayedRefresh(ms) {
      await new Promise(resolve => setTimeout(resolve, ms));
      await this.loadSystemData(true);
    }

    async stopZone(zoneId) {
      console.log('[SSC] stopZone called:', zoneId, 'at', new Date().toISOString());

      if (!this._selectedSystem) return;

      try {
        await this.serviceClient.stopZone(
          this._selectedSystem.entity_id,
          zoneId
        );
        console.log('[SSC] Stop service completed at', new Date().toISOString());

        // Poll for state change
        await this._pollForStateChange(zoneId, 'idle', 3000);
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

    /**
     * Show zone settings modal/panel (placeholder for future implementation).
     *
     * @param {number} zoneId - The zone ID to show settings for
     */
    showZoneSettings(zoneId) {
      console.log('[SSC] showZoneSettings called for zone:', zoneId);
      // TODO: Implement zone settings modal
      // For now, just log the action
      const zones = this.dataManager.getZones();
      const zone = zones.find(z => z.id === zoneId);
      if (zone) {
        console.log('[SSC] Zone settings:', zone);
        alert(`Zone Settings for "${zone.name || `Zone ${zone.id}`}"\n\nSettings panel coming soon!`);
      }
    }

    /**
     * Adjust the remaining time for a currently running zone.
     *
     * @param {number} zoneId - The zone ID to adjust
     * @param {number} deltaMinutes - Minutes to add (positive) or subtract (negative)
     */
    async adjustRunningTime(zoneId, deltaMinutes) {
      console.log('[SSC] adjustRunningTime called:', zoneId, deltaMinutes);

      if (!this._selectedSystem) return;

      const zones = this.dataManager.getZones();
      const zone = zones.find(z => z.id === zoneId);

      if (!zone || (zone.state !== 'watering' && !zone.is_running)) {
        console.warn('[SSC] Zone not running, cannot adjust time');
        return;
      }

      // Use local tracking data for accurate current remaining time
      let currentRemainingSeconds;
      const tracking = this._zoneStartTimes.get(zoneId);
      if (tracking) {
        const now = Date.now();
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1000);
        currentRemainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
      } else {
        // Fallback to backend value
        currentRemainingSeconds = (zone.remaining_time || 0) * 60;
      }

      const currentRemainingMinutes = Math.ceil(currentRemainingSeconds / 60);
      // Minimum 5 minutes remaining when adjusting
      const newRemaining = Math.max(5, currentRemainingMinutes + deltaMinutes);

      console.log('[SSC] Current remaining:', currentRemainingMinutes, 'min, new:', newRemaining, 'min');

      try {
        // Call service to adjust zone time
        await this.serviceClient.adjustZoneTime(
          this._selectedSystem.entity_id,
          zoneId,
          newRemaining
        );
        console.log('[SSC] Time adjustment completed');

        // Update local tracking to reflect new duration
        if (tracking) {
          const now = Date.now();
          const elapsedSoFar = Math.floor((now - tracking.startedAt) / 1000);
          const elapsedFromOriginal = tracking.totalDuration - tracking.initialRemaining + elapsedSoFar;
          // New total = time already elapsed + new remaining time
          const newTotal = Math.max(newRemaining * 60, elapsedFromOriginal + (newRemaining * 60));
          this._zoneStartTimes.set(zoneId, {
            startedAt: now,
            initialRemaining: newRemaining * 60,
            totalDuration: newTotal
          });
        }

        // Refresh data to sync with backend
        await this.loadSystemData(true);
      } catch (error) {
        console.error('[SSC] Failed to adjust zone time:', error);
        this.showError('Failed to adjust zone time');
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

    // Debug: Toggle a switch entity directly
    async toggleSwitch(entityId) {
      if (!this._hass) return;

      const currentState = this._hass.states[entityId]?.state;
      const service = currentState === 'on' ? 'turn_off' : 'turn_on';
      const domain = entityId.split('.')[0];

      try {
        await this._hass.callService(domain, service, {
          entity_id: entityId
        });
        // Small delay then refresh
        setTimeout(() => this.loadSystemData(true), 500);
      } catch (error) {
        console.error('Failed to toggle switch:', error);
        this.showError(`Failed to toggle ${entityId}`);
      }
    }

    // Debug: Stop all sprinkler switches directly
    async stopAllSwitches() {
      if (!this._hass) return;

      const switchEntities = Object.keys(this._hass.states)
        .filter(id => id.startsWith('switch.sprinkler_') || id.startsWith('input_boolean.zone_'));

      try {
        for (const entityId of switchEntities) {
          const domain = entityId.split('.')[0];
          await this._hass.callService(domain, 'turn_off', {
            entity_id: entityId
          });
        }
        setTimeout(() => this.loadSystemData(true), 500);
      } catch (error) {
        console.error('Failed to stop all switches:', error);
        this.showError('Failed to stop all switches');
      }
    }

    /**
     * Render the rain accumulation graph section.
     * Shows last 24 hours of rain data.
     */
    _renderRainGraph() {
      return `
        <div class="rain-graph-container" style="
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(0, 255, 255, 0.2);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 20px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; color: #00ffff; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">
              Rain Accumulation (24h)
            </h3>
            <span id="rain-total" style="color: #888; font-size: 12px;">Total: 0.0 mm</span>
          </div>
          <canvas id="rainChart" height="120"></canvas>
        </div>
      `;
    }

    /**
     * Initialize the rain chart with mock data.
     * Uses Chart.js to render a line graph of 24h rain accumulation.
     */
    _initRainChart() {
      const canvas = this.querySelector('#rainChart');
      if (!canvas || typeof Chart === 'undefined') return;

      // Destroy existing chart if any
      if (this._rainChart) {
        this._rainChart.destroy();
      }

      const ctx = canvas.getContext('2d');

      // Generate mock data for last 24 hours (hourly readings)
      const now = new Date();
      const labels = [];
      const data = [];
      let total = 0;

      for (let i = 23; i >= 0; i--) {
        const hour = new Date(now - i * 60 * 60 * 1000);
        labels.push(hour.getHours().toString().padStart(2, '0') + ':00');

        // Mock rain pattern - some rain in morning, clear afternoon
        let rain = 0;
        const h = hour.getHours();
        if (h >= 6 && h <= 9) {
          rain = Math.random() * 2.5; // Morning rain
        } else if (h >= 14 && h <= 16) {
          rain = Math.random() * 0.5; // Light afternoon shower
        }
        data.push(parseFloat(rain.toFixed(2)));
        total += rain;
      }

      // Update total display
      const totalEl = this.querySelector('#rain-total');
      if (totalEl) {
        totalEl.textContent = `Total: ${total.toFixed(1)} mm`;
      }

      this._rainChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Rain (mm)',
            data: data,
            borderColor: '#00ffff',
            backgroundColor: 'rgba(0, 255, 255, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#00ffff',
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
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              titleColor: '#00ffff',
              bodyColor: '#fff',
              borderColor: 'rgba(0, 255, 255, 0.3)',
              borderWidth: 1,
              callbacks: {
                label: (context) => `${context.parsed.y.toFixed(2)} mm`
              }
            }
          },
          scales: {
            x: {
              grid: {
                color: 'rgba(255, 255, 255, 0.05)'
              },
              ticks: {
                color: '#666',
                font: { size: 10 },
                maxTicksLimit: 8
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(255, 255, 255, 0.05)'
              },
              ticks: {
                color: '#666',
                font: { size: 10 },
                callback: (value) => value + ' mm'
              }
            }
          }
        }
      });
    }

    /**
     * Load Chart.js library dynamically if not already loaded.
     * Returns a promise that resolves when Chart.js is ready.
     */
    _loadChartJs() {
      return new Promise((resolve) => {
        if (typeof Chart !== 'undefined') {
          resolve();
          return;
        }

        // Check if already loading
        if (window._chartJsLoading) {
          window._chartJsLoading.then(resolve);
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
        script.async = true;

        window._chartJsLoading = new Promise((res) => {
          script.onload = () => {
            res();
            resolve();
          };
          script.onerror = () => {
            console.error('[SSC] Failed to load Chart.js');
            res();
            resolve();
          };
        });

        document.head.appendChild(script);
      });
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

      // Load Chart.js and initialize rain chart after DOM is ready
      this._loadChartJs().then(() => {
        setTimeout(() => this._initRainChart(), 50);
      });
    }

    // Duration picker modal
    renderDurationModal() {
      if (!this._durationModalOpen || !this._durationModalZone) {
        return '';
      }

      const zone = this._durationModalZone;
      const duration = this._selectedDuration;
      const quickDurations = [5, 10, 15, 30, 45, 60, 90];

      const quickButtons = quickDurations.map(d => {
        const isSelected = d === duration;
        const label = d >= 60 ? `${d / 60}h` : `${d}m`;
        return `
          <button class="quick-duration-btn ${isSelected ? 'selected' : ''}"
                  onclick="SmartSprinklerControlPanel.setDuration(${d})">
            ${label}
          </button>
        `;
      }).join('');

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
                <button class="duration-btn" onclick="SmartSprinklerControlPanel.adjustDuration(-5)">−</button>
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
    }

    // Duration modal methods
    showDurationModal(zoneId) {
      const zones = this.dataManager.getZones();
      const zone = zones.find(z => z.id === zoneId);
      if (!zone) return;

      this._durationModalZone = zone;
      this._durationModalOpen = true;
      // Default to zone's configured duration or 30 minutes
      this._selectedDuration = zone.duration || 30;
      this._modalOpen = true;
      this.render();
    }

    closeDurationModal(event) {
      // If event passed, only close if clicking overlay (not content)
      if (event && event.target.classList.contains('modal-content')) {
        return;
      }
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._modalOpen = false;
      this.render();
    }

    setDuration(minutes) {
      this._selectedDuration = Math.max(1, Math.min(180, minutes));
      this._updateModalDisplay();
    }

    adjustDuration(delta) {
      this._selectedDuration = Math.max(1, Math.min(180, this._selectedDuration + delta));
      this._updateModalDisplay();
    }

    /**
     * Update only the modal display elements without full re-render.
     * Prevents flickering when adjusting duration.
     */
    _updateModalDisplay() {
      // Update duration value display
      const durationValue = this.querySelector('.duration-value');
      if (durationValue) {
        durationValue.textContent = this._selectedDuration;
      }

      // Update quick duration button states
      const quickButtons = this.querySelectorAll('.quick-duration-btn');
      quickButtons.forEach(btn => {
        const btnDuration = parseInt(btn.textContent.replace(/[mh]/g, ''));
        const actualDuration = btn.textContent.includes('h') ? btnDuration * 60 : btnDuration;
        btn.classList.toggle('selected', actualDuration === this._selectedDuration);
      });
    }

    async confirmStartZone() {
      if (!this._durationModalZone) return;

      const zoneId = this._durationModalZone.id;
      const duration = this._selectedDuration;

      // Close modal first
      this._durationModalOpen = false;
      this._durationModalZone = null;
      this._modalOpen = false;
      this.render();

      // Start the zone
      await this.startZone(zoneId, duration);
    }

    // Zone Settings Modal methods
    showZoneSettings(zoneId) {
      const zones = this.dataManager.getZones();
      const zone = zones.find(z => z.id === zoneId);
      if (!zone) return;

      this._settingsModalZone = zone;
      this._settingsModalOpen = true;
      this._settingsFormData = {
        name: zone.name || `Zone ${zone.id}`,
        duration: zone.duration || 15,
        enabled: zone.enabled !== false,
        flow_rate: zone.flow_rate || '',
        area_sqft: zone.area_sqft || ''
      };
      this._modalOpen = true;
      this.render();
    }

    closeSettingsModal(event) {
      if (event && event.target.classList.contains('modal-content')) {
        return;
      }
      this._settingsModalOpen = false;
      this._settingsModalZone = null;
      this._modalOpen = false;
      this.render();
    }

    updateSettingsField(field, value) {
      if (!this._settingsFormData) return;
      this._settingsFormData[field] = value;
    }

    async saveZoneSettings() {
      if (!this._settingsModalZone || !this._selectedSystem) return;

      const zoneId = this._settingsModalZone.id;
      const data = this._settingsFormData;

      // Close modal
      this._settingsModalOpen = false;
      this._settingsModalZone = null;
      this._modalOpen = false;
      this.render();

      try {
        // Build settings object, only include optional fields if they have values
        const settings = {
          name: data.name,
          duration: parseInt(data.duration) || 15,
          enabled: data.enabled
        };
        // Only include optional fields if they have actual values
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
        console.error('[SSC] Failed to save zone settings:', error);
        this.showError('Failed to save zone settings');
      }
    }

    renderZoneSettingsModal() {
      if (!this._settingsModalOpen || !this._settingsModalZone) {
        return '';
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
                  <input type="text" class="form-input" value="${data.name || ''}"
                    onchange="SmartSprinklerControlPanel.updateSettingsField('name', this.value)">
                </div>
                <div class="form-group">
                  <label>Default Duration (minutes)</label>
                  <input type="number" class="form-input" min="1" max="120" value="${data.duration || 15}"
                    onchange="SmartSprinklerControlPanel.updateSettingsField('duration', this.value)">
                </div>
                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" ${data.enabled ? 'checked' : ''}
                      onchange="SmartSprinklerControlPanel.updateSettingsField('enabled', this.checked)">
                    Zone Enabled
                  </label>
                </div>
                <div class="form-divider"></div>
                <div class="form-group">
                  <label>Flow Rate (GPM) <span class="optional">optional</span></label>
                  <input type="number" class="form-input" step="0.1" min="0" value="${data.flow_rate || ''}"
                    placeholder="e.g., 2.5"
                    onchange="SmartSprinklerControlPanel.updateSettingsField('flow_rate', this.value)">
                </div>
                <div class="form-group">
                  <label>Area (sq ft) <span class="optional">optional</span></label>
                  <input type="number" class="form-input" min="0" value="${data.area_sqft || ''}"
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

    // Schedule Modal methods
    showCreateScheduleModal() {
      this._editingSchedule = null;
      const zones = this.dataManager.getZones();
      this._scheduleFormData = {
        schedule_id: `schedule_${Date.now()}`,
        name: '',
        start_time: '06:00',
        days_of_week: [],
        zone_ids: [],
        zone_durations: {},
        enabled: true,
        skip_if_rain: true
      };
      // Initialize zone durations with default values
      zones.forEach(z => {
        this._scheduleFormData.zone_durations[z.id] = z.duration || 15;
      });
      this._scheduleModalOpen = true;
      this._modalOpen = true;
      this.render();
    }

    showEditScheduleModal(scheduleId) {
      const schedules = this.dataManager.getSchedules();
      const schedule = schedules.find(s => s.id === scheduleId);
      if (!schedule) return;

      this._editingSchedule = schedule;
      this._scheduleFormData = {
        schedule_id: schedule.id,
        name: schedule.name || '',
        start_time: schedule.start_time || '06:00',
        days_of_week: [...(schedule.days_of_week || [])],
        zone_ids: [...(schedule.zone_ids || [])],
        zone_durations: {...(schedule.zone_durations || {})},
        enabled: schedule.enabled !== false,
        skip_if_rain: schedule.skip_if_rain !== false
      };
      this._scheduleModalOpen = true;
      this._modalOpen = true;
      this.render();
    }

    closeScheduleModal(event) {
      if (event && event.target.classList.contains('modal-content')) {
        return;
      }
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._scheduleFormData = null;
      this._modalOpen = false;
      this.render();
    }

    updateScheduleField(field, value) {
      if (!this._scheduleFormData) return;
      this._scheduleFormData[field] = value;
    }

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
    }

    toggleScheduleZone(zoneId) {
      if (!this._scheduleFormData) return;
      const zones = this._scheduleFormData.zone_ids;
      const idx = zones.indexOf(zoneId);
      if (idx >= 0) {
        zones.splice(idx, 1);
      } else {
        // Add to end (user can reorder via drag)
        zones.push(zoneId);
      }
      this._updateScheduleModalDisplay();
      this._updateFireOrderList();
    }

    _updateFireOrderList() {
      const container = this.querySelector('.fire-order-list');
      if (!container) return;

      const zones = this.dataManager.getZones();
      const selectedIds = this._scheduleFormData?.zone_ids || [];

      if (selectedIds.length === 0) {
        container.innerHTML = '<div class="fire-order-empty">Select zones above</div>';
        return;
      }

      container.innerHTML = selectedIds.map((zoneId, index) => {
        const zone = zones.find(z => z.id === zoneId);
        const name = zone?.name || `Zone ${zoneId}`;
        const duration = this._scheduleFormData.zone_durations[zoneId] || zone?.duration || 15;
        return `
          <div class="fire-order-item" draggable="true" data-zone-id="${zoneId}">
            <span class="fire-order-handle">☰</span>
            <span class="fire-order-num">${index + 1}</span>
            <span class="fire-order-name">${name}</span>
            <input type="number" class="fire-order-duration" value="${duration}" min="1" max="120"
                   onchange="SmartSprinklerControlPanel.updateZoneDuration(${zoneId}, this.value)">
            <span class="fire-order-unit">min</span>
          </div>
        `;
      }).join('');

      // Attach drag handlers
      this._attachDragHandlers();
    }

    _attachDragHandlers() {
      const container = this.querySelector('.fire-order-list');
      if (!container) return;

      const items = container.querySelectorAll('.fire-order-item');
      items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.dataset.zoneId);
          item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const dragging = container.querySelector('.dragging');
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

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          // Update zone_ids order from DOM
          const newOrder = Array.from(container.querySelectorAll('.fire-order-item'))
            .map(el => parseInt(el.dataset.zoneId));
          this._scheduleFormData.zone_ids = newOrder;
          this._updateFireOrderList();
        });
      });
    }

    updateZoneDuration(zoneId, duration) {
      if (!this._scheduleFormData) return;
      this._scheduleFormData.zone_durations[zoneId] = parseInt(duration) || 15;
    }

    _updateScheduleModalDisplay() {
      // Update day buttons
      const dayBtns = this.querySelectorAll('.day-toggle-btn');
      dayBtns.forEach(btn => {
        const day = parseInt(btn.dataset.day);
        const isSelected = this._scheduleFormData?.days_of_week.includes(day);
        btn.classList.toggle('selected', isSelected);
      });

      // Update zone checkboxes
      const zoneChecks = this.querySelectorAll('.zone-checkbox');
      zoneChecks.forEach(chk => {
        const zoneId = parseInt(chk.dataset.zoneId);
        chk.checked = this._scheduleFormData?.zone_ids.includes(zoneId);
      });
    }

    async saveSchedule() {
      if (!this._scheduleFormData || !this._selectedSystem) return;

      const data = this._scheduleFormData;

      // Validate
      if (!data.name.trim()) {
        this.showError('Schedule name is required');
        return;
      }
      if (data.days_of_week.length === 0) {
        this.showError('Select at least one day');
        return;
      }
      if (data.zone_ids.length === 0) {
        this.showError('Select at least one zone');
        return;
      }

      // Close modal
      this._scheduleModalOpen = false;
      this._editingSchedule = null;
      this._modalOpen = false;
      this.render();

      try {
        // Build schedule object - only include durations for selected zones
        const zoneDurations = {};
        data.zone_ids.forEach(zoneId => {
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
        console.error('[SSC] Failed to save schedule:', error);
        this.showError('Failed to save schedule');
      }
    }

    async deleteSchedule(scheduleId) {
      if (!this._selectedSystem) return;

      if (!confirm('Delete this schedule?')) return;

      try {
        await this.serviceClient.deleteSchedule(
          this._selectedSystem.entity_id,
          scheduleId
        );
        await this.loadSystemData(true);
      } catch (error) {
        console.error('[SSC] Failed to delete schedule:', error);
        this.showError('Failed to delete schedule');
      }
    }

    async runScheduleNow(scheduleId) {
      if (!this._selectedSystem) return;

      console.log('[SSC] Running schedule:', scheduleId);

      try {
        await this.serviceClient.runSchedule(
          this._selectedSystem.entity_id,
          scheduleId
        );
        // Reload data to see updated state
        await this.loadSystemData(true);
      } catch (error) {
        console.error('[SSC] Failed to run schedule:', error);
        this.showError('Failed to run schedule');
      }
    }

    renderScheduleModal() {
      if (!this._scheduleModalOpen || !this._scheduleFormData) {
        return '';
      }

      const data = this._scheduleFormData;
      const zones = this.dataManager.getZones();
      const isEditing = this._editingSchedule !== null;

      // Day buttons
      const dayButtons = DAYS_OF_WEEK.map(day => {
        const isSelected = data.days_of_week.includes(day.value);
        return `
          <button type="button" class="day-toggle-btn ${isSelected ? 'selected' : ''}"
                  data-day="${day.value}"
                  onclick="SmartSprinklerControlPanel.toggleScheduleDay(${day.value})">
            ${day.short}
          </button>
        `;
      }).join('');

      // Zone selection checkboxes (simple list)
      const zoneCheckboxes = zones.map(zone => {
        const isSelected = data.zone_ids.includes(zone.id);
        return `
          <label class="zone-checkbox-label">
            <input type="checkbox" class="zone-checkbox" data-zone-id="${zone.id}"
                   ${isSelected ? 'checked' : ''}
                   onchange="SmartSprinklerControlPanel.toggleScheduleZone(${zone.id})">
            <span>${zone.name || `Zone ${zone.id}`}</span>
          </label>
        `;
      }).join('');

      // Fire order list (drag to reorder)
      const fireOrderItems = data.zone_ids.map((zoneId, index) => {
        const zone = zones.find(z => z.id === zoneId);
        const name = zone?.name || `Zone ${zoneId}`;
        const duration = data.zone_durations[zoneId] || zone?.duration || 15;
        return `
          <div class="fire-order-item" draggable="true" data-zone-id="${zoneId}">
            <span class="fire-order-handle">☰</span>
            <span class="fire-order-num">${index + 1}</span>
            <span class="fire-order-name">${name}</span>
            <input type="number" class="fire-order-duration" value="${duration}" min="1" max="120"
                   onchange="SmartSprinklerControlPanel.updateZoneDuration(${zoneId}, this.value)">
            <span class="fire-order-unit">min</span>
          </div>
        `;
      }).join('');

      const fireOrderContent = data.zone_ids.length === 0
        ? '<div class="fire-order-empty">Select zones above</div>'
        : fireOrderItems;

      return `
        <div class="modal-overlay" onclick="SmartSprinklerControlPanel.closeScheduleModal(event)">
          <div class="modal-content schedule-modal" onclick="event.stopPropagation()">
            <div class="modal-header">
              <h2>${isEditing ? 'Edit Schedule' : 'Create Schedule'}</h2>
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
                  <input type="checkbox" ${data.enabled ? 'checked' : ''}
                         onchange="SmartSprinklerControlPanel.updateScheduleField('enabled', this.checked)">
                  Enabled
                </label>
                <label class="checkbox-label-inline">
                  <input type="checkbox" ${data.skip_if_rain ? 'checked' : ''}
                         onchange="SmartSprinklerControlPanel.updateScheduleField('skip_if_rain', this.checked)">
                  Skip if Rain
                </label>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.closeScheduleModal()">Cancel</button>
              <button class="btn btn-primary" onclick="SmartSprinklerControlPanel.saveSchedule()">
                ${isEditing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      `;
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

    renderHeader() {
      const systemName =
        this._selectedSystem?.attributes?.system_name ||
        this._selectedSystem?.attributes?.friendly_name ||
        'Sprinkler System';
      const isAnyZoneActive = this.dataManager
        .getZones()
        .some((z) => z.state === 'watering' || z.is_running);

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
          const isActive = zone.state === 'watering' || zone.is_running;
          const isDisabled = !zone.enabled;
          const isScheduled = zone.state === 'scheduled';
          const isRainDelayed = zone.state === 'rain_delayed';
          const cardClass = `zone-card ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`;

          // Determine zone icon - sprinkler when running, sprinkler-variant when idle
          const iconClass = isActive ? 'running' : (isDisabled ? 'idle disabled-icon' : 'idle');
          const zoneIconName = isActive ? 'mdi:sprinkler' : 'mdi:sprinkler-variant';

          // Determine status badge class and text
          let statusClass = 'idle';
          let statusText = 'Idle';
          if (isActive) {
            statusClass = 'watering';
            statusText = zone.remaining_time ? `${zone.remaining_time}m left` : 'Running';
          } else if (isDisabled) {
            statusClass = 'disabled-status';
            statusText = 'Disabled';
          } else if (isScheduled) {
            statusClass = 'scheduled';
            statusText = 'Scheduled';
          } else if (isRainDelayed) {
            statusClass = 'rain-delayed';
            statusText = 'Rain Delayed';
          }

          // Build content based on active state
          let cardContent = '';
          if (isActive) {
            // Show progress ring with countdown for running zones
            cardContent = this._renderProgressRing(zone);
          } else {
            // Show stats for inactive zones
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
              ${
                isActive
                  ? `<button class="btn btn-danger" onclick="SmartSprinklerControlPanel.stopZone(${zone.id})">Stop</button>`
                  : `<button class="btn btn-primary btn-start" onclick="SmartSprinklerControlPanel.showDurationModal(${zone.id})" ${isDisabled || this._loadingZones?.has(zone.id) ? 'disabled' : ''}>${this._loadingZones?.has(zone.id) ? 'Starting...' : 'Start'}</button>`
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

    /**
     * Render zone statistics (runtime today, last run, water used).
     *
     * @param {Object} zone - The zone object with stats data
     * @returns {string} HTML string for the stats section
     */
    _renderZoneStats(zone) {
      const stats = [];

      // Default runtime (always show)
      stats.push({
        icon: 'mdi:timer-outline',
        label: 'Default',
        value: `${zone.duration || 15} min`
      });

      // Flow rate (if configured)
      if (zone.flow_rate && zone.flow_rate > 0) {
        stats.push({
          icon: 'mdi:water',
          label: 'Flow',
          value: `${zone.flow_rate} GPM`
        });
      }

      // Area (if configured)
      if (zone.area_sqft && zone.area_sqft > 0) {
        stats.push({
          icon: 'mdi:grid',
          label: 'Area',
          value: `${zone.area_sqft} sq ft`
        });
      }

      // Runtime today
      if (zone.runtime_today && zone.runtime_today > 0) {
        stats.push({
          icon: 'mdi:chart-bar',
          label: 'Today',
          value: `${zone.runtime_today} min`
        });
      }

      // Last run date
      if (zone.last_run) {
        const lastRunDate = new Date(zone.last_run);
        const formattedDate = lastRunDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        stats.push({
          icon: 'mdi:calendar',
          label: 'Last',
          value: formattedDate
        });
      }

      const statsRows = stats.map(stat => `
        <div class="zone-stat-row">
          <ha-icon icon="${stat.icon}"></ha-icon>
          <span class="zone-stat-label">${stat.label}</span>
          <span class="zone-stat-value">${stat.value}</span>
        </div>
      `).join('');

      return `
        <div class="zone-stats">
          ${statsRows}
        </div>
      `;
    }

    /**
     * Render the circular progress ring with countdown timer for a running zone.
     *
     * @param {Object} zone - The zone object with state, remaining_time, and duration
     * @returns {string} HTML string for the progress ring component
     */
    _renderProgressRing(zone) {
      // Check if we have tracking data for accurate timing
      const tracking = this._zoneStartTimes?.get(zone.id);
      let totalSeconds, remainingSeconds, elapsedSeconds;

      if (tracking) {
        // Use tracked data for consistency
        const now = Date.now();
        const elapsedSinceTracking = Math.floor((now - tracking.startedAt) / 1000);
        totalSeconds = tracking.totalDuration;
        remainingSeconds = Math.max(0, tracking.initialRemaining - elapsedSinceTracking);
        elapsedSeconds = totalSeconds - remainingSeconds;
      } else {
        // Fallback for first render - use watering_duration if available
        totalSeconds = (zone.watering_duration || zone.remaining_time || 30) * 60;
        remainingSeconds = (zone.remaining_time || 0) * 60;
        elapsedSeconds = totalSeconds - remainingSeconds;
      }
      const progress = totalSeconds > 0 ? (elapsedSeconds / totalSeconds) : 0;

      // SVG circle calculations (depletes as time passes - starts full, ends empty)
      const radius = 45;
      const circumference = 2 * Math.PI * radius;
      const strokeDashoffset = circumference * progress;

      // Format countdown time as MM:SS
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      const countdownTime = `${mins}:${secs.toString().padStart(2, '0')}`;

      // Format remaining/total (counting down) - use floor so 4:15 shows as 4m
      const totalMins = Math.floor(totalSeconds / 60);
      const remainingMinsFloor = Math.floor(remainingSeconds / 60);
      const remainingDisplay = remainingMinsFloor < 1 && remainingSeconds > 0
        ? `<1m / ${totalMins}m`
        : `${remainingMinsFloor}m / ${totalMins}m`;

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
    }

    renderSchedules() {
      const schedules = this.dataManager.getSchedules();

      const scheduleItems = schedules.length === 0
        ? '<p class="no-schedules">No schedules configured. Create one to automate watering.</p>'
        : schedules.map((schedule) => {
            const daysText = schedule.days_of_week
              ?.map((d) => DAYS_OF_WEEK[d]?.short)
              .filter(Boolean)
              .join(', ') || 'No days';
            const zoneCount = schedule.zone_ids?.length || 0;
            const statusClass = schedule.enabled ? 'active' : 'disabled';
            const statusText = schedule.enabled ? 'Active' : 'Disabled';

            return `
            <div class="schedule-item">
              <div class="schedule-info">
                <div class="schedule-header">
                  <h4>${schedule.name || 'Unnamed Schedule'}</h4>
                  <span class="schedule-status ${statusClass}">${statusText}</span>
                </div>
                <div class="schedule-details">
                  <span class="schedule-time">
                    <ha-icon icon="mdi:clock-outline"></ha-icon>
                    ${schedule.start_time || '00:00'}
                  </span>
                  <span class="schedule-days">
                    <ha-icon icon="mdi:calendar"></ha-icon>
                    ${daysText}
                  </span>
                  <span class="schedule-zones">
                    <ha-icon icon="mdi:sprinkler-variant"></ha-icon>
                    ${zoneCount} zone${zoneCount !== 1 ? 's' : ''}
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
          }).join('');

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

    renderDebugSection() {
      if (!this._hass) return '';

      // Get the sprinkler system sensor
      const systemEntity = this._selectedSystem?.entity_id;
      const systemState = systemEntity ? this._hass.states[systemEntity] : null;

      // Find all sprinkler switch entities
      const switchEntities = Object.entries(this._hass.states)
        .filter(([id]) => id.startsWith('switch.sprinkler_'))
        .sort(([a], [b]) => a.localeCompare(b));

      // Find input_boolean zone states (for template switches)
      const zoneStateEntities = Object.entries(this._hass.states)
        .filter(([id]) => id.startsWith('input_boolean.zone_'))
        .sort(([a], [b]) => a.localeCompare(b));

      const switchRows = switchEntities.map(([entityId, state]) => {
        const isOn = state.state === 'on';
        return `
          <tr>
            <td>${entityId}</td>
            <td class="entity-state ${isOn ? 'state-on' : 'state-off'}">${state.state}</td>
            <td>${state.attributes?.friendly_name || '-'}</td>
            <td>
              <button class="btn btn-small ${isOn ? 'btn-danger' : 'btn-primary'}"
                      onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">
                ${isOn ? 'Turn Off' : 'Turn On'}
              </button>
            </td>
          </tr>
        `;
      }).join('');

      const zoneStateRows = zoneStateEntities.map(([entityId, state]) => {
        const isOn = state.state === 'on';
        return `
          <tr>
            <td>${entityId}</td>
            <td class="entity-state ${isOn ? 'state-on' : 'state-off'}">${state.state}</td>
            <td>
              <button class="btn btn-small ${isOn ? 'btn-danger' : 'btn-primary'}"
                      onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">
                ${isOn ? 'Turn Off' : 'Turn On'}
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Compact switch rows - just zone number and state
      const compactSwitchRows = switchEntities.map(([entityId, state]) => {
        const zoneNum = entityId.replace('switch.sprinkler_', '');
        const isOn = state.state === 'on';
        return `<span class="debug-chip ${isOn ? 'on' : 'off'}" onclick="SmartSprinklerControlPanel.toggleSwitch('${entityId}')">Z${zoneNum}: ${isOn ? 'ON' : 'off'}</span>`;
      }).join('');

      return `
        <h2 class="section-title" style="font-size:14px;margin:12px 0 8px;">🔧 Debug</h2>
        <div class="debug-section debug-compact">
          <div class="debug-grid">
            <div class="debug-col">
              <div class="debug-label">System</div>
              <div class="debug-value">${systemState?.state || '-'} (${systemState?.attributes?.active_zones || 0} active)</div>
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
      const runningZones = zones.filter(z => z.state === 'watering' || z.is_running);

      if (runningZones.length === 0) {
        return '<div class="debug-label">Timer</div><div class="debug-value">No zones running</div>';
      }

      const rows = runningZones.map(zone => {
        const tracking = this._zoneStartTimes?.get(zone.id);
        let localRemain = '-';
        if (tracking) {
          const elapsed = Math.floor((now - tracking.startedAt) / 1000);
          const remainSec = Math.max(0, tracking.initialRemaining - elapsed);
          localRemain = `${Math.floor(remainSec/60)}:${(remainSec%60).toString().padStart(2,'0')}`;
        }
        return `
          <div class="debug-row">
            <span>Z${zone.id}</span>
            <span>BE:${zone.remaining_time ?? '-'}/${zone.watering_duration ?? '-'}m</span>
            <span>Local:${localRemain}</span>
          </div>`;
      }).join('');

      return `<div class="debug-label">Timer (Running)</div>${rows}`;
    }

    /**
     * Render compact zone states.
     */
    _renderZoneDebugCompact() {
      const zones = this.dataManager.getZones();
      const rows = zones.map(z => {
        const st = z.state === 'watering' ? 'RUN' : z.state === 'idle' ? 'idle' : z.state;
        return `<span class="debug-chip ${z.state === 'watering' ? 'on' : ''}">${z.id}:${st}</span>`;
      }).join('');
      return `<div class="debug-label">Zone States</div><div class="debug-chips">${rows}</div>`;
    }

    attachEventListeners() {
      // Event listeners are attached via onclick handlers in the HTML
      // This method can be extended for more complex interactions

      // Attach drag handlers for fire order list if schedule modal is open
      if (this._scheduleModalOpen) {
        this._attachDragHandlers();
      }
    }

    // Static methods for global access from onclick handlers
    static startZone(zoneId, duration = 15) {
      console.log('[SSC] Static startZone called:', zoneId);
      console.log('[SSC] window.smartSprinklerControlPanel:', window.smartSprinklerControlPanel);
      if (window.smartSprinklerControlPanel) {
        window.smartSprinklerControlPanel.startZone(zoneId, duration);
      } else {
        console.error('[SSC] No panel instance found!');
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
  }

  // Register the custom element
  customElements.define('smart-sprinkler-control-panel', SmartSprinklerControlPanel);

  // Export for global access
  window.SmartSprinklerControlPanel = SmartSprinklerControlPanel;
}

console.log(`Smart Sprinkler Control Panel v${VERSION} - Loaded`);
