// Direct unit tests for getHelsinkiToday (audit #3970). The helper reads the
// real wall clock (`new Date()`), so a naive test would be DST-flaky and depend
// on when it happens to run. Pin the clock to fixed UTC instants with fake timers
// and assert the Helsinki calendar date — including evening instants where the
// Helsinki date has already rolled over to the next day while UTC is still on the
// previous one, which is exactly what distinguishes "Helsinki today" from "UTC
// today" and is the whole reason this helper exists.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getHelsinkiToday } from './helsinki-time.js';

afterEach(() => {
  vi.useRealTimers();
});

function helsinkiTodayAt(iso: string): string {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  return getHelsinkiToday();
}

describe('getHelsinkiToday (audit #3970)', () => {
  it('returns the Helsinki calendar date for a midday instant', () => {
    // 2026-03-10T09:00Z = 11:00 Helsinki (EET, +2) -> same calendar date.
    expect(helsinkiTodayAt('2026-03-10T09:00:00Z')).toBe('2026-03-10');
  });

  it('uses Helsinki time, not UTC, in winter (EET +2)', () => {
    // 22:30Z is already 00:30 the NEXT day in Helsinki, while UTC is still 01-15.
    expect(helsinkiTodayAt('2026-01-15T22:30:00Z')).toBe('2026-01-16');
  });

  it('uses Helsinki time, not UTC, in summer (EEST +3)', () => {
    // 21:30Z is already 00:30 the NEXT day in Helsinki (+3); UTC is still 06-14.
    expect(helsinkiTodayAt('2026-06-14T21:30:00Z')).toBe('2026-06-15');
  });

  it('emits a zero-padded YYYY-MM-DD string', () => {
    // en-CA locale gives the ISO-style ordering + zero-padding callers rely on:
    // single-digit month and day stay two digits.
    expect(helsinkiTodayAt('2026-01-05T09:00:00Z')).toBe('2026-01-05');
  });
});
