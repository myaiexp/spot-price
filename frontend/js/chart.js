// Price chart (Chart.js): area/bar × 15min/hourly, with a "now" marker on today.
import { state } from './state.js';
import { chartSeries } from './chart-series.js';
import { buildChartConfig } from './chart-config.js';

// DOM seam: placeholder toggle, then series → config → replace the Chart.js
// instance. Data derivation lives in chart-series.js, styling in chart-config.js.
export function renderChart(deps) {
  const doc = deps?.document ?? globalThis.document;
  const nowMs = deps?.nowMs ?? Date.now();
  const ChartCtor = deps?.Chart ?? globalThis.Chart;
  const matchMedia = deps?.matchMedia ?? ((q) => globalThis.window.matchMedia(q));
  const canvas = doc.getElementById('priceChart');
  const placeholder = doc.getElementById('chartPlaceholder');

  const series = chartSeries(state, nowMs);
  if (!series) {
    canvas.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = 'Ei hintatietoja saatavilla';
    return;
  }

  canvas.style.display = 'block';
  placeholder.style.display = 'none';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const config = buildChartConfig(series, reducedMotion);

  // One Chart.js instance per canvas: a re-render (tab/resolution/type toggle,
  // quarter-hour refresh) must destroy the previous one or they stack.
  if (state.chart) {
    state.chart.destroy();
  }
  state.chart = new ChartCtor(canvas, config);
}
