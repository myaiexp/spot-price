// Chart.js config for the price chart: static styling plus data-driven datasets.

const AMBER = 'rgba(232, 163, 8, 1)';
const GRID = { color: 'rgba(255, 255, 255, 0.05)' };
const TICK_STYLE = { color: '#52525b', font: { size: 11, family: 'DM Sans' } };
const NO_BORDER = { display: false };

// Tick stride on the category x-axis: hourly shows every 3rd bucket, 15-min
// every 12th slot (every 3 hours). Chart.js hides blank ticks.
const HOURLY_TICK_EVERY = 3;
const SLOT_TICK_EVERY = 12;

const TOOLTIP_CHROME = {
  backgroundColor: '#18181c',
  titleColor: '#fafafa',
  bodyColor: '#a1a1aa',
  borderColor: '#27272a',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 10,
  titleFont: { family: 'DM Sans', weight: '600' },
  bodyFont: { family: 'DM Sans' },
};

const TOOLTIP_CALLBACKS = {
  title(items) {
    return items[0].label;
  },
  // Ghost-series gaps (DST, missing yesterday slots) are null → an em dash.
  label(context) {
    if (context.parsed.y == null) return `${context.dataset.label}: —`;
    return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} c/kWh`;
  },
};

function buildGradient(ctx, chartArea, forBar) {
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

function primaryDataset({ primaryLabel, primaryData, isBar }) {
  return {
    label: primaryLabel,
    data: primaryData,
    borderColor: AMBER,
    borderWidth: isBar ? 0 : 2,
    fill: !isBar,
    backgroundColor: (context) => {
      const { ctx, chartArea } = context.chart;
      return buildGradient(ctx, chartArea, isBar);
    },
    pointRadius: 0,
    pointHoverRadius: isBar ? 0 : 5,
    pointHoverBackgroundColor: AMBER,
    pointHoverBorderColor: '#fff',
    pointHoverBorderWidth: 2,
    tension: isBar ? 0 : 0.3,
    order: 1,
    borderRadius: isBar ? 4 : 0,
  };
}

// Dashed comparison day. On a bar chart it stays a line overlay (mixed chart).
function ghostDataset({ secondaryLabel, secondaryData, isBar }) {
  return {
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
  };
}

// "Nyt" marker for the annotation plugin; empty when now is outside the data.
function nowAnnotations(nowIndex) {
  if (nowIndex < 0) return {};
  return {
    nowLine: {
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
    },
  };
}

function xScale(isHourly) {
  const every = isHourly ? HOURLY_TICK_EVERY : SLOT_TICK_EVERY;
  return {
    grid: GRID,
    ticks: {
      ...TICK_STYLE,
      maxRotation: 0,
      autoSkip: false,
      // Chart.js binds `this` to the scale — must stay a function expression.
      callback: function (value, index) {
        return index % every === 0 ? this.getLabelForValue(value) : '';
      },
    },
    border: NO_BORDER,
  };
}

function yScale() {
  return {
    beginAtZero: true,
    grid: GRID,
    ticks: { ...TICK_STYLE, callback: (value) => value + ' c' },
    border: NO_BORDER,
  };
}

// Full Chart.js config for one render. Every object Chart.js may write to
// (config, data, options, scales, plugins) is built fresh per call — Chart.js
// reassigns options.scales on the config it is handed — so only leaf styling
// constants are shared between renders.
export function buildChartConfig(series, reducedMotion) {
  const datasets = [primaryDataset(series)];
  if (series.secondaryData.length > 0) datasets.push(ghostDataset(series));

  return {
    type: series.isBar ? 'bar' : 'line',
    data: { labels: series.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion ? false : { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      scales: { x: xScale(series.isHourly), y: yScale() },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_CHROME, callbacks: TOOLTIP_CALLBACKS },
        annotation: { annotations: nowAnnotations(series.nowIndex) },
      },
    },
  };
}
