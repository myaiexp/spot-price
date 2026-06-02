// Europe/Helsinki timezone date helpers (DST-aware UTC conversion)

/**
 * Returns the current date as YYYY-MM-DD in Europe/Helsinki timezone.
 */
export function getHelsinkiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
}

/**
 * True if `dateStr` (already known to match the YYYY-MM-DD shape) names a real
 * calendar date. A plain format regex still accepts impossible dates like
 * 2026-02-30, 2026-13-01 or 2026-00-01; JS then either silently normalises them
 * (Feb 30 → Mar 2) or yields an invalid Date. Reconstruct the date in UTC and
 * confirm every field survives the round-trip, so normalised inputs are caught.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * UTC instant at which Helsinki's wall clock reads 00:00 on `dateStr`.
 *
 * Helsinki is +03:00 (EEST, summer) or +02:00 (EET, winter). Try EEST first:
 * in summer it lands on local 00:00 (its Helsinki date equals dateStr); in
 * winter the same +03:00 instant is 23:00 the PREVIOUS day, so its Helsinki
 * date differs from dateStr and we fall through to EET. Local midnight always
 * exists and is unambiguous (DST shifts happen at 03:00/04:00, never at
 * midnight), so this single locale-date round-trip picks the right offset on
 * every day — including the 23h spring-forward and 25h fall-back days.
 */
function helsinkiMidnightUTC(dateStr: string): Date {
  const summer = new Date(`${dateStr}T00:00:00+03:00`);
  if (summer.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' }) === dateStr) {
    return summer;
  }
  return new Date(`${dateStr}T00:00:00+02:00`);
}

/**
 * Given a YYYY-MM-DD string, returns UTC Date objects representing
 * midnight-to-midnight in Helsinki time. The span is 23h on the spring-forward
 * day and 25h on the fall-back day.
 */
export function getHelsinkiDateRange(dateStr: string): { start: Date; end: Date } {
  return {
    start: helsinkiMidnightUTC(dateStr),
    end: helsinkiMidnightUTC(shiftDate(dateStr, 1)),
  };
}

/**
 * Shift a YYYY-MM-DD string by a number of whole calendar days.
 *
 * Calendar-day arithmetic is DST-immune: parse the bare date as UTC midnight
 * and step the day field. Adding `days * 86_400_000` ms to a Helsinki-midnight
 * instant instead drifts an hour across the 23h (spring-forward) and 25h
 * (fall-back) days, landing on the wrong calendar date near those boundaries.
 */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
