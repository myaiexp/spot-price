// Tests for the insight cards' pure state logic
// (../../frontend/js/insights-calc.js): now-index resolution per tab and the
// three card texts.
//
// This layer had no coverage (audit #5552) while it passed currentIdx = 0 for
// the tomorrow tab — making tomorrow's first slot count as "now" — and skipped
// the cheap/peak cards entirely when a block was absent, leaving the previous
// day's window on screen after a tab switch.

import { describe, it, expect } from 'vitest';
import { insightCurrentIndex, insightCards } from '../../frontend/js/insights-calc.js';
import { stepSlots } from './test-support/rows.js';

// 15-min slots stepping from a UTC start. Winter (EET, UTC+2) so wall-clock
// labels are the UTC time + 2h with no DST edge in play. Prices are EUR/kWh.

// Today: 12 slots, 14:00–17:00 Helsinki. Dear 14:00–15:00 (0.30), cheap
// 15:00–16:00 (0.10), mid 16:00–17:00 (0.20) — so both the cheapest block and
// the peak run clear their 8- and 4-slot minimums.
const TODAY = stepSlots('2026-01-15T12:00:00.000Z', [
  0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2,
]);
const LAST_END_MS = Date.parse('2026-01-15T15:00:00.000Z'); // last slot 14:45Z + 15 min

describe('insightCurrentIndex', () => {
  it('returns the containing slot index on the today tab', () => {
    expect(insightCurrentIndex(true, TODAY, Date.parse('2026-01-15T12:35:00.000Z'))).toBe(2);
  });

  it('returns -1 on the tomorrow tab even when the clock lands inside a slot', () => {
    // The regression: 0 was returned here, so tomorrow's first slot was treated
    // as the current one (audit #5552).
    expect(insightCurrentIndex(false, TODAY, Date.parse('2026-01-15T12:00:00.000Z'))).toBe(-1);
  });

  it('returns slots.length when now is past the last slot window (late collection)', () => {
    expect(insightCurrentIndex(true, TODAY, LAST_END_MS)).toBe(TODAY.length);
    expect(insightCurrentIndex(true, TODAY, LAST_END_MS + 3600_000)).toBe(TODAY.length);
  });

  it('returns -1 when now precedes the first slot', () => {
    expect(insightCurrentIndex(true, TODAY, Date.parse('2026-01-15T11:00:00.000Z'))).toBe(-1);
  });

  it('returns -1 for an empty or missing slots array', () => {
    expect(insightCurrentIndex(true, [], Date.now())).toBe(-1);
    expect(insightCurrentIndex(true, undefined, Date.now())).toBe(-1);
  });
});

describe('insightCards', () => {
  it('renders all three cards for a normal today view', () => {
    // now inside slot 0 (14:00–14:15). Cheapest 8-slot block is 15:00–17:00
    // (avg of 0.10×4 + 0.20×4 = 0.15); its end boundary extrapolates to 17:00.
    const cards = insightCards(TODAY, 0);
    expect(cards.cheap).toEqual({ value: '15:00–17:00', detail: 'Keskihinta 15.00 c/kWh' });
    // Cheap threshold (sorted value at 1/3) = 0.20, so 15:00 (index 4) is the
    // next cheap slot: 4 slots = 60 min away.
    expect(cards.next).toEqual({ value: '1h', detail: 'Alkaa 15:00 (10.00 c/kWh)' });
    // Peak threshold (sorted value at 0.6) = 0.20; the 0.30 run 14:00–15:00 wins
    // over the equally long 0.20 run on the earliest-run tie rule.
    expect(cards.peak).toEqual({ value: '14:00–15:00', detail: 'Keskihinta 30.00 c/kWh' });
  });

  it('counts down in minutes when the next cheap window is under an hour away', () => {
    // currentIdx 2 is still in the 0.30 run; next cheap is index 4 (15:00) =
    // 2 slots = 30 min. The existing today-view case only hits the exact-1h
    // branch (`${h}h`); this is the `${n} min` branch (audit #7137).
    const cards = insightCards(TODAY, 2);
    expect(cards.next).toEqual({ value: '30 min', detail: 'Alkaa 15:00 (10.00 c/kWh)' });
  });

  it('counts down as hours and leftover minutes when both are set', () => {
    // Five expensive slots, then cheap — so from index 0 the next cheap is
    // index 5: 5 × 15 min = 75 min → `1h 15min`. TODAY's cheap run starts at
    // index 4 (exactly 60 min from 0), so this fixture is what reaches the
    // mixed `${h}h ${m}min` branch (audit #7137).
    const later = stepSlots('2026-01-15T12:00:00.000Z', [
      0.3, 0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2,
    ]);
    const cards = insightCards(later, 0);
    expect(cards.next).toEqual({ value: '1h 15min', detail: 'Alkaa 15:15 (10.00 c/kWh)' });
  });

  it('reports being inside a cheap window right now', () => {
    const cards = insightCards(TODAY, 4);
    // At-or-under-threshold slots run to the end of the array, so the window
    // ends at the extrapolated 17:00 boundary.
    expect(cards.next).toEqual({ value: 'Nyt!', detail: 'Olet halvassa jaksossa (→ 17:00)' });
  });

  it('never claims "Nyt!" on the tomorrow tab, showing the start time instead', () => {
    // Tomorrow: 00:00–01:45 Helsinki with the cheapest slot first. With the old
    // currentIdx = 0 this rendered "Nyt! Olet halvassa jaksossa" for a day that
    // has not started; with -1 it is a plain clock time and no countdown.
    const tomorrow = stepSlots('2026-01-15T22:00:00.000Z', [0.02, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3]);
    const cards = insightCards(tomorrow, insightCurrentIndex(false, tomorrow, Date.now()));
    expect(cards.next.value).not.toBe('Nyt!');
    expect(cards.next).toEqual({ value: '00:00', detail: 'Halvin jakso alkaa (2.00 c/kWh)' });
  });

  it('reports no window left when now is past the day\'s last slot', () => {
    const cards = insightCards(TODAY, insightCurrentIndex(true, TODAY, LAST_END_MS));
    expect(cards.next).toEqual({ value: '—', detail: 'Ei halpaa jaksoa jäljellä' });
    // The other two cards still describe the day.
    expect(cards.cheap.value).toBe('15:00–17:00');
  });

  it('clears the cheap and peak cards when no block qualifies', () => {
    // 3 slots: too few for the 8-slot cheapest block and for a 4-slot peak run.
    // Both must yield the placeholder so the renderer overwrites stale text.
    const short = stepSlots('2026-01-15T12:00:00.000Z', [0.3, 0.3, 0.3]);
    const cards = insightCards(short, 0);
    expect(cards.cheap).toEqual({ value: '—', detail: 'Ei tietoja' });
    expect(cards.peak).toEqual({ value: '—', detail: 'Ei tietoja' });
  });

  it('returns placeholders for every card when there are no slots', () => {
    const cards = insightCards([], -1);
    expect(cards).toEqual({
      cheap: { value: '—', detail: 'Ei tietoja' },
      next: { value: '—', detail: 'Ei tietoja' },
      peak: { value: '—', detail: 'Ei tietoja' },
    });
  });

  it('always returns a value and a detail for all three cards', () => {
    // Structural guarantee behind the "no stale card" fix: the renderer can
    // unconditionally write six fields.
    for (const idx of [-1, 0, 4, TODAY.length]) {
      const cards = insightCards(TODAY, idx);
      for (const key of ['cheap', 'next', 'peak'] as const) {
        expect(typeof cards[key].value).toBe('string');
        expect(typeof cards[key].detail).toBe('string');
      }
    }
  });
});
