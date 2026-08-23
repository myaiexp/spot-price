// Entry point: wires controls, loads data, and drives the quarter-hour refresh.
import { state } from './state.js';
import { fetchAllData, fetchHeatmap } from './api.js';
import { wireToggleGroup } from './ui.js';
import { renderHero, showError } from './hero.js';
import { renderChart } from './chart.js';
import { renderInsights } from './insights.js';
import { renderHeatmap, showHeatmapError } from './heatmap.js';
import { updateEstimator, initEstimator } from './estimator.js';
import { SLOT_MS } from './slot-time.js';
import { tomorrowTabDecision } from './tab-state.js';
import { createLoader, createSlotRefresh } from './load.js';

export const SLOT_REFRESH_MS = 60_000;

function syncTomorrowTab() {
  const decision = tomorrowTabDecision(state.tomorrow, state.activeTab);
  const btn = document.getElementById('tabTomorrow');
  if (!btn) return;
  btn.disabled = !decision.enabled;
  btn.title = decision.enabled ? '' : 'Huomisen hintoja ei vielä saatavilla';
  if (decision.activeTab !== state.activeTab) {
    state.activeTab = decision.activeTab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === decision.activeTab);
    });
  }
}

function applyPayload([today, yesterday, tomorrow, now]) {
  state.today = today;
  state.yesterday = yesterday;
  state.tomorrow = tomorrow;
  state.now = now;
  state.refreshFailed = false;
}

export function hasCachedData() {
  return !!(
    (state.now && state.now.slot) ||
    (state.today && state.today.slots && state.today.slots.length)
  );
}

export function noteStale() {
  state.refreshFailed = true;
  try {
    renderHero();
  } catch (err) {
    console.error('Render failed (hero stale note):', err);
  }
}

// Production loader wiring. Extracted so tests can pin hasCachedData / noteStale
// / the tomorrowTab renderer without booting the whole dashboard (finding #7619).
export function buildLoaderDeps() {
  return {
    fetchAllData,
    fetchHeatmap,
    applyPayload,
    applyHeatmap: (heatmap) => {
      state.heatmap = heatmap;
    },
    renderers: [
      { name: 'tomorrowTab', run: syncTomorrowTab },
      { name: 'hero', run: renderHero },
      { name: 'chart', run: renderChart },
      { name: 'insights', run: renderInsights },
      { name: 'estimator', run: updateEstimator },
    ],
    renderHeatmap,
    showError,
    showHeatmapError,
    hasCachedData,
    noteStale,
    logError: (...args) => console.error(...args),
  };
}

export function init(hooks = {}) {
  const createLoaderFn = hooks.createLoader ?? createLoader;
  const createSlotRefreshFn = hooks.createSlotRefresh ?? createSlotRefresh;
  const setIntervalFn = hooks.setInterval ?? setInterval;
  const initEstimatorFn = hooks.initEstimator ?? initEstimator;
  const renderChartFn = hooks.renderChart ?? renderChart;
  const renderInsightsFn = hooks.renderInsights ?? renderInsights;

  wireToggleGroup('.tab-btn', (btn) => {
    state.activeTab = btn.dataset.tab;
    renderChartFn();
    renderInsightsFn();
  });

  wireToggleGroup('#chartTypeToggle .toggle-btn', (btn) => {
    state.chartType = btn.dataset.value;
    renderChart();
  });

  wireToggleGroup('#resolutionToggle .toggle-btn', (btn) => {
    state.resolution = btn.dataset.value;
    renderChart();
  });

  initEstimatorFn();

  const loader = createLoaderFn(buildLoaderDeps());
  const refresh = createSlotRefreshFn({
    slotMs: SLOT_MS,
    load: loader.load,
  });
  setIntervalFn(() => refresh.poll(), SLOT_REFRESH_MS);

  loader.load();
}

// Page entry: index.html loads this file as type=module so script-src can
// omit 'unsafe-inline' (finding #7954). Tests import named exports and call
// init() themselves; Vitest sets VITEST so this is a no-op under the runner.
if (!globalThis.process?.env?.VITEST) {
  init();
}
