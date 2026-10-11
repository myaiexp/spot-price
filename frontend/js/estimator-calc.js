// Pure cost-estimator logic: slot assembly, deadline parse, window search.

import {
  SLOT_MS,
  helsinkiMinutesOfDay,
  helsinkiDateKey,
  helsinkiWallClockMs,
  addCalendarDays,
  slotsOf,
} from './slot-time.js';
import { pickContiguousWindow } from './calc.js';

// Drop slots whose window has already ended at nowMs, so a search over the result
// starts at the current slot. Without this the estimator recommends windows from
// earlier today (already passed) — useless for scheduling an appliance.
export function futureSlots(slots, nowMs, slotDurationMs = SLOT_MS) {
  return slots.filter((s) => Date.parse(s.datetime) + slotDurationMs > nowMs);
}

// Parse an <input type="time"> value (HH:MM, or empty) to minutes since Helsinki
// midnight. Empty / missing minutes / non-numeric → null. Integer minutes, not a
// fractional hour: 07:20 is 440, not 7 + 20/60 which * 60 becomes 439.999….
export function parseDeadlineMinutes(value) {
  if (!value) return null;
  const parts = value.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

// Today + tomorrow slots, minus any whose window has already ended. The only
// slot-assembly the estimator does — pulled out of the DOM module so the
// money-facing path is unit-tested.
export function collectEstimatorSlots(today, tomorrow, nowMs) {
  return futureSlots([...slotsOf(today), ...slotsOf(tomorrow)], nowMs);
}

// The next occurrence of deadlineMin (minutes since Helsinki midnight) as an
// absolute instant. A time already at or before slots[0]'s clock time is the
// following Helsinki day: that occurrence has started, so it is not a bound on
// a job that still has to run.
function resolveDeadline(slots, deadlineMin) {
  const first = slots[0].datetime;
  const firstDay = helsinkiDateKey(first);
  const rollsToNextDay = deadlineMin <= helsinkiMinutesOfDay(first);
  const targetDay = rollsToNextDay ? addCalendarDays(firstDay, 1) : firstDay;
  return { deadlineMs: helsinkiWallClockMs(targetDay, deadlineMin), rollsToNextDay };
}

// Index of the first slot starting at or after that instant — the charging
// window's exclusive upper bound. A same-day deadline later than the day's
// last slot start (23:59 vs a 23:45 last slot) therefore lands on the next
// day's first slot, which starts after the deadline instant. Without that the
// search would run into tomorrow's prices whenever they are loaded (finding
// #9574). Assumes slots span at most two Helsinki days (today + tomorrow),
// which collectEstimatorSlots guarantees. Returns null when no slot starts at
// or after the deadline.
export function findDeadlineSlotIndex(slots, deadlineMin) {
  if (!slots || slots.length === 0) return null;
  const { deadlineMs } = resolveDeadline(slots, deadlineMin);
  for (let i = 0; i < slots.length; i++) {
    if (Date.parse(slots[i].datetime) >= deadlineMs) return i;
  }
  return null;
}

// True when the deadline rolls to the Helsinki day after slots[0] and no slot
// starts at or after that instant — the usual case is "deadline is tomorrow
// morning, but tomorrow's prices aren't published yet." Same-day deadlines
// that simply fall past the last slot return false (that's a different miss).
export function isDeadlineDayUnavailable(slots, deadlineMin) {
  if (deadlineMin === null || deadlineMin === undefined) return false;
  if (!slots || slots.length === 0) return false;
  if (!resolveDeadline(slots, deadlineMin).rollsToNextDay) return false;
  return findDeadlineSlotIndex(slots, deadlineMin) === null;
}

// Cheapest and most expensive windows of `durationHours` within the deadline
// (if any). A window counts only when its slots are adjacent quarter-hours, so
// a 1h recommendation cannot span a missing slot (finding #12151). A deadline
// with no matching slot (past today's last start with tomorrow unpublished, or
// rolled onto a day with no data) searches through slots.length — remaining
// slots still start before it (finding #7111). endExclusive on the result is
// the exclusive window-end slot index (start + window length), the same bound
// convention calc.js uses — the view resolves it through slotSpanLabel, so a
// window abutting the data end still shows its true end instant.
export function findOptimalWindow(slots, durationHours, powerKw, deadlineMin) {
  const slotCount = Math.ceil(durationHours * 4);
  if (!slots || slots.length < slotCount) return null;

  let endExclusive = slots.length;
  if (deadlineMin !== null && deadlineMin !== undefined) {
    const deadlineIdx = findDeadlineSlotIndex(slots, deadlineMin);
    endExclusive = deadlineIdx ?? slots.length;
  }

  const pick = pickContiguousWindow(slots, slotCount, endExclusive);
  if (!pick) return null;

  const kwhPerSlot = powerKw * 0.25;
  const bestCost = pick.minSum * kwhPerSlot;
  const worstCost = pick.maxSum * kwhPerSlot;

  return {
    best: { startIndex: pick.minStart, endExclusive: pick.minStart + slotCount, cost: bestCost },
    worst: { startIndex: pick.maxStart, endExclusive: pick.maxStart + slotCount, cost: worstCost },
    savings: worstCost - bestCost,
  };
}
