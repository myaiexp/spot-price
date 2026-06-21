// Unit tests for helsinkiWeekStart: the Monday-of-the-Helsinki-week key used to
// invalidate the heatmap cache on week rollover (audit #17). The ISO weekday of
// a bare calendar date is timezone-independent, so these assertions are pure
// date arithmetic. Reference: 2026-01-01 is a Thursday.
import { describe, it, expect } from 'vitest';
import { helsinkiWeekStart } from './helsinki-time.js';

describe('helsinkiWeekStart', () => {
  it('a Monday maps to itself', () => {
    expect(helsinkiWeekStart('2026-01-12')).toBe('2026-01-12');
  });

  it('a midweek day (Thu 2026-01-15) maps back to that week Monday', () => {
    expect(helsinkiWeekStart('2026-01-15')).toBe('2026-01-12');
  });

  it('a Sunday maps back to the same week Monday (6 days earlier)', () => {
    // 2026-01-11 is a Sunday; its ISO week started Mon 2026-01-05.
    expect(helsinkiWeekStart('2026-01-11')).toBe('2026-01-05');
  });

  it('crosses the year boundary: 2026-01-01 (Thu) -> Mon 2025-12-29', () => {
    expect(helsinkiWeekStart('2026-01-01')).toBe('2025-12-29');
  });

  it('two days in the same Mon-Sun week share one key', () => {
    const monday = helsinkiWeekStart('2026-06-15'); // Monday
    expect(helsinkiWeekStart('2026-06-21')).toBe(monday); // following Sunday
    expect(helsinkiWeekStart('2026-06-22')).not.toBe(monday); // next Monday rolls over
  });
});
