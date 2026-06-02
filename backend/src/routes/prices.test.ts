// Unit tests for getHelsinkiDateRange DST boundary handling (audit #1609)
import { describe, it, expect } from 'vitest';
import { getHelsinkiDateRange } from '../utils/helsinki-time.js';

/**
 * These tests pin the CURRENT behaviour of getHelsinkiDateRange and document,
 * for every endpoint, the hand-computed CORRECT UTC midnight in Europe/Helsinki.
 *
 * KNOWN BUG (audit #1609): the `+03:00` fallback branch is dead code. Probing
 * `${dateStr}T00:00:00+02:00` and formatting it back always yields dateStr,
 * because Helsinki's offset is never below +2h — so the `=== dateStr` guard is
 * always true and the function ALWAYS selects +02:00. Consequences:
 *   - every EEST (summer) date is one hour too late on BOTH endpoints;
 *   - the spring-forward day (really 23h) and fall-back day (really 25h) each
 *     come out as a 24h span.
 * Endpoints the heuristic happens to land correctly (winter, the spring-forward
 * start, the fall-back end) are asserted against the TRUE correct value.
 * Endpoints it gets wrong are pinned to the actual (buggy) output with the
 * correct value noted inline, so fixing the SUT later is a deliberate, reviewed
 * change that trips exactly these assertions.
 *
 * DST reference (EU rules, 2026): summer time starts Sun 2026-03-29 01:00 UTC
 * (local 03:00→04:00) and ends Sun 2026-10-25 01:00 UTC (local 04:00→03:00).
 */
const HOUR = 3_600_000;

describe('getHelsinkiDateRange', () => {
  it('winter date 2026-01-15 (EET, UTC+2): both endpoints correct', () => {
    const { start, end } = getHelsinkiDateRange('2026-01-15');
    // CORRECT: 2026-01-15 00:00 EET = 2026-01-14T22:00:00Z
    expect(start.getTime()).toBe(1_768_428_000_000);
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    // CORRECT: 2026-01-16 00:00 EET = 2026-01-15T22:00:00Z
    expect(end.getTime()).toBe(1_768_514_400_000);
    expect(end.toISOString()).toBe('2026-01-15T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR); // correct: 24h
  });

  it('summer date 2026-07-15 (EEST, UTC+3): BUG #1609 — both endpoints 1h late', () => {
    const { start, end } = getHelsinkiDateRange('2026-07-15');
    // CORRECT start = 2026-07-14T21:00:00Z (1_784_062_800_000); SUT is 1h late.
    expect(start.getTime()).toBe(1_784_066_400_000);
    expect(start.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    // CORRECT end   = 2026-07-15T21:00:00Z (1_784_149_200_000); SUT is 1h late.
    expect(end.getTime()).toBe(1_784_152_800_000);
    expect(end.toISOString()).toBe('2026-07-15T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR); // window shifted +1h
  });

  it('spring-forward day 2026-03-29 (23h day): start correct, BUG #1609 end 1h late', () => {
    const { start, end } = getHelsinkiDateRange('2026-03-29');
    // CORRECT: 2026-03-29 00:00 is still EET = 2026-03-28T22:00:00Z — heuristic OK.
    expect(start.getTime()).toBe(1_774_735_200_000);
    expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    // CORRECT end = 2026-03-30 00:00 EEST = 2026-03-29T21:00:00Z (1_774_818_000_000);
    // SUT returns 22:00:00Z — 1h late.
    expect(end.getTime()).toBe(1_774_821_600_000);
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // CORRECT span for this transition day is 23h; the bug yields 24h.
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it('fall-back day 2026-10-25 (25h day): BUG #1609 start 1h late, end correct', () => {
    const { start, end } = getHelsinkiDateRange('2026-10-25');
    // CORRECT start = 2026-10-25 00:00 EEST = 2026-10-24T21:00:00Z (1_792_875_600_000);
    // SUT returns 22:00:00Z — 1h late.
    expect(start.getTime()).toBe(1_792_879_200_000);
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    // CORRECT: 2026-10-26 00:00 is EET = 2026-10-25T22:00:00Z — heuristic OK.
    expect(end.getTime()).toBe(1_792_965_600_000);
    expect(end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
    // CORRECT span for this transition day is 25h; the bug yields 24h.
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });
});
