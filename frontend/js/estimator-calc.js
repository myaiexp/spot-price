// Pure cost-estimator logic: slot assembly, deadline parse, window search.

import { SLOT_MS, helsinkiMinutesOfDay, helsinkiDateKey, slotsOf } from './slot-time.js';
import { windowSums, argMin, argMax } from './calc.js';

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

// Index of the first slot starting at/after a wall-clock deadline (minutes since
// Helsinki midnight), as the charging window's exclusive upper bound. The deadline
// is the *next* occurrence of that time of day: one already at/before slots[0]'s
// time-of-day rolls to the following Helsinki day. A same-day deadline later than
// that day's last slot start (23:59 vs a 23:45 last slot) resolves to the next
// day's first slot, which starts after the deadline instant — without that the
// search would run into tomorrow's prices whenever they are loaded (finding
// #9574). Assumes slots span at most two Helsinki days (today + tomorrow), which
// collectEstimatorSlots guarantees. Returns null when no slot starts at/after the
// deadline.
export function findDeadlineSlotIndex(slots, deadlineMin) {
  if (!slots || slots.length === 0) return null;
  const firstMin = helsinkiMinutesOfDay(slots[0].datetime);
  const firstDay = helsinkiDateKey(slots[0].datetime);
  const rollsToNextDay = deadlineMin <= firstMin;

  for (let i = 0; i < slots.length; i++) {
    const isNextDay = helsinkiDateKey(slots[i].datetime) !== firstDay;
    // Same-day deadline: every earlier same-day slot started before it, so the
    // day boundary is the bound.
    if (isNextDay && !rollsToNextDay) return i;
    if (isNextDay !== rollsToNextDay) continue;
    if (helsinkiMinutesOfDay(slots[i].datetime) >= deadlineMin) return i;
  }
  return null;
}

// True when the deadline rolls to the Helsinki day *after* slots[0] and that
// day has no matching slot — the usual case is "deadline is tomorrow morning,
// but tomorrow's prices aren't published yet." Same-day deadlines that simply
// fall past the last slot return false (that's a different miss).
export function isDeadlineDayUnavailable(slots, deadlineMin) {
  if (deadlineMin === null || deadlineMin === undefined) return false;
  if (!slots || slots.length === 0) return false;
  const firstMin = helsinkiMinutesOfDay(slots[0].datetime);
  if (deadlineMin > firstMin) return false; // still on the first slot's day
  return findDeadlineSlotIndex(slots, deadlineMin) === null;
}

// Cheapest and most expensive contiguous windows of `durationHours` within the
// deadline (if any). A deadline with no matching slot (past today's last start
// with tomorrow unpublished, or rolled onto a day with no data) searches through
// slots.length — remaining slots still start before it (finding #7111). endExclusive on the result is
// the exclusive window-end slot index (start + window length), the same bound
// convention calc.js uses — the view resolves it through slotSpanLabel, so a
// window abutting the data end still shows its true end instant.
export function findOptimalWindow(slots, durationHours, powerKw, deadlineMin) {
  const slotCount = Math.ceil(durationHours * 4);
  if (!slots || slots.length < slotCount) return null;

  let endExclusive = slots.length;
  if (deadlineMin !== null && deadlineMin !== undefined) {
    const deadlineIdx = findDeadlineSlotIndex(slots, deadlineMin);
    // No matching slot (deadline past the last start, or rolled onto a day
    // with no data) still leaves every remaining slot starting before the
    // deadline — search them. Duration-too-long then returns null below, and
    // isDeadlineDayUnavailable explains the unpublished-tomorrow case.
    endExclusive = deadlineIdx ?? slots.length;
  }

  const sums = windowSums(slots, slotCount, endExclusive);
  if (sums.length === 0) return null;

  const kwhPerSlot = powerKw * 0.25;
  const minStart = argMin(sums);
  const maxStart = argMax(sums);
  const bestCost = sums[minStart] * kwhPerSlot;
  const worstCost = sums[maxStart] * kwhPerSlot;

  return {
    best: { startIndex: minStart, endExclusive: minStart + slotCount, cost: bestCost },
    worst: { startIndex: maxStart, endExclusive: maxStart + slotCount, cost: worstCost },
    savings: worstCost - bestCost,
  };
}
