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

function hasCachedData() {
  return !!(
    (state.now && state.now.slot) ||
    (state.today && state.today.slots && state.today.slots.length)
  );
}

function noteStale() {
  state.refreshFailed = true;
  try {
    renderHero();
  } catch (err) {
    console.error('Render failed (hero stale note):', err);
  }
}

export function init() {
  wireToggleGroup('.tab-btn', (btn) => {
    state.activeTab = btn.dataset.tab;
    renderChart();
    renderInsights();
  });

  wireToggleGroup('#chartTypeToggle .toggle-btn', (btn) => {
    state.chartType = btn.dataset.value;
    renderChart();
  });

  wireToggleGroup('#resolutionToggle .toggle-btn', (btn) => {
    state.resolution = btn.dataset.value;
    renderChart();
  });

  initEstimator();

  const loader = createLoader({
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
  });

  const refresh = createSlotRefresh({
    slotMs: SLOT_MS,
    load: loader.load,
  });
  setInterval(() => refresh.poll(), 60000);

  loader.load();
}
