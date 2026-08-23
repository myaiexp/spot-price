// Tests for the frontend's display formatting (../../frontend/js/format.js):
// numeric EUR→cents (chart axis), cent *strings*, Helsinki wall-clock labels
// (prose-style fi-FI dots vs colon form for axes and window spans).

import { describe, it, expect } from 'vitest';
import {
  eurToCents,
  formatCents,
  formatTime,
  slotLabel,
  hourLabel,
  slotBoundaryLabel,
  slotSpanLabel,
} from '../../frontend/js/format.js';
import { slot } from './test-support/rows.js';

// 14:30 EEST (UTC+3) — a mid-afternoon instant with a non-zero minute.
const ISO_1430 = '2026-07-18T11:30:00.000Z';
const MS_1430 = Date.parse(ISO_1430);

describe('eurToCents / formatCents', () => {
  it('converts EUR/kWh to a numeric cent value for the chart axis (finding #7615)', () => {
    expect(eurToCents(0)).toBe(0);
    expect(eurToCents(0.05)).toBe(5);
    expect(eurToCents(-0.12)).toBe(-12);
    expect(typeof eurToCents(0.05)).toBe('number');
  });

  it('keeps formatCents as a fixed-2 string, distinct from the numeric path', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(0.05)).toBe('5.00');
    expect(formatCents(-0.12)).toBe('-12.00');
  });
});

describe('formatTime (fi-FI prose, dot separator)', () => {
  it('formats an ISO string, Date, and epoch ms the same way', () => {
    expect(formatTime(ISO_1430)).toBe('14.30');
    expect(formatTime(new Date(ISO_1430))).toBe('14.30');
    expect(formatTime(MS_1430)).toBe('14.30');
  });
});

describe('slotLabel / hourLabel / slotBoundaryLabel (colon form)', () => {
  it('labels a slot with a colon separator', () => {
    expect(slotLabel(ISO_1430)).toBe('14:30');
  });
  it('labels an hourly bucket as HH:00', () => {
    expect(hourLabel(ISO_1430)).toBe('14:00');
  });
  it('labels an in-range slot boundary', () => {
    const slots = [slot(ISO_1430)];
    expect(slotBoundaryLabel(slots, 0)).toBe('14:30');
  });
  it('extrapolates the exclusive end past the last slot', () => {
    const slots = [slot(ISO_1430)];
    expect(slotBoundaryLabel(slots, 1)).toBe('14:45');
  });
});

describe('slotSpanLabel', () => {
  // 15-min slots 14:00–14:45 EEST; exclusive end at length → 15:00.
  const slots = [
    slot('2026-07-18T11:00:00.000Z'),
    slot('2026-07-18T11:15:00.000Z'),
    slot('2026-07-18T11:30:00.000Z'),
    slot('2026-07-18T11:45:00.000Z'),
  ];

  it('formats a startIndex–endExclusive window with the colon form', () => {
    expect(slotSpanLabel(slots, 0, 4)).toBe('14:00–15:00');
    expect(slotSpanLabel(slots, 1, 3)).toBe('14:15–14:45');
  });

  it('uses the same separator as slotBoundaryLabel so insight and estimator cards cannot drift', () => {
    const start = slotBoundaryLabel(slots, 0);
    const end = slotBoundaryLabel(slots, 4);
    expect(slotSpanLabel(slots, 0, 4)).toBe(`${start}–${end}`);
    expect(slotSpanLabel(slots, 0, 4)).not.toContain('.');
  });
});
