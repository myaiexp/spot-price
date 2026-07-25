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

// Only one load may be in flight: the quarter-hour tick cancels a still-running
// previous load instead of stacking requests behind it. A rejection whose own
// controller was aborted is *us* superseding the load, not a failure — the newer
// load owns the UI from that point, so it must not paint an error.
let loadController = null;

async function loadAllData() {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const superseded = () => controller.signal.aborted;

  try {
    const [today, yesterday, tomorrow, now] = await fetchAllData(controller.signal);
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
    if (!superseded()) {
      console.error('Failed to load data:', err);
      showError('Tietojen lataus epäonnistui. Yritä myöhemmin uudelleen.');
    }
  }

  if (superseded()) return; // a newer load owns the heatmap too

  // Load heatmap separately — it's slow on cold start. A failure here is shown
  // in the heatmap card rather than swallowed, which used to strand it on
  // "Ladataan..." (audit #5561).
  fetchHeatmap(controller.signal)
    .then((heatmap) => {
      state.heatmap = heatmap;
      renderHeatmap();
    })
    .catch((err) => {
      if (superseded()) return;
      console.error('Failed to load heatmap:', err);
      state.heatmap = null;
      showHeatmapError();
    });
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
