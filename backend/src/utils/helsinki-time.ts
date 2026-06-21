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
 * Minutes-since-midnight of an instant on Helsinki's wall clock (0..1439).
 *
 * An explicit, deterministic timezone-aware key for "same time-of-day in
 * Helsinki" comparisons — preferred over comparing formatted HH:MM strings,
 * which carry locale fragility (e.g. `hour12:false` rendering midnight as
 * "24:00" on some ICU builds) and are stringly-typed. Reads the hour/minute
 * parts in Europe/Helsinki and normalises a "24" hour to 0 so midnight is 0.
 *
 * NOTE: this is wall-clock-of-day, so on the fall-back day two distinct instants
 * (EEST then EET) share a key — callers matching on it resolve such ties
 * themselves (e.g. first-match = earliest instant).
 */
export function helsinkiMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return hour * 60 + minute;
}

/**
 * Stable key for the Helsinki ISO week containing `today`: the YYYY-MM-DD of
 * that week's Monday. Changes exactly at the Mon 00:00 week boundary, matching
 * Postgres `date_trunc('week', …)` (also Monday-start). The ISO weekday of a
 * bare calendar date is timezone-independent, so no tz math is needed beyond the
 * Helsinki "today". Used to invalidate the heatmap cache on week rollover rather
 * than serving last week's grid until the TTL expires.
 */
export function helsinkiWeekStart(today: string = getHelsinkiToday()): string {
  // getUTCDay: 0=Sun..6=Sat → ISO weekday 1=Mon..7=Sun.
  const isoWeekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return shiftDate(today, -(isoWeekday - 1));
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
