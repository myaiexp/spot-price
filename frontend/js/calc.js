// Pure price algorithms shared by the insights and chart layers. No DOM, no
// clock reads — every function is a deterministic transform of a slots array,
// so it is unit-testable in isolation. Includes wall-clock ghost alignment.
//
// Window-bound convention: every returned window end is an EXCLUSIVE slot index
// named `endExclusive` (one past the last included slot), matching
// estimator-calc.js. The name carries the semantics on purpose — an `endIndex`
// that was inclusive here and exclusive there was a standing off-by-one trap for
// new consumers (audit #5565). An exclusive end also feeds slotBoundaryMs /
// slotBoundaryLabel directly, which is what every call site wants.

import { helsinkiHourMinute, helsinkiMinutesOfDay, HOUR_MS } from './slot-time.js';

// First index of the minimum value (ties → earliest), matching the original
// strict-`<` scan bookkeeping.
export function argMin(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[best]) best = i;
  return best;
}

// First index of the maximum value (ties → earliest).
export function argMax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

// Sliding-window sums of priceWithTax: sums[i] = Σ slots[i .. i+windowSize) for
// every start i in [0, endExclusive-windowSize]. endExclusive is one past the
// last slot a window may include (same bound as the public window fields). One
// prefix-sum pass (O(n)) shared by both the cheapest-block and optimal-window
// scans, so the window bookkeeping lives in exactly one place.
export function windowSums(slots, windowSize, endExclusive = slots.length) {
  const end = Math.min(endExclusive, slots.length);
  const count = end - windowSize + 1;
  if (count <= 0) return [];
  const prefix = new Array(end + 1);
  prefix[0] = 0;
  for (let i = 0; i < end; i++) prefix[i + 1] = prefix[i] + slots[i].priceWithTax;
  const sums = new Array(count);
  for (let i = 0; i < count; i++) sums[i] = prefix[i + windowSize] - prefix[i];
  return sums;
}

// Sorted-price value at a fractional index — the shared "cheapest-third" /
// "peak-percentile" idiom.
export function priceThreshold(slots, fraction) {
  const prices = slots.map((s) => s.priceWithTax).sort((a, b) => a - b);
  return prices[Math.floor(prices.length * fraction)];
}

// Cheapest contiguous block of `blockSize` slots (default 2h = 8 quarter-hours).
export function findCheapestBlock(slots, blockSize = 8) {
  if (!slots || slots.length < blockSize) return null;
  const sums = windowSums(slots, blockSize);
  const bestStart = argMin(sums);
  return {
    startIndex: bestStart,
    endExclusive: bestStart + blockSize,
    avgPrice: sums[bestStart] / blockSize,
  };
}

// Next window at/under the cheapest-third threshold, relative to currentIndex.
// currentIndex may be -1 (now is before/outside the array) — the "in a cheap
// slot now" check is then skipped and the forward search starts at slot 0.
// The in-cheap-now branch reports the run's `endExclusive` (one past its last
// cheap slot), same bound convention as the block finders.
export function findNextCheapWindow(slots, currentIndex) {
  if (!slots || slots.length === 0) return null;
  const threshold = priceThreshold(slots, 1 / 3);

  const inRange = currentIndex >= 0 && currentIndex < slots.length;
  if (inRange && slots[currentIndex].priceWithTax <= threshold) {
    let endIdx = currentIndex;
    while (endIdx < slots.length && slots[endIdx].priceWithTax <= threshold) endIdx++;
    return { inCheapNow: true, endExclusive: endIdx };
  }

  for (let i = Math.max(0, currentIndex + 1); i < slots.length; i++) {
    if (slots[i].priceWithTax <= threshold) {
      return {
        inCheapNow: false,
        startIndex: i,
        startsIn: (i - currentIndex) * 15,
        price: slots[i].priceWithTax,
      };
    }
  }
  return null;
}

// Longest run of above-threshold (60th-percentile) slots, bridging gaps of ≤2
// below-threshold slots (30 min). Runs are {startIndex, endExclusive} through
// collect / merge / pick so gap and length math stay on the same exclusive-end
// convention as every other window in this module (audit #5565, #7122). avgPrice
// spans the merged run, bridged dips included.
export function findPeakBlock(slots) {
  if (!slots || slots.length === 0) return null;
  const threshold = priceThreshold(slots, 0.6);

  const runs = [];
  let start = -1;
  for (let i = 0; i < slots.length; i++) {
    const above = slots[i].priceWithTax >= threshold;
    if (above && start === -1) start = i;
    else if (!above && start !== -1) {
      runs.push({ startIndex: start, endExclusive: i });
      start = -1;
    }
  }
  if (start !== -1) runs.push({ startIndex: start, endExclusive: slots.length });
  if (runs.length === 0) return null;

  const merged = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const gap = runs[i].startIndex - prev.endExclusive;
    if (gap <= 2) prev.endExclusive = runs[i].endExclusive;
    else merged.push({ ...runs[i] });
  }

  let best = null;
  for (const run of merged) {
    const len = run.endExclusive - run.startIndex;
    if (!best || len > best.endExclusive - best.startIndex) best = run;
  }
  const bestLen = best.endExclusive - best.startIndex;
  if (bestLen < 4) return null;

  let sum = 0;
  for (let i = best.startIndex; i < best.endExclusive; i++) sum += slots[i].priceWithTax;
  return { startIndex: best.startIndex, endExclusive: best.endExclusive, avgPrice: sum / bestLen };
}

// EMA (α default 0.3) over each wall-clock hour. A slot belongs to the hour at
// its UTC hour floor: Helsinki offsets are whole hours (+2/+3), so every UTC hour
// boundary is a Helsinki :00 boundary. Keying on that absolute hour — not on the
// Helsinki hour number (the fall-back day has two 03:xx hours) or on seeing a :00
// slot (a collection gap at 10:00 would merge 10:15–10:45 into 09:xx, finding
// #9929) — yields 23 buckets on spring-forward, 25 on fall-back, and one bucket
// per hour with any data. Each bucket is dated at its hour start, so hourLabel
// and findSlotContaining(…, HOUR_MS) stay right even when the :00 slot is missing.
export function emaAggregate(slots, alpha = 0.3) {
  if (!slots || slots.length === 0) return [];
  const buckets = [];
  for (const s of slots) {
    const hourStart = Math.floor(Date.parse(s.datetime) / HOUR_MS) * HOUR_MS;
    const last = buckets[buckets.length - 1];
    if (last && last.hourStart === hourStart) last.slots.push(s);
    else buckets.push({ hourStart, slots: [s] });
  }
  return buckets.map(({ hourStart, slots: hourSlots }) => {
    let ema = hourSlots[0].priceWithTax;
    let emaNoTax = hourSlots[0].priceNoTax;
    for (let i = 1; i < hourSlots.length; i++) {
      ema = alpha * hourSlots[i].priceWithTax + (1 - alpha) * ema;
      emaNoTax = alpha * hourSlots[i].priceNoTax + (1 - alpha) * emaNoTax;
    }
    return { datetime: new Date(hourStart).toISOString(), priceNoTax: emaNoTax, priceWithTax: ema };
  });
}

// Align a secondary day's prices onto the primary day's category axis by
// Helsinki wall-clock time-of-day (not array index). Zip-by-index drifts on
// 23h/25h DST days and is useless when secondary is pure-hourly backfill
// against a 15-min primary (audit #6332).
//
// Returns one entry per primary slot: priceWithTax, or null when secondary has
// no matching wall-clock key. Empty secondary → [] so callers can skip the
// ghost series. Fall-back duplicates (two 03:xx) are consumed in order; if
// primary has more copies than secondary, the last secondary value is reused.
export function alignSecondaryByWallClock(primarySlots, secondarySlots, { hourly = false } = {}) {
  if (!secondarySlots || secondarySlots.length === 0) return [];
  if (!primarySlots || primarySlots.length === 0) return [];

  const keyOf = hourly
    ? (s) => helsinkiHourMinute(s.datetime).hour
    : (s) => helsinkiMinutesOfDay(s.datetime);

  const buckets = new Map();
  for (const s of secondarySlots) {
    const k = keyOf(s);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(s.priceWithTax);
  }

  const cursor = new Map();
  return primarySlots.map((s) => {
    const k = keyOf(s);
    const arr = buckets.get(k);
    if (!arr) return null;
    const i = cursor.get(k) ?? 0;
    if (i >= arr.length) return arr[arr.length - 1];
    cursor.set(k, i + 1);
    return arr[i];
  });
}
