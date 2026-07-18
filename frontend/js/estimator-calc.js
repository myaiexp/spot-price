// Pure cost-estimator logic: forward-slot filtering, deadline resolution, and
// the optimal-window search. Returns slot indices and numeric costs only — time
// formatting is the estimator view's job — so every branch is unit-testable.

import { SLOT_MS, helsinkiMinutesOfDay, helsinkiDateKey } from './slot-time.js';
import { windowSums, argMin, argMax } from './calc.js';

// Drop slots whose window has already ended at nowMs, so a search over the result
// starts at the current slot. Without this the estimator recommends windows from
// earlier today (already passed) — useless for scheduling an appliance.
export function futureSlots(slots, nowMs, slotDurationMs = SLOT_MS) {
  return slots.filter((s) => Date.parse(s.datetime) + slotDurationMs > nowMs);
}

// Index of the first slot at/after a wall-clock deadline hour (fractional for
// HH:MM), as the charging window's exclusive upper bound. The deadline is the
// *next* occurrence of that time of day: one already at/before slots[0]'s
// time-of-day rolls to the following Helsinki day. Assumes slots span at most two
// Helsinki days (today + tomorrow), which getEstimatorSlots guarantees. Returns
// null when the deadline lands past the last slot.
export function findDeadlineSlotIndex(slots, deadlineHour) {
  if (!slots || slots.length === 0) return null;
  const deadlineMin = deadlineHour * 60;
  const firstMin = helsinkiMinutesOfDay(slots[0].datetime);
  const firstDay = helsinkiDateKey(slots[0].datetime);
  const rollsToNextDay = deadlineMin <= firstMin;

  for (let i = 0; i < slots.length; i++) {
    const isNextDay = helsinkiDateKey(slots[i].datetime) !== firstDay;
    if (isNextDay !== rollsToNextDay) continue;
    if (helsinkiMinutesOfDay(slots[i].datetime) >= deadlineMin) return i;
  }
  return null;
}

// True when the deadline rolls to the Helsinki day *after* slots[0] and that
// day has no matching slot — the usual case is "deadline is tomorrow morning,
// but tomorrow's prices aren't published yet." Same-day deadlines that simply
// fall past the last slot return false (that's a different miss).
export function isDeadlineDayUnavailable(slots, deadlineHour) {
  if (deadlineHour === null || deadlineHour === undefined) return false;
  if (!slots || slots.length === 0) return false;
  const deadlineMin = deadlineHour * 60;
  const firstMin = helsinkiMinutesOfDay(slots[0].datetime);
  if (deadlineMin > firstMin) return false; // still on the first slot's day
  return findDeadlineSlotIndex(slots, deadlineHour) === null;
}

// Cheapest and most expensive contiguous windows of `durationHours` within the
// deadline (if any). endIndex is the exclusive window-end slot index (start +
// window length) — the view resolves it through slotBoundaryMs, so a window
// abutting the data end still shows its true end instant.
export function findOptimalWindow(slots, durationHours, powerKw, deadlineHour) {
  const quarterSlots = Math.ceil(durationHours * 4);
  if (!slots || slots.length < quarterSlots) return null;

  let maxEnd = slots.length;
  if (deadlineHour !== null && deadlineHour !== undefined) {
    const deadlineIdx = findDeadlineSlotIndex(slots, deadlineHour);
    if (deadlineIdx === null) return null;
    maxEnd = deadlineIdx;
  }

  const sums = windowSums(slots, quarterSlots, maxEnd);
  if (sums.length === 0) return null;

  const factor = powerKw * 0.25; // €/slot-hour: kW × 0.25h per quarter-slot
  const minStart = argMin(sums);
  const maxStart = argMax(sums);
  const bestCost = sums[minStart] * factor;
  const worstCost = sums[maxStart] * factor;

  return {
    best: { startIndex: minStart, endIndex: minStart + quarterSlots, cost: bestCost },
    worst: { startIndex: maxStart, endIndex: maxStart + quarterSlots, cost: worstCost },
    savings: worstCost - bestCost,
  };
}
