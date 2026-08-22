// Tests for the frontend's pure cost-estimator logic
// (../../frontend/js/estimator-calc.js): forward-slot filtering (drop past
// windows), deadline resolution with next-day rollover, and the optimal-window
// search including the unclamped past-the-end window end index.

import { describe, it, expect } from 'vitest';
import {
  futureSlots,
  findDeadlineSlotIndex,
  findOptimalWindow,
  isDeadlineDayUnavailable,
  parseDeadlineMinutes,
  collectEstimatorSlots,
} from '../../frontend/js/estimator-calc.js';

// Summer (EEST, UTC+3) slot at a Helsinki wall-clock time — deterministic, no DST
// inside the test window.
function eest(day: number, hour: number, minute: number, price = 0) {
  const ms = Date.UTC(2026, 6, day, hour, minute) - 3 * 60 * 60 * 1000;
  return { datetime: new Date(ms).toISOString(), priceWithTax: price, priceNoTax: price };
}

// 15-min slots from Helsinki 2026-07-18 00:00 with the given prices.
const quarterSlots = (prices: number[]) =>
  prices.map((p, i) => eest(18, Math.floor(i / 4), (i % 4) * 15, p));

describe('futureSlots', () => {
  it('drops slots whose window has already ended', () => {
    const slots = quarterSlots([1, 2, 3, 4]); // 00:00, 00:15, 00:30, 00:45
    const now = Date.parse(slots[1].datetime) + 5 * 60 * 1000; // inside slot[1]
    const kept = futureSlots(slots, now);
    expect(kept).toHaveLength(3);
    expect(kept[0]).toBe(slots[1]);
  });
});

describe('parseDeadlineMinutes', () => {
  it('returns null for an empty value', () => {
    expect(parseDeadlineMinutes('')).toBeNull();
    expect(parseDeadlineMinutes(null)).toBeNull();
    expect(parseDeadlineMinutes(undefined)).toBeNull();
  });
  it('parses HH:MM as integer minutes since midnight', () => {
    expect(parseDeadlineMinutes('07:00')).toBe(420);
    expect(parseDeadlineMinutes('07:30')).toBe(450);
    expect(parseDeadlineMinutes('00:00')).toBe(0);
    expect(parseDeadlineMinutes('23:59')).toBe(23 * 60 + 59);
  });
  it('keeps a non-quarter-hour time as integer minutes (no float round-trip)', () => {
    // 07:20 used to be 7 + 20/60 = 7.333… then * 60 = 439.999…; minutes stay 440.
    expect(parseDeadlineMinutes('07:20')).toBe(440);
  });
  it('returns null when minutes are missing (no || 0 fallback)', () => {
    expect(parseDeadlineMinutes('07')).toBeNull();
  });
  it('returns null for a non-numeric hour', () => {
    expect(parseDeadlineMinutes('abc:30')).toBeNull();
    expect(parseDeadlineMinutes('not-a-time')).toBeNull();
  });
});

describe('findDeadlineSlotIndex', () => {
  // hourly slots across two Helsinki days (48 slots)
  const twoDays = [
    ...Array.from({ length: 24 }, (_, h) => eest(18, h, 0)),
    ...Array.from({ length: 24 }, (_, h) => eest(19, h, 0)),
  ];

  it('resolves a later-today deadline to today', () => {
    expect(findDeadlineSlotIndex(twoDays, 7 * 60)).toBe(7); // 07:00 today
  });
  it('rolls a deadline at/before the first slot to the next day', () => {
    const evening = twoDays.slice(22); // starts 22:00 today
    // 07:00 is before 22:00 → tomorrow. Array: [22,23, then day2 0..23] → idx 2+7.
    expect(findDeadlineSlotIndex(evening, 7 * 60)).toBe(9);
  });
  it('handles HH:MM deadlines as minutes since midnight', () => {
    expect(findDeadlineSlotIndex(twoDays, 7 * 60 + 30)).toBe(8); // 07:30 → first slot ≥ = 08:00
  });
  it('returns null when the deadline lands past the last slot', () => {
    const short = [eest(18, 22, 0), eest(18, 23, 0), eest(19, 0, 0), eest(19, 5, 0)];
    expect(findDeadlineSlotIndex(short, 7 * 60)).toBeNull(); // rolls to tomorrow, none ≥ 07:00
  });
});

describe('isDeadlineDayUnavailable', () => {
  // Only-today evening slots — a morning deadline rolls to tomorrow, which isn't here.
  const todayOnlyEvening = [eest(18, 20, 0), eest(18, 21, 0), eest(18, 22, 0), eest(18, 23, 0)];
  const twoDays = [
    ...Array.from({ length: 24 }, (_, h) => eest(18, h, 0)),
    ...Array.from({ length: 24 }, (_, h) => eest(19, h, 0)),
  ];

  it('is true when a rolled next-day deadline has no matching slots', () => {
    expect(isDeadlineDayUnavailable(todayOnlyEvening, 7 * 60)).toBe(true);
  });

  it('is false when tomorrow covers the rolled deadline', () => {
    const evening = twoDays.slice(22); // 22:00 today onward through tomorrow
    expect(isDeadlineDayUnavailable(evening, 7 * 60)).toBe(false);
  });

  it('is false for a same-day deadline even if past available data', () => {
    // Deadline 23:00 is still "today" relative to 20:00 start; missing coverage
    // is a different miss — not the "tomorrow unpublished" case.
    expect(isDeadlineDayUnavailable(todayOnlyEvening.slice(0, 2), 23 * 60)).toBe(false);
  });

  it('is false with no deadline', () => {
    expect(isDeadlineDayUnavailable(todayOnlyEvening, null)).toBe(false);
  });
});

describe('collectEstimatorSlots', () => {
  it('concatenates today then tomorrow and drops slots whose window has ended', () => {
    const today = { slots: quarterSlots([1, 2, 3, 4]) }; // 00:00 .. 00:45
    const tomorrow = { slots: [eest(19, 0, 0, 5), eest(19, 0, 15, 6)] };
    const now = Date.parse(today.slots[1].datetime) + 5 * 60 * 1000; // inside 00:15
    const kept = collectEstimatorSlots(today, tomorrow, now);
    expect(kept).toHaveLength(5);
    expect(kept[0]).toBe(today.slots[1]);
    expect(kept[3]).toBe(tomorrow.slots[0]);
  });

  it('skips a missing or empty tomorrow payload', () => {
    const today = { slots: quarterSlots([1, 2]) };
    const now = Date.parse(today.slots[0].datetime) - 1;
    expect(collectEstimatorSlots(today, null, now)).toEqual(today.slots);
    expect(collectEstimatorSlots(today, { slots: [] }, now)).toEqual(today.slots);
  });
});

describe('findOptimalWindow', () => {
  it('finds the cheapest and most expensive 1h windows', () => {
    const slots = quarterSlots([10, 10, 10, 10, 1, 1, 1, 1, 10, 10, 10, 10]);
    const r = findOptimalWindow(slots, 1, 1, null)!; // 1h = 4 slots, 1 kW
    expect(r.best).toMatchObject({ startIndex: 4, endExclusive: 8 });
    expect(r.best.cost).toBeCloseTo(1, 6); // (4×1)×0.25
    expect(r.worst).toMatchObject({ startIndex: 0 });
    expect(r.worst.cost).toBeCloseTo(10, 6);
    expect(r.savings).toBeCloseTo(9, 6);
  });

  it('returns an UNCLAMPED end index when the window abuts the data end', () => {
    // Cheapest window is the last 4 slots → endExclusive must be 12 (== length), so
    // the view resolves the true end instant, not a 15-min-early clamped last slot.
    const slots = quarterSlots([10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1]);
    const r = findOptimalWindow(slots, 1, 1, null)!;
    expect(r.best.startIndex).toBe(8);
    expect(r.best.endExclusive).toBe(12);
  });

  it('constrains the search to before the deadline', () => {
    const slots = quarterSlots([1, 1, 1, 1, 5, 5, 5, 5, 9, 9, 9, 9]);
    // deadline 01:00 → endExclusive = slot index 4, only one 1h window fits ([0,4)).
    const r = findOptimalWindow(slots, 1, 1, 60)!;
    expect(r.best).toMatchObject({ startIndex: 0, endExclusive: 4 });
    expect(r.worst).toMatchObject({ startIndex: 0, endExclusive: 4 });
  });

  it('returns null when fewer slots than the requested duration', () => {
    expect(findOptimalWindow(quarterSlots([1, 1]), 1, 1, null)).toBeNull();
  });
});
