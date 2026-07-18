// Display formatting: numeric cent conversion vs. cent *strings*, and Helsinki
// wall-clock labels derived from slot datetimes.

import { helsinkiHourMinute, slotBoundaryMs } from './slot-time.js';

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

// Helsinki HH.MM for an instant (ISO string, Date, or epoch ms).
export function formatTime(input) {
  const d = input instanceof Date || typeof input === 'number' ? input : new Date(input);
  return HELSINKI_TIME.format(d instanceof Date ? d : new Date(d));
}

// Helsinki HH:MM label for a slot's own datetime (colon form, for chart/insight
// axes) — DST-correct because it reads the slot's real wall-clock time.
export function slotLabel(datetime) {
  const { hour, minute } = helsinkiHourMinute(datetime);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Helsinki HH:00 label for an hourly bucket's datetime.
export function hourLabel(datetime) {
  const { hour } = helsinkiHourMinute(datetime);
  return `${String(hour).padStart(2, '0')}:00`;
}

// Helsinki HH:MM for a slot *boundary* by index, extrapolating past the data end
// (so an exclusive end index at the array boundary shows the true end time).
export function slotBoundaryLabel(slots, idx) {
  const { hour, minute } = helsinkiHourMinute(slotBoundaryMs(slots, idx));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
