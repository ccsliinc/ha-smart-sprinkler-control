/**
 * Smart Sprinkler Control - panel custom element (entry point).
 *
 * Core class: lifecycle, timers, zone/rain-delay control, render(),
 * debug, static onclick bridges. Domain rendering/logic lives in mixin
 * modules assigned to the prototype below (structural split, identical
 * behavior).
 */
import { DOMAIN, VERSION } from './constants.js';
import { ServiceClient } from './service-client.js';
import { DataManager } from './data-manager.js';
import { styleMethods } from './styles.js';
import { rainChartMethods } from './rain-chart.js';
import { zoneCardMethods } from './zone-cards.js';
import { scheduleMethods } from './schedules.js';
import { modalMethods } from './modals.js';

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

    // Render guard: last computed signature of render-affecting state.
    // null forces the first loadSystemData() to render.
    this._renderSignature = null;

    // Rain chart state
    this._rainChart = null;
    this._chartInitializing = false;
    // Throttled precipitation cache: fetch on load, then every 5 min.
    this._rainData = null;        // last fetched/normalized data
    this._rainLastFetch = 0;      // epoch ms of last successful fetch
    this._rainFetchInterval = 5 * 60 * 1000; // 5 minutes
    this._rainFetchInflight = null; // in-flight fetch promise (dedupe)
    this._rainRefreshInterval = null; // background refresh timer handle

    // Visibility change handler
    this._visibilityHandler = null;

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
    this._startRainRefresh();

    // Listen for tab visibility changes (handles sleep/wake)
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SSC] Tab became visible, checking panel state...');
        // Force reconnect and re-render
        if (this._hass) {
          this.dataManager.setHass(this._hass);
          this.dataManager.setupEventListeners();
        }
        // Check if panel is empty/black
        const content = this.innerHTML?.trim();
        if (!content || content.length < 100 || !this.querySelector('.sprinkler-panel')) {
          console.warn('[SSC] Panel empty after wake, forcing re-render');
          this.render();
        } else {
          // Just refresh data
          this.loadSystemData();
        }
        // Reinitialize chart if needed
        setTimeout(async () => {
          if (!this._rainChart || !this.querySelector('#rainChart')) {
            await this._initRainChart();
          }
        }, 200);
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  disconnectedCallback() {
    if (window.smartSprinklerControlPanel === this) {
      delete window.smartSprinklerControlPanel;
    }
    this._stopCountdownTimer();
    this._stopHealthCheck();
    this._stopRainRefresh();
    // Clean up rain chart
    if (this._rainChart) {
      this._rainChart.destroy();
      this._rainChart = null;
    }
    // Clean up visibility handler
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
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
   * Start the throttled precipitation refresh timer. Forces a cache
   * refetch every _rainFetchInterval (5 min) and pushes new data into the
   * existing chart via update() — it never rebuilds the chart, so it
   * cannot cause flicker. Renders in between reuse the cached data.
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

    // Render guard: HA pushes state updates many times per second. A full
    // render rebuilds innerHTML (destroying/recreating the #rainChart canvas
    // and causing flicker). Only do a full render when sprinkler-relevant
    // data actually changed; otherwise let _updateCountdownDisplays() (driven
    // by the 1s countdown timer) handle running-zone countdowns via targeted
    // DOM updates. bypassCache=true is an explicit user action — always render.
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
    const sel = this._selectedSystem?.entity_id || '';
    const systems = (this._systems || [])
      .map(s => s.entity_id)
      .sort()
      .join(',');
    const zones = this.dataManager.getZones().map(z => [
      z.id,
      z.state,
      z.is_running ? 1 : 0,
      z.enabled ? 1 : 0,
      z.name,
      z.watering_duration,
      z.duration,
    ]);
    const schedules = this.dataManager.getSchedules().map(s => [
      s.id,
      s.enabled ? 1 : 0,
      s.name,
      s.next_run,
    ]);
    const weather = this.dataManager.getWeatherData() || {};
    return JSON.stringify({
      sel,
      systems,
      zones,
      schedules,
      rainDelayActive: weather.rainDelayActive,
      rainDelayUntil: weather.rainDelayUntil,
    });
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
      setTimeout(async () => await this._initRainChart(), 50);
    });
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

    switchEntities.map(([entityId, state]) => {
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

    zoneStateEntities.map(([entityId, state]) => {
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

// Mix domain method groups onto the prototype (structural split only).
Object.assign(
  SmartSprinklerControlPanel.prototype,
  styleMethods,
  rainChartMethods,
  zoneCardMethods,
  scheduleMethods,
  modalMethods,
);

// Prevent redefinition if already loaded
if (!window.SmartSprinklerControlPanel) {
  // Register the custom element
  customElements.define('smart-sprinkler-control-panel', SmartSprinklerControlPanel);

  // Export for global access
  window.SmartSprinklerControlPanel = SmartSprinklerControlPanel;
}

console.log(`Smart Sprinkler Control Panel v${VERSION} - Loaded`);
