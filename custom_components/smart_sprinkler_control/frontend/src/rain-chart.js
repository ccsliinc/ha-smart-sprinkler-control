/**
 * Rain/precip chart: throttled+cached fetch, render-signature-safe
 * chart.update (no rebuild), local-TZ consumption, Chart.js loader.
 */

export const rainChartMethods = {
  _startRainRefresh() {
    if (this._rainRefreshInterval) return;
    this._rainRefreshInterval = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
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
    // When the backend reports zero precipitation sensors (genuine no-sensor
    // case, NOT a transient fetch error), replace the chart with a small muted
    // note instead of a permanently flat zero graph that looks broken.
    if (this._noPrecipSensor) {
      return `
    <div class="rain-graph-container" style="
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(0, 255, 255, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      box-sizing: border-box;
    ">
      <div style="color: #888; font-size: 12px; text-align: center;">
        No precipitation sensor configured.
      </div>
    </div>
  `;
    }

    // Default to in until the API tells us otherwise; _rainUnit is set on
    // every successful fetch so subsequent renders reflect the real sensor
    // unit (mm on metric HA installs, in on imperial).
    const unit = this._rainUnit || 'in';
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
          <span id="rain-today" style="color: #00ffff; font-size: 12px; font-weight: bold;">Today: 0.0 ${unit}</span>
          <span id="rain-total" style="color: #888; font-size: 12px;">24h: 0.0 ${unit}</span>
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
      if (this._isDebugEnabled?.()) console.log('[SSC] No hass available');
      return this._getEmptyRainData('no hass');
    }

    try {
      // Fetch from backend API
      const response = await fetch('/api/smart_sprinkler_control/precipitation');

      if (!response.ok) {
        // Transient/network/server error: keep the section visible (the chart
        // will show last-known or empty data) rather than hiding it.
        console.warn('[SSC] Precipitation API error:', response.status);
        return this._getEmptyRainData('api error');
      }

      const data = await response.json();
      if (this._isDebugEnabled?.()) {
        console.log('[SSC] Precipitation data from API:', data);
      }

      if (data.error) {
        console.warn('[SSC] API returned error:', data.error);
        // Distinguish a genuine "no sensor configured" state (the section is
        // hidden, see _renderRainGraph) from transient errors. The backend
        // returns this exact string only when discovery finds zero sensors.
        this._noPrecipSensor = data.error === 'No precipitation sensors found';
        return this._getEmptyRainData(data.error);
      }

      // A successful fetch with sensors present clears any prior no-sensor state.
      this._noPrecipSensor = false;

      // Convert API response to chart format
      const labels = data.hourly.map(h => h.hour);
      const chartData = data.hourly.map(h => h.total);

      // Determine source label
      const hasRain = data.sensors?.rain?.length > 0;
      const hasSnow = data.sensors?.snow?.length > 0;
      let source = 'live';
      if (hasSnow && hasRain) source = 'live (rain+snow)';
      else if (hasSnow) source = 'live (snow)';
      else if (hasRain) source = 'live (rain)';

      return {
        labels,
        data: chartData,
        total: data.total_24h || 0,
        today: data.today_total || 0,
        source,
        unit: data.unit || 'in',
        currentRate: chartData[chartData.length - 1] || 0
      };

    } catch (error) {
      console.error('[SSC] Error fetching precipitation data:', error);
      return this._getEmptyRainData('fetch error');
    }
  },


  /**
   * Generate empty rain data when no sensor is available.
   * Shows zeros so user knows there's no data, rather than fake mock data.
   */
  _getEmptyRainData(reason) {
    const now = new Date();
    const labels = [];
    const data = [];

    for (let i = 23; i >= 0; i--) {
      const hour = new Date(now - i * 60 * 60 * 1000);
      labels.push(hour.getHours().toString().padStart(2, '0') + ':00');
      data.push(0);
    }

    return { labels, data, total: 0, today: 0, source: reason, unit: this._rainUnit || 'in', currentRate: 0 };
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
    const fresh = this._rainData && (now - this._rainLastFetch) < this._rainFetchInterval;
    if (fresh && !force) {
      return this._rainData;
    }
    // Coalesce concurrent fetches.
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

    // Persist the unit so subsequent placeholder renders and the chart init
    // (legend/ticks/tooltip) can pick it up without re-reading the API.
    this._rainUnit = rainData.unit || this._rainUnit || 'in';
    const unit = this._rainUnit;

    const todayEl = this.querySelector('#rain-today');
    const totalEl = this.querySelector('#rain-total');

    if (todayEl) {
      const todayNum = typeof rainData.today === 'number' ? rainData.today : parseFloat(rainData.today) || 0;
      todayEl.textContent = `Today: ${todayNum.toFixed(1)} ${unit}`;
    }
    if (totalEl) {
      const totalNum = typeof total === 'number' ? total : parseFloat(total) || 0;
      const sourceLabel = source === 'no sensor' ? ' (no sensor)' : source === 'no hass' ? ' (no hass)' : '';
      totalEl.textContent = `24h: ${totalNum.toFixed(1)} ${unit}${sourceLabel}`;
    }

    if (this._rainChart) {
      this._rainChart.data.labels = labels;
      this._rainChart.data.datasets[0].data = data;
      // Keep dataset label, Y-axis tick formatter, and tooltip label in
      // sync with the freshly observed unit so the chart relabels on the
      // next refresh without needing a destroy/recreate.
      this._rainChart.data.datasets[0].label = `Rain (${unit})`;
      const yScale = this._rainChart.options?.scales?.y;
      if (yScale?.ticks) {
        yScale.ticks.callback = (value) => value + ' ' + unit;
      }
      const tooltipCb = this._rainChart.options?.plugins?.tooltip?.callbacks;
      if (tooltipCb) {
        tooltipCb.label = (context) => `${context.parsed.y.toFixed(2)} ${unit}`;
      }
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
    // Prevent multiple simultaneous initializations
    if (this._chartInitializing) return;

    const canvas = this.querySelector('#rainChart');
    if (!canvas || typeof Chart === 'undefined') {
      return;
    }

    // Fetch (throttled/cached) BEFORE deciding to rebuild, so we never
    // fetch more than once per interval regardless of render frequency.
    const rainData = await this._getCachedRainData();

    // The first render paints the chart before the fetch resolves. If that
    // fetch revealed there is genuinely no precipitation sensor, re-render
    // once so _renderRainGraph swaps the chart for the muted note. The note
    // has no #rainChart canvas, so the early-return above prevents any loop.
    if (this._noPrecipSensor) {
      if (this._rainChart) {
        this._rainChart.destroy();
        this._rainChart = null;
      }
      this.render();
      return;
    }

    // If a live chart already exists on this exact canvas, just update
    // its data — no destroy/recreate. This is the flicker fix.
    if (this._rainChart && this._rainChart.canvas === canvas) {
      this._applyRainData(rainData);
      return;
    }

    this._chartInitializing = true;

    // Canvas was replaced by a re-render: drop any stale instance.
    if (this._rainChart) {
      this._rainChart.destroy();
      this._rainChart = null;
    }
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
      existingChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    const { labels, data } = rainData;
    // Seed unit before chart creation so initial legend/ticks/tooltip
    // match the sensor's unit_of_measurement on first render.
    this._rainUnit = rainData.unit || this._rainUnit || 'in';
    const unit = this._rainUnit;

    this._rainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: `Rain (${unit})`,
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
              label: (context) => `${context.parsed.y.toFixed(2)} ${unit}`
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
              callback: (value) => value + ' ' + unit
            }
          }
        }
      }
    });

    this._chartInitializing = false;

    // Populate summary labels for the freshly created chart.
    this._applyRainData(rainData);
  },


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
  },
};
