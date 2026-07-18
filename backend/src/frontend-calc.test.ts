// Tests for the frontend's pure price algorithms (../../frontend/js/calc.js):
// window sums, cheapest block, next-cheap window, peak-block gap bridging, and
// DST-aware EMA hour bucketing (23h/25h days).

import { describe, it, expect } from 'vitest';
import {
  windowSums,
  priceThreshold,
  findCheapestBlock,
  findNextCheapWindow,
  findPeakBlock,
  emaAggregate,
} from '../../frontend/js/calc.js';

const fromPrices = (prices: number[]) =>
  prices.map((p, i) => ({ datetime: `2026-07-18T00:${i}`, priceWithTax: p, priceNoTax: p }));

// 15-min slots stepping from a UTC start — used to build real DST-day arrays.
function stepSlots(startUtcIso: string, count: number) {
  const start = Date.parse(startUtcIso);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      datetime: new Date(start + i * 15 * 60 * 1000).toISOString(),
      priceWithTax: i,
      priceNoTax: i,
    });
  }
  return slots;
}

describe('windowSums', () => {
  it('computes per-start sliding-window sums', () => {
    expect(windowSums(fromPrices([1, 2, 3, 4]), 2)).toEqual([3, 5, 7]);
  });
  it('honours an exclusive maxEnd bound', () => {
    expect(windowSums(fromPrices([1, 2, 3, 4]), 2, 3)).toEqual([3, 5]);
  });
  it('returns [] when the window does not fit', () => {
    expect(windowSums(fromPrices([1, 2]), 3)).toEqual([]);
  });
});

describe('priceThreshold', () => {
  it('returns the sorted value at the fractional index', () => {
    expect(priceThreshold(fromPrices([3, 1, 2]), 0.5)).toBe(2);
  });
});

describe('findCheapestBlock', () => {
  it('finds the minimum-sum block and its average', () => {
    const r = findCheapestBlock(fromPrices([5, 5, 1, 1, 5, 5]), 2);
    expect(r).toEqual({ startIndex: 2, endIndex: 3, avgPrice: 1 });
  });
  it('returns null when fewer slots than the block size', () => {
    expect(findCheapestBlock(fromPrices([5]), 2)).toBeNull();
  });
});

describe('findNextCheapWindow', () => {
  const slots = fromPrices([1, 1, 1, 5, 5, 5, 9, 9, 9]); // threshold (1/3) = 5

  it('reports being in a cheap window now and when it ends', () => {
    expect(findNextCheapWindow(slots, 4)).toEqual({ inCheapNow: true, endsAt: 6 });
  });
  it('finds the next cheap window ahead with minutes-away', () => {
    const r = findNextCheapWindow(fromPrices([9, 9, 1, 1]), 0); // threshold = 1
    expect(r).toEqual({ inCheapNow: false, startIndex: 2, startsIn: 30, price: 1 });
  });
  it('returns null when no cheap slot remains ahead', () => {
    expect(findNextCheapWindow(slots, 6)).toBeNull();
  });
  it('handles currentIndex = -1 (now before the first slot) without throwing', () => {
    const r = findNextCheapWindow(fromPrices([9, 1, 1]), -1); // threshold = 1
    expect(r).toMatchObject({ inCheapNow: false, startIndex: 1 });
  });
});

describe('findPeakBlock gap bridging', () => {
  it('bridges an above-threshold gap of ≤2 slots into one merged run', () => {
    // 10 slots, 100 at [3,4] and [7,8] (gap 5,6 = 2 slots) → merge [3,8].
    const prices = [1, 1, 1, 100, 100, 1, 1, 100, 100, 1];
    const r = findPeakBlock(fromPrices(prices));
    expect(r).toMatchObject({ startIndex: 3, endIndex: 8 });
    expect(r!.avgPrice).toBeCloseTo((100 + 100 + 1 + 1 + 100 + 100) / 6, 5);
  });
  it('does NOT bridge a gap of 3 slots, keeping the earliest longest run', () => {
    // 100 at [2..5] and [12..15], gap 6..8..11 (>2) → separate; first wins on tie.
    const prices = [1, 1, 100, 100, 100, 100, 1, 1, 1, 1, 1, 1, 100, 100, 100, 100];
    const r = findPeakBlock(fromPrices(prices));
    expect(r).toMatchObject({ startIndex: 2, endIndex: 5 });
  });
  it('returns null when no merged run reaches the 4-slot (1h) minimum', () => {
    expect(findPeakBlock(fromPrices([100, 100, 100]))).toBeNull();
  });
});

describe('emaAggregate DST hour bucketing', () => {
  it('produces 24 hourly buckets on a normal day', () => {
    const day = stepSlots('2026-07-17T21:00:00Z', 96); // Helsinki 2026-07-18 00:00..
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(24);
    // First bucket is the EMA of its 4 quarter-slots (prices 0,1,2,3).
    let ema = 0;
    for (let i = 1; i < 4; i++) ema = 0.3 * i + 0.7 * ema;
    expect(hourly[0].priceWithTax).toBeCloseTo(ema, 6);
    const hours = hourly.map((h) => helsinkiHour(h.datetime));
    expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('produces 23 buckets on the spring-forward day (skips hour 3)', () => {
    const day = stepSlots('2026-03-28T22:00:00Z', 92); // Helsinki 2026-03-29, 23h
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(23);
    expect(hourly.map((h) => helsinkiHour(h.datetime))).not.toContain(3);
  });

  it('produces 25 buckets on the fall-back day (hour 3 twice)', () => {
    const day = stepSlots('2026-10-24T21:00:00Z', 100); // Helsinki 2026-10-25, 25h
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(25);
    const threes = hourly.filter((h) => helsinkiHour(h.datetime) === 3);
    expect(threes).toHaveLength(2);
  });
});

// Local helper: Helsinki hour of an ISO instant (mirrors slot-time, kept here so
// the assertions don't depend on the module under a second name).
function helsinkiHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Helsinki',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
}
