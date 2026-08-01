// Price chart (Chart.js): area/bar × 15min/hourly, with a "now" marker on today.
import { state } from './state.js';
import { emaAggregate, alignSecondaryByWallClock } from './calc.js';
import { eurToCents, slotLabel, hourLabel } from './format.js';
import { findSlotContaining, SLOT_MS, HOUR_MS } from './slot-time.js';

function buildGradient(ctx, chartArea, forBar = false) {
  if (!chartArea) return 'rgba(232, 163, 8, 0.3)';
  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  if (forBar) {
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.85)');
    gradient.addColorStop(0.5, 'rgba(232, 163, 8, 0.75)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.85)');
  } else {
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.35)');
    gradient.addColorStop(0.5, 'rgba(232, 163, 8, 0.25)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.3)');
  }
  return gradient;
}

export function renderChart() {
  const canvas = document.getElementById('priceChart');
  const placeholder = document.getElementById('chartPlaceholder');

  const isToday = state.activeTab === 'today';
  const primary = isToday ? state.today : state.tomorrow;
  const secondary = isToday ? state.yesterday : state.today;

  if (!primary || !primary.slots || primary.slots.length === 0) {
    canvas.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = 'Ei hintatietoja saatavilla';
    return;
  }

  canvas.style.display = 'block';
  placeholder.style.display = 'none';

  const isHourly = state.resolution === 'hourly';
  const isBar = state.chartType === 'bar';

  // Apply resolution
  let primarySlots = primary.slots;
  let secondarySlots = secondary && secondary.slots ? secondary.slots : [];
  if (isHourly) {
    primarySlots = emaAggregate(primarySlots);
    if (secondarySlots.length > 0) secondarySlots = emaAggregate(secondarySlots);
  }

  // Labels derived from each slot's own datetime — DST-correct (no h*4 drift).
  const labels = isHourly
    ? primarySlots.map((s) => hourLabel(s.datetime))
    : primarySlots.map((s) => slotLabel(s.datetime));
  const primaryData = primarySlots.map((s) => eurToCents(s.priceWithTax));
  // Ghost series: match secondary to primary by Helsinki wall-clock, not index
  // (DST length mismatch + hourly-backfill vs 15-min primary; audit #6332).
  const secondaryAligned = alignSecondaryByWallClock(primarySlots, secondarySlots, {
    hourly: isHourly,
  });
  const secondaryData = secondaryAligned.map((p) => (p == null ? null : eurToCents(p)));

  const secondaryLabel = isToday ? 'Eilen' : 'Tänään';
  const primaryLabel = isToday ? 'Tänään' : 'Huomenna';

  // "Now" x-position: the slot/hour bucket whose window contains the current
  // instant (−1 when outside the shown data, e.g. after midnight rollover).
  const nowIndex = isToday
    ? findSlotContaining(primarySlots, Date.now(), isHourly ? HOUR_MS : SLOT_MS)
    : -1;

  const primaryDataset = {
    label: primaryLabel,
    data: primaryData,
    borderColor: 'rgba(232, 163, 8, 1)',
    borderWidth: isBar ? 0 : 2,
    fill: !isBar,
    backgroundColor: function (context) {
      const chart = context.chart;
      const { ctx, chartArea } = chart;
      return buildGradient(ctx, chartArea, isBar);
    },
    pointRadius: 0,
    pointHoverRadius: isBar ? 0 : 5,
    pointHoverBackgroundColor: 'rgba(232, 163, 8, 1)',
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    tension: isBar ? 0 : 0.3,
    order: 1,
    borderRadius: isBar ? 4 : 0,
  };

  const datasets = [primaryDataset];

  if (secondaryData.length > 0) {
    datasets.push({
      label: secondaryLabel,
      data: secondaryData,
      borderColor: 'rgba(161, 161, 170, 0.3)',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.3,
      order: 2,
      type: isBar ? 'line' : undefined,
    });
  }

  // Annotation for "now" marker (only on today tab, and only when in view)
  const annotations = {};
  if (isToday && nowIndex >= 0) {
    annotations.nowLine = {
      type: 'line',
      xMin: nowIndex,
      xMax: nowIndex,
      borderColor: 'rgba(232, 163, 8, 0.5)',
      borderWidth: 1.5,
      borderDash: [4, 4],
      label: {
        display: true,
        content: 'Nyt',
        position: 'start',
        backgroundColor: 'rgba(232, 163, 8, 0.9)',
        color: '#09090b',
        font: { size: 11, weight: '600', family: 'DM Sans' },
        padding: { x: 6, y: 3 },
        borderRadius: 4,
      },
    };
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const config = {
    type: isBar ? 'bar' : 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion ? false : { duration: 600 },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#52525b',
            font: { size: 11, family: 'DM Sans' },
            maxRotation: 0,
            callback: function (value, index) {
              if (isHourly) {
                return index % 3 === 0 ? this.getLabelForValue(value) : '';
              }
              // 15min: show every 3 hours (every 12th slot)
              if (index % 12 === 0) return this.getLabelForValue(value);
              return '';
            },
            autoSkip: false,
          },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#52525b',
            font: { size: 11, family: 'DM Sans' },
            callback: function (value) {
              return value + ' c';
            },
          },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#18181c',
          titleColor: '#fafafa',
          bodyColor: '#a1a1aa',
          borderColor: '#27272a',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          titleFont: { family: 'DM Sans', weight: '600' },
          bodyFont: { family: 'DM Sans' },
          callbacks: {
            title: function (items) {
              return items[0].label;
            },
            label: function (context) {
              if (context.parsed.y == null) return `${context.dataset.label}: —`;
              return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} c/kWh`;
            },
          },
        },
        annotation: {
          annotations: annotations,
        },
      },
    },
  };

  if (state.chart) {
    state.chart.destroy();
  }
  state.chart = new Chart(canvas, config);
}
