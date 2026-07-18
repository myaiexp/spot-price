// Pure slot/time helpers: Helsinki wall-clock extraction and datetime-derived
// slot indexing. Deriving indices from each slot's absolute datetime (never from
// fixed h*4 arithmetic) is what keeps the UI aligned on 23h/25h DST days.

export const SLOT_MS = 15 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

// Formatters pinned to Europe/Helsinki so output is deterministic regardless of
// the runtime's local timezone (correct for the app's Finnish users, and stable
// under vitest wherever it runs). hourCycle h23 keeps midnight as 00, not 24.
const HELSINKI_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Helsinki',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const HELSINKI_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Helsinki',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDate(input) {
  return input instanceof Date ? input : new Date(input);
}

// Helsinki hour (0–23) and minute (0–59) of an instant.
export function helsinkiHourMinute(input) {
  const parts = HELSINKI_HM.formatToParts(toDate(input));
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return { hour, minute };
}

// Minutes since Helsinki midnight (0–1439).
export function helsinkiMinutesOfDay(input) {
  const { hour, minute } = helsinkiHourMinute(input);
  return hour * 60 + minute;
}

// Helsinki calendar day key (YYYY-MM-DD) — used to tell "today" slots from
// "tomorrow" slots when a single array spans the Helsinki midnight boundary.
export function helsinkiDateKey(input) {
  return HELSINKI_YMD.format(toDate(input));
}

// Index of the slot whose [start, start+duration) window contains instantMs, or
// -1 if none. Works for 15-min slots and hourly buckets alike (pass the matching
// duration); matching by absolute instant disambiguates the DST fall-back hour.
export function findSlotContaining(slots, instantMs, slotDurationMs) {
  for (let i = 0; i < slots.length; i++) {
    const start = Date.parse(slots[i].datetime);
    if (instantMs >= start && instantMs < start + slotDurationMs) return i;
  }
  return -1;
}

// Absolute ms of a slot *boundary* by index. In range → the slot's start. Past
// the end → extrapolate uniform slot steps beyond the last slot, so a window
// that abuts the data end resolves to its true end instant (not a clamped
// last-slot start 15 min early).
export function slotBoundaryMs(slots, idx, slotDurationMs = SLOT_MS) {
  if (idx < slots.length) return Date.parse(slots[idx].datetime);
  const lastMs = Date.parse(slots[slots.length - 1].datetime);
  return lastMs + (idx - (slots.length - 1)) * slotDurationMs;
}
