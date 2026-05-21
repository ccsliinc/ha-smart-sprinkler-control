/**
 * Duration picker modal + zone-settings modal.
 */

export const modalMethods = {
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
  },


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
  },


  closeDurationModal(event) {
    // If event passed, only close if clicking overlay (not content)
    if (event && event.target.classList.contains('modal-content')) {
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
  },

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
  },

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
  },


  closeSettingsModal(event) {
    if (event && event.target.classList.contains('modal-content')) {
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
  },

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
  },
};
