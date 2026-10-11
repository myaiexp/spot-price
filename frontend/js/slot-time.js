// Pure slot/time helpers: Helsinki wall-clock ↔ epoch and datetime-derived
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

// Coerce ISO string / epoch ms / Date to a Date (passthrough if already one).
export function toDate(input) {
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

// Shift a YYYY-MM-DD key by whole calendar days. UTC date math, so stepping
// across a 23h or 25h Helsinki day cannot land on the wrong date.
export function addCalendarDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Epoch ms when Helsinki's wall clock reads `minutes` since midnight on
// `dateStr`. A civil time that exists twice (fall-back 03:00–03:59) is the
// earlier instant. One that does not exist (spring-forward 03:00–03:59) is
// the transition instant — the first moment whose wall clock is at or after
// that minute. Anything else (not a clock time) throws.
export function helsinkiWallClockMs(dateStr, minutes) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const stamp = `${dateStr}T${hh}:${mm}:00`;
  let earliest = Infinity;
  for (const offset of [2, 3]) {
    const ms = Date.parse(`${stamp}+0${offset}:00`);
    if (!Number.isFinite(ms)) continue;
    if (helsinkiDateKey(ms) !== dateStr || helsinkiMinutesOfDay(ms) !== minutes) continue;
    if (ms < earliest) earliest = ms;
  }
  if (earliest !== Infinity) return earliest;

  // Spring-forward skips 03:00–03:59, and that is the only real HH:MM that
  // fails the round-trip above. Every skipped minute's first real instant is
  // the transition itself: 04:00 EEST.
  if (minutes >= 3 * 60 && minutes < 4 * 60) {
    return Date.parse(`${dateStr}T04:00:00+03:00`);
  }
  throw new Error(`no Helsinki instant for ${dateStr} minute ${minutes}`);
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

// Instant an exclusive window ends. On a dense grid this is the next slot's
// start, same as slotBoundaryMs. Across a missing slot — or past the array —
// it is one quarter-hour after the last included slot. That slot's price stops
// then, not at the far side of the hole (finding #12151).
export function exclusiveEndMs(slots, endExclusive, slotDurationMs = SLOT_MS) {
  if (endExclusive > 0 && endExclusive <= slots.length) {
    const prevEnd = Date.parse(slots[endExclusive - 1].datetime) + slotDurationMs;
    if (endExclusive === slots.length) return prevEnd;
    const nextStart = Date.parse(slots[endExclusive].datetime);
    return nextStart - prevEnd === 0 ? nextStart : prevEnd;
  }
  return slotBoundaryMs(slots, endExclusive, slotDurationMs);
}

// A day payload's slots array, or [] when the payload (or its slots) is missing
// — a 404'd tomorrow or a failed yesterday arrives as null. The one place the
// `{ slots }` day shape is read; every caller goes through this or hasSlots.
export function slotsOf(day) {
  return day?.slots ?? [];
}

// Whether a day payload has at least one slot (null / missing / empty → false).
export function hasSlots(day) {
  return slotsOf(day).length > 0;
}
