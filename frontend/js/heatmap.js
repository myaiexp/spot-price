// Weekly heatmap: SQL-aggregated hourly prices, green→amber→red HSL scale.
import { state } from './state.js';
import { priceToColor } from './heatmap-calc.js';

// Monday-first: the backend maps ISODOW 1 → day 0 (heatmap-window.test.ts).
const DAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

// Placeholder text for a *failed* heatmap request — deliberately distinct from
// the "Ei riittävästi tietoja" empty-data state, so a network error isn't read as
// "this week has no prices". Without it the card sat on "Ladataan..." forever
// (audit #5561).
export function showHeatmapError(deps) {
  const doc = deps?.document ?? globalThis.document;
  doc.getElementById('heatmapGrid').style.display = 'none';
  const placeholder = doc.getElementById('heatmapPlaceholder');
  placeholder.style.display = 'block';
  placeholder.textContent = 'Lämpökartan lataus epäonnistui';
}

// Tooltip sits right of and above the pointer; shared by mouseenter/mousemove.
function positionTooltip(tooltip, e) {
  tooltip.style.left = e.clientX + 12 + 'px';
  tooltip.style.top = e.clientY - 32 + 'px';
}

// One hour cell. The backend null-marks missing hours, so only null/undefined
// greys out — 0 and negatives are real prices and colour (finding #7617).
// Greyed cells get no tooltip.
function buildCell(doc, { dayLabel, hour, val, minPrice, maxPrice, tooltip }) {
  const cell = doc.createElement('div');
  cell.className = 'heatmap-cell';

  if (val === null || val === undefined) {
    cell.style.background = 'var(--border)';
    cell.style.opacity = '0.3';
    return cell;
  }

  cell.style.background = priceToColor(val, minPrice, maxPrice);
  const text = `${dayLabel} ${String(hour).padStart(2, '0')}:00 — ${val.toFixed(2)} c/kWh`;
  cell.addEventListener('mouseenter', (e) => {
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    positionTooltip(tooltip, e);
  });
  cell.addEventListener('mousemove', (e) => positionTooltip(tooltip, e));
  cell.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
  return cell;
}

function appendDiv(doc, grid, className, text) {
  const el = doc.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  grid.appendChild(el);
}

export function renderHeatmap(deps) {
  const doc = deps?.document ?? globalThis.document;
  const grid = doc.getElementById('heatmapGrid');
  const placeholder = doc.getElementById('heatmapPlaceholder');
  const tooltip = doc.getElementById('heatmapTooltip');
  const weekRange = doc.getElementById('heatmapWeekRange');

  if (!state.heatmap || !state.heatmap.matrix || state.heatmap.matrix.length === 0) {
    grid.style.display = 'none';
    placeholder.style.display = 'block';
    placeholder.textContent = 'Ei riittävästi tietoja';
    return;
  }

  placeholder.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = '';

  if (weekRange && state.heatmap.weekNumber) {
    weekRange.textContent = `vko ${state.heatmap.weekNumber}`;
  }

  // Color scale spans the backend-computed range over populated cells — the
  // single source of truth. The backend null-marks missing cells, so 0 is a real
  // price and stays in range (a genuinely 0/negative hour must colour).
  const { minPrice, maxPrice } = state.heatmap;

  appendDiv(doc, grid, 'heatmap-corner');
  for (let hour = 0; hour < 24; hour++) appendDiv(doc, grid, 'heatmap-header', hour);

  // Label comes from row.day, not the row's index — the matrix is Monday-first
  // by contract, but a label must never depend on row order.
  for (const row of state.heatmap.matrix) {
    const dayLabel = DAY_LABELS[row.day];
    appendDiv(doc, grid, 'heatmap-row-label', dayLabel);
    for (let hour = 0; hour < 24; hour++) {
      const val = row.hours[hour];
      grid.appendChild(buildCell(doc, { dayLabel, hour, val, minPrice, maxPrice, tooltip }));
    }
  }
}
