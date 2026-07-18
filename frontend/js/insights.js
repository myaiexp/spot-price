// Insight cards: cheapest 2h block, next cheap moment, peak to avoid.
import { state } from './state.js';
import { findCheapestBlock, findNextCheapWindow, findPeakBlock } from './calc.js';
import { formatCents, slotBoundaryLabel } from './format.js';
import { findSlotContaining, SLOT_MS } from './slot-time.js';

function clearInsights() {
  for (const id of ['Cheap', 'Next', 'Peak']) {
    document.getElementById(`insight${id}Value`).textContent = '—';
    document.getElementById(`insight${id}Detail`).textContent = 'Ei tietoja';
  }
}

export function renderInsights() {
  const isToday = state.activeTab === 'today';
  const data = isToday ? state.today : state.tomorrow;

  if (!data || !data.slots || data.slots.length === 0) {
    clearInsights();
    return;
  }

  const slots = data.slots;
  // Current slot by datetime (DST-correct); −1 when now is outside the array
  // (e.g. the tomorrow tab), which findNextCheapWindow tolerates.
  const currentIdx = isToday ? findSlotContaining(slots, Date.now(), SLOT_MS) : 0;

  // Cheapest 2h block
  const cheap = findCheapestBlock(slots);
  if (cheap) {
    document.getElementById('insightCheapValue').textContent =
      `${slotBoundaryLabel(slots, cheap.startIndex)}–${slotBoundaryLabel(slots, cheap.endIndex + 1)}`;
    document.getElementById('insightCheapDetail').textContent =
      `Keskihinta ${formatCents(cheap.avgPrice)} c/kWh`;
  }

  // Next cheap window
  const next = findNextCheapWindow(slots, currentIdx);
  if (next) {
    if (next.inCheapNow) {
      document.getElementById('insightNextValue').textContent = 'Nyt!';
      document.getElementById('insightNextDetail').textContent =
        `Olet halvassa jaksossa (→ ${slotBoundaryLabel(slots, next.endsAt)})`;
    } else {
      if (next.startsIn >= 60) {
        const h = Math.floor(next.startsIn / 60);
        const m = next.startsIn % 60;
        document.getElementById('insightNextValue').textContent = m > 0 ? `${h}h ${m}min` : `${h}h`;
      } else {
        document.getElementById('insightNextValue').textContent = `${next.startsIn} min`;
      }
      document.getElementById('insightNextDetail').textContent =
        `Alkaa ${slotBoundaryLabel(slots, next.startIndex)} (${formatCents(next.price)} c/kWh)`;
    }
  } else {
    document.getElementById('insightNextValue').textContent = '—';
    document.getElementById('insightNextDetail').textContent =
      isToday ? 'Ei halpaa jaksoa jäljellä' : 'Ei tietoja';
  }

  // Peak to avoid
  const peak = findPeakBlock(slots);
  if (peak) {
    document.getElementById('insightPeakValue').textContent =
      `${slotBoundaryLabel(slots, peak.startIndex)}–${slotBoundaryLabel(slots, peak.endIndex + 1)}`;
    document.getElementById('insightPeakDetail').textContent =
      `Keskihinta ${formatCents(peak.avgPrice)} c/kWh`;
  }
}
