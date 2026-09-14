// Display formatting: numeric cent conversion vs. cent *strings*, and Helsinki
// wall-clock labels derived from slot datetimes.

import { helsinkiHourMinute, slotBoundaryMs, toDate } from './slot-time.js';

// Numeric EUR→cents (c/kWh) — a real number for arithmetic/charting. Kept
// distinct from formatCents so no call site round-trips through a string.
export function eurToCents(eur) {
  return eur * 100;
}

// EUR→cents as a fixed-2 display string.
export function formatCents(eur) {
  return (eur * 100).toFixed(2);
}

const HELSINKI_TIME = new Intl.DateTimeFormat('fi-FI', {
  timeZone: 'Europe/Helsinki',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Helsinki HH.MM for an instant (ISO string, Date, or epoch ms). fi-FI prose
// form (dot separator) for copy like the hero's "klo 14.30" stale note — window
// spans and chart axes use the colon helpers below, not this.
export function formatTime(input) {
  return HELSINKI_TIME.format(toDate(input));
}

function hhmm(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Helsinki HH:MM label for a slot's own datetime (colon form, for the chart's
// 15-min axis) — DST-correct because it reads the slot's real wall-clock time.
export function slotLabel(datetime) {
  const { hour, minute } = helsinkiHourMinute(datetime);
  return hhmm(hour, minute);
}

// Helsinki HH:00 label for an hourly bucket's datetime.
export function hourLabel(datetime) {
  const { hour } = helsinkiHourMinute(datetime);
  return hhmm(hour, 0);
}

// Helsinki HH:MM for a slot *boundary* by index, extrapolating past the data end
// (so an exclusive end index at the array boundary shows the true end time).
export function slotBoundaryLabel(slots, idx) {
  const { hour, minute } = helsinkiHourMinute(slotBoundaryMs(slots, idx));
  return hhmm(hour, minute);
}

// Start–endExclusive window as a colon-form span. Both insight cards and the
// estimator result cards go through this so they cannot drift in separator or
// exclusive-end handling.
export function slotSpanLabel(slots, startIndex, endExclusive) {
  return `${slotBoundaryLabel(slots, startIndex)}–${slotBoundaryLabel(slots, endExclusive)}`;
}
