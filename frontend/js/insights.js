// Insight cards: cheapest 2h block, next cheap moment, peak to avoid.
import { state } from './state.js';
import { insightCurrentIndex, insightCards } from './insights-calc.js';
import { slotsOf } from './slot-time.js';

// Card key → the `insight<Key>Value` / `insight<Key>Detail` element id pair.
const CARD_IDS = { cheap: 'Cheap', next: 'Next', peak: 'Peak' };

export function renderInsights(deps) {
  const doc = deps?.document ?? globalThis.document;
  const nowMs = deps?.nowMs ?? Date.now();
  const isToday = state.activeTab === 'today';
  const data = isToday ? state.today : state.tomorrow;
  const slots = slotsOf(data);

  const currentIdx = insightCurrentIndex(isToday, slots, nowMs);
  const cards = insightCards(slots, currentIdx);

  // Every card is written on every render — no conditional branches, so a tab
  // switch can never leave the previous day's window on screen.
  for (const [key, id] of Object.entries(CARD_IDS)) {
    doc.getElementById(`insight${id}Value`).textContent = cards[key].value;
    doc.getElementById(`insight${id}Detail`).textContent = cards[key].detail;
  }
}
