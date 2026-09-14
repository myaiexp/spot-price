// Tests for emaAggregate (../../frontend/js/calc.js): hourly EMA buckets keyed
// by absolute hour — 23/25 buckets on DST days, and an interior gap (a missing
// :00 slot) still starts its own hour instead of merging into the previous one.

import { describe, it, expect } from 'vitest';
import { emaAggregate } from '../../frontend/js/calc.js';
import { stepSlots } from './test-support/rows.js';

// Index-as-price stepping — DST-day arrays key on sequence position.
const indexSlots = (startUtcIso: string, count: number) =>
  stepSlots(startUtcIso, Array.from({ length: count }, (_, i) => i));

// Reference EMA (α 0.3, seeded by the first value) a bucket must equal.
function ema(values: number[], alpha = 0.3): number {
  return values.slice(1).reduce((acc, v) => alpha * v + (1 - alpha) * acc, values[0]);
}

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

describe('emaAggregate DST hour bucketing', () => {
  it('produces 24 hourly buckets on a normal day', () => {
    const day = indexSlots('2026-07-17T21:00:00Z', 96); // Helsinki 2026-07-18 00:00..
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(24);
    // First bucket is the EMA of its 4 quarter-slots (prices 0,1,2,3).
    expect(hourly[0].priceWithTax).toBeCloseTo(ema([0, 1, 2, 3]), 6);
    const hours = hourly.map((h) => helsinkiHour(h.datetime));
    expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('produces 23 buckets on the spring-forward day (skips hour 3)', () => {
    const day = indexSlots('2026-03-28T22:00:00Z', 92); // Helsinki 2026-03-29, 23h
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(23);
    expect(hourly.map((h) => helsinkiHour(h.datetime))).not.toContain(3);
  });

  it('produces 25 buckets on the fall-back day (hour 3 twice)', () => {
    const day = indexSlots('2026-10-24T21:00:00Z', 100); // Helsinki 2026-10-25, 25h
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(25);
    const threes = hourly.filter((h) => helsinkiHour(h.datetime) === 3);
    expect(threes.map((h) => h.datetime)).toEqual([
      '2026-10-25T00:00:00.000Z', // 03:00 EEST
      '2026-10-25T01:00:00.000Z', // 03:00 EET
    ]);
  });
});

describe('emaAggregate interior gaps (finding #9929)', () => {
  // Helsinki 2026-07-18 (EEST +3) 09:00–09:45, 10:15–10:45, 11:00: the 10:00
  // slot is missing (a collection gap), so index 4 of the stepped run is dropped.
  const MISSING_TEN = stepSlots('2026-07-18T06:00:00Z', [1, 2, 3, 4, 99, 10, 20, 30, 5]).filter(
    (_, i) => i !== 4,
  );

  it('starts a new bucket at the hour change when its :00 slot is missing', () => {
    const hourly = emaAggregate(MISSING_TEN);
    expect(hourly.map((h) => helsinkiHour(h.datetime))).toEqual([9, 10, 11]);
    expect(hourly[0].priceWithTax).toBeCloseTo(ema([1, 2, 3, 4]), 9);
    expect(hourly[1].priceWithTax).toBeCloseTo(ema([10, 20, 30]), 9);
    expect(hourly[1].priceNoTax).toBeCloseTo(ema([10, 20, 30]), 9);
    expect(hourly[2].priceWithTax).toBe(5);
  });

  it('dates each bucket at its hour start, not at its first slot', () => {
    // The chart's hourly "Nyt" marker matches [datetime, datetime + 1h); a
    // 10:15 start would put 11:00–11:15 in the 10:xx bucket.
    expect(emaAggregate(MISSING_TEN).map((h) => h.datetime)).toEqual([
      '2026-07-18T06:00:00.000Z',
      '2026-07-18T07:00:00.000Z',
      '2026-07-18T08:00:00.000Z',
    ]);
  });

  it('dates a series that starts mid-hour at that hour', () => {
    const hourly = emaAggregate(stepSlots('2026-07-18T06:30:00Z', [1, 2, 3]));
    expect(hourly.map((h) => h.datetime)).toEqual([
      '2026-07-18T06:00:00.000Z',
      '2026-07-18T07:00:00.000Z',
    ]);
    expect(hourly[0].priceWithTax).toBeCloseTo(ema([1, 2]), 9);
  });

  it('keeps the two fall-back 03:xx hours apart when the second 03:00 is missing', () => {
    // 2026-10-25: index 12 = 03:00 EEST (00:00Z), index 16 = 03:00 EET (01:00Z).
    const day = indexSlots('2026-10-24T21:00:00Z', 100).filter((_, i) => i !== 16);
    const hourly = emaAggregate(day);
    expect(hourly).toHaveLength(25);
    const threes = hourly.filter((h) => helsinkiHour(h.datetime) === 3);
    expect(threes.map((h) => h.datetime)).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T01:00:00.000Z',
    ]);
    expect(threes[0].priceWithTax).toBeCloseTo(ema([12, 13, 14, 15]), 9);
    expect(threes[1].priceWithTax).toBeCloseTo(ema([17, 18, 19]), 9);
  });

  it('gives pure-hourly backfill one bucket per point', () => {
    const hourlyPoints = [0, 1, 2].map((h) => ({
      datetime: new Date(Date.parse('2026-07-17T21:00:00Z') + h * 3_600_000).toISOString(),
      priceNoTax: h * 10,
      priceWithTax: h * 10,
    }));
    expect(emaAggregate(hourlyPoints)).toEqual(hourlyPoints);
  });
});
