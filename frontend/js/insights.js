// Insight cards: cheapest 2h block, next cheap moment, peak to avoid.
import { state } from './state.js';
import { insightCurrentIndex, insightCards } from './insights-calc.js';

// Card key → the `insight<Key>Value` / `insight<Key>Detail` element id pair.
const CARD_IDS = { cheap: 'Cheap', next: 'Next', peak: 'Peak' };

export function renderInsights() {
  const isToday = state.activeTab === 'today';
  const data = isToday ? state.today : state.tomorrow;
  const slots = data && data.slots ? data.slots : [];

  const currentIdx = insightCurrentIndex(isToday, slots, Date.now());
  const cards = insightCards(slots, currentIdx);

  // Every card is written on every render — no conditional branches, so a tab
  // switch can never leave the previous day's window on screen.
  for (const [key, id] of Object.entries(CARD_IDS)) {
    document.getElementById(`insight${id}Value`).textContent = cards[key].value;
    document.getElementById(`insight${id}Detail`).textContent = cards[key].detail;
  }
}
