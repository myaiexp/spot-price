// Entry point: wires controls, loads data, and drives the quarter-hour refresh.
import { state } from './state.js';
import { fetchAllData, fetchHeatmap } from './api.js';
import { wireToggleGroup } from './ui.js';
import { renderHero, showError } from './hero.js';
import { renderChart } from './chart.js';
import { renderInsights } from './insights.js';
import { renderHeatmap } from './heatmap.js';
import { updateEstimator, initEstimator } from './estimator.js';
import { SLOT_MS } from './slot-time.js';

function updateTomorrowTab() {
  const btn = document.getElementById('tabTomorrow');
  if (!state.tomorrow || !state.tomorrow.slots || state.tomorrow.slots.length === 0) {
    btn.disabled = true;
    btn.title = 'Huomisen hintoja ei vielä saatavilla';
  } else {
    btn.disabled = false;
    btn.title = '';
  }
}

async function loadAllData() {
  try {
    const [today, yesterday, tomorrow, now] = await fetchAllData();
    state.today = today;
    state.yesterday = yesterday;
    state.tomorrow = tomorrow;
    state.now = now;

    updateTomorrowTab();
    renderHero();
    renderChart();
    renderInsights();
    updateEstimator();
  } catch (err) {
    console.error('Failed to load data:', err);
    showError('Tietojen lataus epäonnistui. Yritä myöhemmin uudelleen.');
  }

  // Load heatmap separately — it's slow on cold start.
  fetchHeatmap()
    .then((heatmap) => {
      state.heatmap = heatmap;
      renderHeatmap();
    })
    .catch(() => {});
}

// ─── Wiring ──────────────────────────────────────────────────────────
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

// ─── Auto-refresh ────────────────────────────────────────────────────
// A wall-clock 15-min tick (DST-immune — no h*4 arithmetic): refetch when the
// current quarter-hour bucket changes.
let lastTick = Math.floor(Date.now() / SLOT_MS);
setInterval(() => {
  const tick = Math.floor(Date.now() / SLOT_MS);
  if (tick !== lastTick) {
    lastTick = tick;
    loadAllData();
  }
}, 60000);

// ─── Init ────────────────────────────────────────────────────────────
loadAllData();
