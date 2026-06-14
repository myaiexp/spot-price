// Direct unit tests for isValidCalendarDate (audit #3971). The function was only
// exercised indirectly through GET /range; these pin its behaviour at the unit
// level so a regression surfaces here regardless of any route wiring.
//
// Contract: callers pass a string already known to match the YYYY-MM-DD shape
// (the /range route checks that with a regex first). isValidCalendarDate's job is
// to reject well-formed-but-impossible dates that JS would otherwise silently
// normalise (Feb 30 -> Mar 2) — it does NOT enforce zero-padding, so '2026-1-1'
// is accepted (the regex, not this function, guards format). The malformed cases
// below pin its defensive behaviour: off-contract garbage returns false, never
// throws.
import { describe, it, expect } from 'vitest';
import { isValidCalendarDate } from './helsinki-time.js';

describe('isValidCalendarDate — real calendar dates (audit #3971)', () => {
  const valid: Array<[string, string]> = [
    ['2026-06-14', 'ordinary date'],
    ['2024-02-29', 'Feb 29 on a leap year'],
    ['2026-01-01', 'year start'],
    ['2026-12-31', 'year end'],
    ['2026-04-30', 'last day of a 30-day month'],
  ];
  for (const [date, why] of valid) {
    it(`accepts ${date} — ${why}`, () => {
      expect(isValidCalendarDate(date)).toBe(true);
    });
  }
});

describe('isValidCalendarDate — impossible dates (audit #3971)', () => {
  const impossible: Array<[string, string]> = [
    ['2026-02-30', 'Feb 30 — JS normalises to Mar 2'],
    ['2025-02-29', 'Feb 29 on a non-leap year'],
    ['2026-04-31', 'Apr 31 — April has 30 days'],
    ['2026-13-01', 'month 13'],
    ['2026-00-01', 'month 00'],
    ['2026-01-00', 'day 00'],
  ];
  for (const [date, why] of impossible) {
    it(`rejects ${date} — ${why}`, () => {
      expect(isValidCalendarDate(date)).toBe(false);
    });
  }
});

describe('isValidCalendarDate — malformed input is rejected, not thrown (audit #3971)', () => {
  // Off-contract: the route's format regex would reject these before they ever
  // reach the function, but it must still degrade to `false` without throwing.
  const malformed: Array<[string, string]> = [
    ['not-a-date', 'non-numeric components -> NaN'],
    ['abcd-ef-gh', 'all-alpha components -> NaN'],
    ['', 'empty string'],
  ];
  for (const [input, why] of malformed) {
    it(`returns false for ${JSON.stringify(input)} — ${why}`, () => {
      expect(isValidCalendarDate(input)).toBe(false);
    });
  }
});
