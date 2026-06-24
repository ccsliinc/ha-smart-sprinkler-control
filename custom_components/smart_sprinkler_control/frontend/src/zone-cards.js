/**
 * Zone card / header / weather / no-systems rendering.
 */

export const zoneCardMethods = {
  renderHeader() {
    const systemName =
      this._selectedSystem?.attributes?.system_name ||
      this._selectedSystem?.attributes?.friendly_name ||
      'Sprinkler System';
    // Activity is sourced ONLY from the backend zone model (state === 'watering').
    // We deliberately do NOT look at the underlying switch entity's state or
    // last_changed, so an ESPHome reconnect (unavailable -> off) or the safety
    // all-off can never be mistaken for a zone being active.
    const isAnyZoneActive = this.dataManager
      .getZones()
      .some((z) => z.state === 'watering' && z.is_running);

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
  },


  renderZones() {
    const zones = this.dataManager.getZones();

    if (zones.length === 0) {
      return `<p>No zones configured.</p>`;
    }

    const zoneCards = zones
      .map((zone) => {
        // Backend-driven activity only (see renderHeader): availability
        // transitions on the switch entity never count as "active".
        const isActive = zone.state === 'watering' && zone.is_running;
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
  },

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
  },

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
  },

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
              ? `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.disableRainDelay()">Clear Rain Delay</button>`
              : `<button class="btn btn-secondary" onclick="SmartSprinklerControlPanel.enableRainDelay()">Enable Rain Delay</button>`
          }
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
  },
};
