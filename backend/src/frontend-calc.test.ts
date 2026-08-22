// Tests for the frontend's pure price algorithms (../../frontend/js/calc.js):
// window sums, cheapest block, next-cheap window, peak-block gap bridging,
// DST-aware EMA hour bucketing (23h/25h days), and wall-clock ghost alignment.

import { describe, it, expect } from 'vitest';
import {
  windowSums,
  priceThreshold,
  findCheapestBlock,
  findNextCheapWindow,
  findPeakBlock,
  emaAggregate,
  alignSecondaryByWallClock,
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
  it('honours an exclusive endExclusive bound', () => {
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
    // endExclusive is one past the last included slot (audit #5565).
    expect(r).toEqual({ startIndex: 2, endExclusive: 4, avgPrice: 1 });
  });
  it('returns null when fewer slots than the block size', () => {
    expect(findCheapestBlock(fromPrices([5]), 2)).toBeNull();
  });
});

describe('findNextCheapWindow', () => {
  const slots = fromPrices([1, 1, 1, 5, 5, 5, 9, 9, 9]); // threshold (1/3) = 5

  it('reports being in a cheap window now and when it ends', () => {
    expect(findNextCheapWindow(slots, 4)).toEqual({ inCheapNow: true, endExclusive: 6 });
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
    expect(r).toMatchObject({ startIndex: 3, endExclusive: 9 }); // last slot 8, exclusive end 9
    expect(r!.avgPrice).toBeCloseTo((100 + 100 + 1 + 1 + 100 + 100) / 6, 5);
  });
  it('does NOT bridge a gap of 3 slots, keeping the earliest longest run', () => {
    // 100 at [2..5] and [12..15], gap 6..8..11 (>2) → separate; first wins on tie.
    const prices = [1, 1, 100, 100, 100, 100, 1, 1, 1, 1, 1, 1, 100, 100, 100, 100];
    const r = findPeakBlock(fromPrices(prices));
    expect(r).toMatchObject({ startIndex: 2, endExclusive: 6 });
  });
  it('returns null when no merged run reaches the 4-slot (1h) minimum', () => {
    expect(findPeakBlock(fromPrices([100, 100, 100]))).toBeNull();
  });
  it('reports endExclusive past the last slot when the peak abuts the data end', () => {
    const r = findPeakBlock(fromPrices([1, 1, 100, 100, 100, 100]));
    expect(r).toMatchObject({ startIndex: 2, endExclusive: 6 });
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

describe('alignSecondaryByWallClock (audit #6332)', () => {
  it('returns [] for empty secondary so the ghost series can be skipped', () => {
    const primary = stepSlots('2026-07-17T21:00:00Z', 4);
    expect(alignSecondaryByWallClock(primary, [])).toEqual([]);
    expect(alignSecondaryByWallClock(primary, null as unknown as [])).toEqual([]);
  });

  it('matches equal-length normal days by wall-clock (same as zip-by-index)', () => {
    // Helsinki 2026-07-18 vs 2026-07-17, both 96 slots starting at local midnight.
    const primary = stepSlots('2026-07-17T21:00:00Z', 96);
    const secondary = stepSlots('2026-07-16T21:00:00Z', 96).map((s, i) => ({
      ...s,
      priceWithTax: 1000 + i,
    }));
    const aligned = alignSecondaryByWallClock(primary, secondary);
    expect(aligned).toHaveLength(96);
    expect(aligned[0]).toBe(1000);
    expect(aligned[4]).toBe(1004);
    expect(aligned[95]).toBe(1095);
  });

  it('inserts nulls for spring-forward gap hours when primary is a normal day', () => {
    // Primary: normal 96-slot day (has 03:00–03:45). Secondary: spring-forward
    // 92 slots (skips 03:00–03:45). Zip-by-index would shift everything after 03:00.
    const primary = stepSlots('2026-07-17T21:00:00Z', 96); // 2026-07-18
    const secondary = stepSlots('2026-03-28T22:00:00Z', 92).map((s, i) => ({
      ...s,
      priceWithTax: i + 0.5,
    }));
    const aligned = alignSecondaryByWallClock(primary, secondary);
    expect(aligned).toHaveLength(96);

    // 03:00 is slot index 12 on a normal day (00:00 + 12*15min).
    for (let i = 12; i < 16; i++) {
      expect(aligned[i], `primary slot ${i} (03:xx) should be null`).toBeNull();
    }
    // 02:45 (index 11) and 04:00 (index 16) still line up by wall-clock.
    expect(aligned[11]).toBe(11.5);
    // On spring-forward secondary, the slot after 02:45 is 04:00 at index 12.
    expect(aligned[16]).toBe(12.5);
    // Last primary slot 23:45 maps to secondary's last slot (index 91).
    expect(aligned[95]).toBe(91.5);
  });

  it('drops secondary-only spring-forward mismatch when primary skips hour 3', () => {
    // Primary spring-forward (92); secondary normal (96). Extra secondary 03:xx
    // never appear on the axis; primary length is preserved.
    const primary = stepSlots('2026-03-28T22:00:00Z', 92);
    const secondary = stepSlots('2026-07-17T21:00:00Z', 96).map((s, i) => ({
      ...s,
      priceWithTax: i,
    }));
    const aligned = alignSecondaryByWallClock(primary, secondary);
    expect(aligned).toHaveLength(92);
    expect(aligned.every((v) => v != null)).toBe(true);
    // Primary 02:45 (index 11) → secondary 02:45 (11); primary 04:00 (12) → secondary 16.
    expect(aligned[11]).toBe(11);
    expect(aligned[12]).toBe(16);
  });

  it('aligns pure-hourly secondary onto a 15-min primary (nulls for non-:00 slots)', () => {
    // Backfill ghost: 24 hourly points vs 96 quarter-hour primary.
    const primary = stepSlots('2026-07-17T21:00:00Z', 96);
    const hourlySecondary = [];
    for (let h = 0; h < 24; h++) {
      hourlySecondary.push({
        datetime: new Date(Date.parse('2026-07-16T21:00:00Z') + h * 60 * 60 * 1000).toISOString(),
        priceWithTax: h * 10,
        priceNoTax: h * 10,
      });
    }
    const aligned = alignSecondaryByWallClock(primary, hourlySecondary);
    expect(aligned).toHaveLength(96);
    // Only :00 slots get a value; the other three quarters of each hour are null.
    for (let i = 0; i < 96; i++) {
      if (i % 4 === 0) expect(aligned[i]).toBe((i / 4) * 10);
      else expect(aligned[i]).toBeNull();
    }
  });

  it('aligns by hour bucket in hourly mode across 23 vs 24 buckets', () => {
    const primary = emaAggregate(stepSlots('2026-07-17T21:00:00Z', 96)); // 24
    const secondary = emaAggregate(stepSlots('2026-03-28T22:00:00Z', 92)).map((s, i) => ({
      ...s,
      priceWithTax: i + 1,
    })); // 23, no hour 3
    expect(primary).toHaveLength(24);
    expect(secondary).toHaveLength(23);

    const aligned = alignSecondaryByWallClock(primary, secondary, { hourly: true });
    expect(aligned).toHaveLength(24);
    // Hour 3 on primary has no secondary counterpart.
    expect(aligned[3]).toBeNull();
    // Hours 0–2 line up 1:1; hour 4 primary maps to secondary index 3 (skip hour 3).
    expect(aligned[0]).toBe(1);
    expect(aligned[2]).toBe(3);
    expect(aligned[4]).toBe(4);
    expect(aligned[23]).toBe(23);
  });

  it('consumes fall-back duplicate hour-3 buckets in order in hourly mode', () => {
    const primary = emaAggregate(stepSlots('2026-10-24T21:00:00Z', 100)); // 25, hour 3 ×2
    const secondary = emaAggregate(stepSlots('2026-10-24T21:00:00Z', 100)).map((s, i) => ({
      ...s,
      priceWithTax: 100 + i,
    }));
    expect(primary).toHaveLength(25);

    const aligned = alignSecondaryByWallClock(primary, secondary, { hourly: true });
    expect(aligned).toHaveLength(25);
    // Both hour-3 primary buckets get their own secondary values (indices 3 and 4).
    expect(aligned[3]).toBe(103);
    expect(aligned[4]).toBe(104);
    expect(aligned[5]).toBe(105); // hour 4
  });

  it('reuses the single secondary hour-3 when primary is fall-back and secondary is normal', () => {
    const primary = emaAggregate(stepSlots('2026-10-24T21:00:00Z', 100)); // 25
    const secondary = emaAggregate(stepSlots('2026-07-17T21:00:00Z', 96)).map((s, i) => ({
      ...s,
      priceWithTax: i,
    })); // 24
    const aligned = alignSecondaryByWallClock(primary, secondary, { hourly: true });
    expect(aligned).toHaveLength(25);
    // Primary has two hour-3 buckets; secondary has one → reuse last.
    expect(aligned[3]).toBe(3);
    expect(aligned[4]).toBe(3);
    expect(aligned[5]).toBe(4);
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
