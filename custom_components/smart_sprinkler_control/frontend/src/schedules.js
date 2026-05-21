/**
 * Schedule list + create/edit schedule modal.
 */

import { DAYS_OF_WEEK } from './constants.js';

export const scheduleMethods = {
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
  },

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
  },


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
  },


  closeScheduleModal(event) {
    if (event && event.target.classList.contains('modal-content')) {
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
      // Add to end (user can reorder via drag)
      zones.push(zoneId);
    }
    this._updateScheduleModalDisplay();
    this._updateFireOrderList();
  },

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
  },


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
  },


  updateZoneDuration(zoneId, duration) {
    if (!this._scheduleFormData) return;
    this._scheduleFormData.zone_durations[zoneId] = parseInt(duration) || 15;
  },

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
  },


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
  },


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
  },


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
  },


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
  },
};
