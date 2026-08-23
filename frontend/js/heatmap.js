// Weekly heatmap: SQL-aggregated hourly prices, green→amber→red HSL scale.
import { state } from './state.js';
import { priceToColor } from './heatmap-calc.js';

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

  const heatmapData = state.heatmap.matrix;

  // Color scale spans the backend-computed range over populated cells — the
  // single source of truth. The backend null-marks missing cells, so 0 is a real
  // price and stays in range (a genuinely 0/negative hour must colour).
  const minPrice = state.heatmap.minPrice;
  const maxPrice = state.heatmap.maxPrice;

  // Corner cell
  const corner = doc.createElement('div');
  corner.className = 'heatmap-corner';
  grid.appendChild(corner);

  // Hour headers
  for (let h = 0; h < 24; h++) {
    const hdr = doc.createElement('div');
    hdr.className = 'heatmap-header';
    hdr.textContent = h;
    grid.appendChild(hdr);
  }

  // Rows
  for (let d = 0; d < heatmapData.length; d++) {
    const row = heatmapData[d];
    const dayLabel = DAY_LABELS[row.day];

    const label = doc.createElement('div');
    label.className = 'heatmap-row-label';
    label.textContent = dayLabel;
    grid.appendChild(label);

    for (let h = 0; h < 24; h++) {
      const cell = doc.createElement('div');
      cell.className = 'heatmap-cell';
      const val = row.hours[h];

      if (val === null || val === undefined) {
        cell.style.background = 'var(--border)';
        cell.style.opacity = '0.3';
      } else {
        cell.style.background = priceToColor(val, minPrice, maxPrice);
        cell.addEventListener('mouseenter', (e) => {
          tooltip.textContent = `${dayLabel} ${String(h).padStart(2, '0')}:00 — ${val.toFixed(2)} c/kWh`;
          tooltip.style.display = 'block';
          tooltip.style.left = e.clientX + 12 + 'px';
          tooltip.style.top = e.clientY - 32 + 'px';
        });
        cell.addEventListener('mousemove', (e) => {
          tooltip.style.left = e.clientX + 12 + 'px';
          tooltip.style.top = e.clientY - 32 + 'px';
        });
        cell.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      }
      grid.appendChild(cell);
    }
  }
}
