// Weekly heatmap: SQL-aggregated hourly prices, green→amber→red HSL scale.
import { state } from './state.js';

const DAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

export function priceToColor(value, min, max) {
  if (max === min) return '#e8a308';
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // HSL interpolation: green (142°) → amber (39°) → red (0°)
  let h, s, l;
  if (ratio <= 0.5) {
    const t = ratio / 0.5;
    h = 142 - (142 - 39) * t;
    s = 72 + (85 - 72) * t;
    l = 50 + (52 - 50) * t;
  } else {
    const t = (ratio - 0.5) / 0.5;
    h = 39 - (39 - 0) * t;
    s = 85 + (72 - 85) * t;
    l = 52 + (50 - 52) * t;
  }
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  const placeholder = document.getElementById('heatmapPlaceholder');
  const tooltip = document.getElementById('heatmapTooltip');
  const weekRange = document.getElementById('heatmapWeekRange');

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
  const corner = document.createElement('div');
  corner.className = 'heatmap-corner';
  grid.appendChild(corner);

  // Hour headers
  for (let h = 0; h < 24; h++) {
    const hdr = document.createElement('div');
    hdr.className = 'heatmap-header';
    hdr.textContent = h;
    grid.appendChild(hdr);
  }

  // Rows
  for (let d = 0; d < heatmapData.length; d++) {
    const row = heatmapData[d];
    const dayLabel = DAY_LABELS[row.day];

    const label = document.createElement('div');
    label.className = 'heatmap-row-label';
    label.textContent = dayLabel;
    grid.appendChild(label);

    for (let h = 0; h < 24; h++) {
      const cell = document.createElement('div');
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
