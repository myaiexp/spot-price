// Unit tests for Helsinki DST date handling: getHelsinkiDateRange (#1609) +
// shiftDate DST-immunity (#3123).
import { describe, it, expect } from 'vitest';
import { getHelsinkiDateRange, shiftDate } from '../utils/helsinki-time.js';

/**
 * These tests pin the CORRECT Europe/Helsinki midnight-to-midnight UTC window
 * for every category of day. getHelsinkiDateRange now selects the right offset
 * (EEST +03:00 / EET +02:00) by a single locale-date round-trip, so summer days
 * start at true local midnight and the transition days span 23h / 25h.
 *
 * History: audit #1609 shipped these tests pinning the THEN-buggy output (the
 * dead +03:00 branch meant the function always used +02:00, putting every
 * summer endpoint 1h late and flattening both transition days to 24h). Audit
 * #3123 fixed the offset selection (folding in the #1605 dead-code finding) and
 * the assertions below were flipped to the true values noted inline back then.
 *
 * DST reference (EU rules, 2026): summer time starts Sun 2026-03-29 01:00 UTC
 * (local 03:00→04:00) and ends Sun 2026-10-25 01:00 UTC (local 04:00→03:00).
 */
const HOUR = 3_600_000;

describe('getHelsinkiDateRange', () => {
  it('winter date 2026-01-15 (EET, UTC+2): both endpoints correct', () => {
    const { start, end } = getHelsinkiDateRange('2026-01-15');
    // 2026-01-15 00:00 EET = 2026-01-14T22:00:00Z
    expect(start.getTime()).toBe(1_768_428_000_000);
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    // 2026-01-16 00:00 EET = 2026-01-15T22:00:00Z
    expect(end.getTime()).toBe(1_768_514_400_000);
    expect(end.toISOString()).toBe('2026-01-15T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it('summer date 2026-07-15 (EEST, UTC+3): both endpoints at true local midnight', () => {
    const { start, end } = getHelsinkiDateRange('2026-07-15');
    // 2026-07-15 00:00 EEST = 2026-07-14T21:00:00Z
    expect(start.getTime()).toBe(1_784_062_800_000);
    expect(start.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    // 2026-07-16 00:00 EEST = 2026-07-15T21:00:00Z
    expect(end.getTime()).toBe(1_784_149_200_000);
    expect(end.toISOString()).toBe('2026-07-15T21:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it('spring-forward day 2026-03-29 spans 23h (EET start, EEST end)', () => {
    const { start, end } = getHelsinkiDateRange('2026-03-29');
    // 2026-03-29 00:00 is still EET = 2026-03-28T22:00:00Z
    expect(start.getTime()).toBe(1_774_735_200_000);
    expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    // 2026-03-30 00:00 is EEST = 2026-03-29T21:00:00Z
    expect(end.getTime()).toBe(1_774_818_000_000);
    expect(end.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    // The clock loses an hour at 03:00 local, so the day is 23h long.
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  it('fall-back day 2026-10-25 spans 25h (EEST start, EET end)', () => {
    const { start, end } = getHelsinkiDateRange('2026-10-25');
    // 2026-10-25 00:00 is EEST = 2026-10-24T21:00:00Z
    expect(start.getTime()).toBe(1_792_875_600_000);
    expect(start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    // 2026-10-26 00:00 is EET = 2026-10-25T22:00:00Z
    expect(end.getTime()).toBe(1_792_965_600_000);
    expect(end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
    // The clock repeats an hour at 04:00 local, so the day is 25h long.
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });
});

/**
 * shiftDate must step whole calendar days regardless of DST. The previous
 * raw-millisecond form (Helsinki-midnight instant + days * 86_400_000) drifted
 * an hour across the 23h spring-forward and 25h fall-back days and landed on the
 * wrong calendar date — masked until #1609's offset bug (which over-counted the
 * opposite hour) was fixed. These cases pin the DST-immune behaviour.
 */
describe('shiftDate across DST boundaries (audit #3123)', () => {
  // --- Spring-forward (2026-03-29, 23h day) ---
  it('+1 up to the spring-forward day: 2026-03-28 -> 2026-03-29', () => {
    expect(shiftDate('2026-03-28', 1)).toBe('2026-03-29');
  });
  it('+1 out of the spring-forward day: 2026-03-29 -> 2026-03-30', () => {
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30');
  });
  it('-1 back across spring-forward: 2026-03-30 -> 2026-03-29 (raw-ms undershot to 03-28)', () => {
    expect(shiftDate('2026-03-30', -1)).toBe('2026-03-29');
  });
  it('-1 into the spring-forward day: 2026-03-29 -> 2026-03-28', () => {
    expect(shiftDate('2026-03-29', -1)).toBe('2026-03-28');
  });

  // --- Fall-back (2026-10-25, 25h day) ---
  it('+1 out of the fall-back day: 2026-10-25 -> 2026-10-26 (raw-ms stalled on 10-25)', () => {
    expect(shiftDate('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('+1 up to the fall-back day: 2026-10-24 -> 2026-10-25', () => {
    expect(shiftDate('2026-10-24', 1)).toBe('2026-10-25');
  });
  it('-1 back across fall-back: 2026-10-26 -> 2026-10-25', () => {
    expect(shiftDate('2026-10-26', -1)).toBe('2026-10-25');
  });
  it('-1 into the fall-back day: 2026-10-25 -> 2026-10-24', () => {
    expect(shiftDate('2026-10-25', -1)).toBe('2026-10-24');
  });

  // --- No-op controls: ordinary 24h days, no DST in the window ---
  it('winter control 2026-01-15: +/-1 are plain calendar steps', () => {
    expect(shiftDate('2026-01-15', 1)).toBe('2026-01-16');
    expect(shiftDate('2026-01-15', -1)).toBe('2026-01-14');
  });
  it('summer control 2026-07-15: +/-1 are plain calendar steps', () => {
    expect(shiftDate('2026-07-15', 1)).toBe('2026-07-16');
    expect(shiftDate('2026-07-15', -1)).toBe('2026-07-14');
  });
});

/**
 * GET /now derives yesterday as shiftDate(today, -1) and matches the
 * same-time-of-day slot from that day. Across a DST boundary the raw-ms form
 * fetched the wrong day (so the yesterday comparison silently vanished). These
 * pin the corrected yesterday lookups that the /now handler depends on.
 */
describe('/now yesterday-slot date lookup (audit #3123)', () => {
  it('today = day after fall-back (2026-10-26) -> yesterday is the 25h day 2026-10-25', () => {
    expect(shiftDate('2026-10-26', -1)).toBe('2026-10-25');
  });
  it('today = day after spring-forward (2026-03-30) -> yesterday is the 23h day 2026-03-29', () => {
    expect(shiftDate('2026-03-30', -1)).toBe('2026-03-29');
  });
});
