/**
 * Panel CSS. Exported as a prototype mixin (renderStyles).
 */

export const styleMethods = {
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
  },
};
