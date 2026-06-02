// Europe/Helsinki timezone date helpers (DST-aware UTC conversion)

/**
 * Returns the current date as YYYY-MM-DD in Europe/Helsinki timezone.
 */
export function getHelsinkiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
}

/**
 * Given a YYYY-MM-DD string, returns UTC Date objects representing
 * midnight-to-midnight in Helsinki time.
 */
export function getHelsinkiDateRange(dateStr: string): { start: Date; end: Date } {
  // Find what UTC time corresponds to midnight Helsinki on dateStr.
  // Helsinki is UTC+2 (EET) or UTC+3 (EEST).
  // We try +02:00 first and verify by formatting back — if the date doesn't match,
  // it must be summer time (+03:00).

  // Try +02:00 first (winter time = EET)
  const tryWinter = new Date(`${dateStr}T00:00:00+02:00`);
  const tryWinterFormatted = tryWinter.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  let start: Date;
  if (tryWinterFormatted === dateStr) {
    // +02:00 is correct for this date
    start = tryWinter;
  } else {
    // Must be summer time (+03:00 = EEST)
    start = new Date(`${dateStr}T00:00:00+03:00`);
  }

  // Same logic for the next day
  const nextDate = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = nextDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  // The end might cross a DST boundary, so recalculate
  const tryNextWinter = new Date(`${nextDateStr}T00:00:00+02:00`);
  const tryNextWinterFormatted = tryNextWinter.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  let end: Date;
  if (tryNextWinterFormatted === nextDateStr) {
    end = tryNextWinter;
  } else {
    end = new Date(`${nextDateStr}T00:00:00+03:00`);
  }

  return { start, end };
}

/**
 * Shift a YYYY-MM-DD string by a number of days.
 */
export function shiftDate(dateStr: string, days: number): string {
  const { start } = getHelsinkiDateRange(dateStr);
  const shifted = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return shifted.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
}
