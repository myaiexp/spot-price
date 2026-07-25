// Pure insight-card state: now-index resolution and the three card texts.

import { findCheapestBlock, findNextCheapWindow, findPeakBlock } from './calc.js';
import { formatCents, slotBoundaryLabel } from './format.js';
import { findSlotContaining, slotBoundaryMs, SLOT_MS } from './slot-time.js';

// Shown when a card has nothing to say (no data / no window).
const EMPTY_CARD = { value: '—', detail: 'Ei tietoja' };

/**
 * Index of "now" within a day's slots, in the form findNextCheapWindow expects:
 *   - inside the array  → that slot's index ("you are in this slot right now")
 *   - past the last slot's window → slots.length, i.e. nothing lies ahead
 *   - no "now" in this day at all → -1, so the forward search starts at slot 0
 *     and the "you're in a cheap window" branch stays off
 *
 * The tomorrow tab is the -1 case: it used to pass 0, which made tomorrow's
 * first slot count as the current one — a cheap 00:00 slot then claimed "Nyt!
 * Olet halvassa jaksossa" on a day that hasn't started (audit #5552).
 */
export function insightCurrentIndex(isToday, slots, nowMs) {
  if (!isToday || !slots || slots.length === 0) return -1;
  const idx = findSlotContaining(slots, nowMs, SLOT_MS);
  if (idx >= 0) return idx;
  // Outside the array: past the data end (late collection) means no window
  // ahead; anything earlier just searches from the start of the day.
  return nowMs >= slotBoundaryMs(slots, slots.length) ? slots.length : -1;
}

// "Next cheap window" card. A countdown only means something when currentIdx is
// a real now-slot; on the tomorrow tab (no "now") the card shows the clock time
// instead, since "starts in 3h 15min" measured from tomorrow's midnight is a
// number about nothing.
function nextCard(slots, currentIdx) {
  const next = findNextCheapWindow(slots, currentIdx);
  if (!next) return { value: '—', detail: 'Ei halpaa jaksoa jäljellä' };

  if (next.inCheapNow) {
    return {
      value: 'Nyt!',
      detail: `Olet halvassa jaksossa (→ ${slotBoundaryLabel(slots, next.endsAt)})`,
    };
  }

  const startLabel = slotBoundaryLabel(slots, next.startIndex);
  const price = `${formatCents(next.price)} c/kWh`;
  const hasNow = currentIdx >= 0 && currentIdx < slots.length;
  if (!hasNow) return { value: startLabel, detail: `Halvin jakso alkaa (${price})` };

  const h = Math.floor(next.startsIn / 60);
  const m = next.startsIn % 60;
  const value = next.startsIn >= 60 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${next.startsIn} min`;
  return { value, detail: `Alkaa ${startLabel} (${price})` };
}

// A block card (cheapest / peak): time span + average price.
function blockCard(slots, block) {
  if (!block) return EMPTY_CARD;
  return {
    value: `${slotBoundaryLabel(slots, block.startIndex)}–${slotBoundaryLabel(slots, block.endIndex + 1)}`,
    detail: `Keskihinta ${formatCents(block.avgPrice)} c/kWh`,
  };
}

/**
 * Texts for all three insight cards: `{ cheap, next, peak }`, each a
 * `{ value, detail }` pair.
 *
 * Every card is always present — an absent block yields the placeholder rather
 * than nothing. The renderer therefore writes all six fields on every call and
 * cannot leave a stale window on screen after a tab switch or a refetch, which
 * the old "if (cheap) { … }" branches did (audit #5552).
 */
export function insightCards(slots, currentIdx) {
  if (!slots || slots.length === 0) {
    return { cheap: EMPTY_CARD, next: EMPTY_CARD, peak: EMPTY_CARD };
  }
  return {
    cheap: blockCard(slots, findCheapestBlock(slots)),
    next: nextCard(slots, currentIdx),
    peak: blockCard(slots, findPeakBlock(slots)),
  };
}
