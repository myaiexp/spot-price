// Tests for the frontend's pure slot/time helpers (../../frontend/js/slot-time.js):
// Helsinki wall-clock extraction and datetime-derived slot indexing, including the
// past-the-end boundary extrapolation that fixes the estimator's 15-min-early end.

import { describe, it, expect } from 'vitest';
import {
  SLOT_MS,
  toDate,
  helsinkiHourMinute,
  helsinkiMinutesOfDay,
  helsinkiDateKey,
  findSlotContaining,
  slotBoundaryMs,
} from '../../frontend/js/slot-time.js';
import { slot } from './test-support/rows.js';

describe('toDate', () => {
  it('passes a Date through', () => {
    const d = new Date('2026-07-18T11:30:00.000Z');
    expect(toDate(d)).toBe(d);
  });
  it('wraps an epoch ms number', () => {
    const ms = Date.parse('2026-07-18T11:30:00.000Z');
    expect(toDate(ms).getTime()).toBe(ms);
  });
  it('parses an ISO string', () => {
    expect(toDate('2026-07-18T11:30:00.000Z').toISOString()).toBe('2026-07-18T11:30:00.000Z');
  });
});

describe('helsinkiHourMinute', () => {
  it('applies the summer EEST (+3) offset', () => {
    expect(helsinkiHourMinute('2026-07-18T00:00:00Z')).toEqual({ hour: 3, minute: 0 });
  });
  it('applies the winter EET (+2) offset', () => {
    expect(helsinkiHourMinute('2026-01-15T00:30:00Z')).toEqual({ hour: 2, minute: 30 });
  });
  it('keeps midnight as hour 0, not 24', () => {
    // 21:00Z in summer is Helsinki 00:00 next day.
    expect(helsinkiHourMinute('2026-07-17T21:00:00Z')).toEqual({ hour: 0, minute: 0 });
  });
});

describe('helsinkiMinutesOfDay / helsinkiDateKey', () => {
  it('returns minutes since Helsinki midnight', () => {
    expect(helsinkiMinutesOfDay('2026-07-18T04:15:00Z')).toBe(7 * 60 + 15); // 07:15 EEST
  });
  it('rolls the calendar day at Helsinki midnight, not UTC midnight', () => {
    // 22:00Z summer is already 01:00 the next Helsinki day.
    expect(helsinkiDateKey('2026-07-17T22:00:00Z')).toBe('2026-07-18');
    expect(helsinkiDateKey('2026-07-17T20:00:00Z')).toBe('2026-07-17');
  });
});

describe('findSlotContaining', () => {
  const slots = [
    slot('2026-07-18T12:00:00Z'),
    slot('2026-07-18T12:15:00Z'),
    slot('2026-07-18T12:30:00Z'),
  ];
  it('finds the slot whose 15-min window contains the instant', () => {
    expect(findSlotContaining(slots, Date.parse('2026-07-18T12:20:00Z'), SLOT_MS)).toBe(1);
  });
  it('is inclusive of the slot start and exclusive of its end', () => {
    expect(findSlotContaining(slots, Date.parse('2026-07-18T12:30:00Z'), SLOT_MS)).toBe(2);
    expect(findSlotContaining(slots, Date.parse('2026-07-18T12:45:00Z'), SLOT_MS)).toBe(-1);
  });
  it('returns -1 before the first slot', () => {
    expect(findSlotContaining(slots, Date.parse('2026-07-18T11:59:00Z'), SLOT_MS)).toBe(-1);
  });
});

describe('slotBoundaryMs', () => {
  const t0 = Date.parse('2026-07-18T12:00:00Z');
  const slots = [
    slot('2026-07-18T12:00:00Z'),
    slot('2026-07-18T12:15:00Z'),
    slot('2026-07-18T12:30:00Z'),
  ];
  it('returns the slot start for an in-range index', () => {
    expect(slotBoundaryMs(slots, 0)).toBe(t0);
    expect(slotBoundaryMs(slots, 2)).toBe(t0 + 30 * 60 * 1000);
  });
  it('extrapolates one slot past the end (window abutting the data end)', () => {
    // The bug fix: end index === length must resolve to last-slot-start + 15 min,
    // not the clamped last-slot start.
    expect(slotBoundaryMs(slots, 3)).toBe(t0 + 45 * 60 * 1000);
    expect(slotBoundaryMs(slots, 4)).toBe(t0 + 60 * 60 * 1000);
  });
});
