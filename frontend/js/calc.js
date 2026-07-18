// Pure price algorithms shared by the insights and chart layers. No DOM, no
// clock reads — every function is a deterministic transform of a slots array,
// so it is unit-testable in isolation.

import { helsinkiHourMinute } from './slot-time.js';

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
// every start i in [0, maxEnd-windowSize]. One prefix-sum pass (O(n)) shared by
// both the cheapest-block and optimal-window scans, so the window bookkeeping
// lives in exactly one place.
export function windowSums(slots, windowSize, maxEnd = slots.length) {
  const end = Math.min(maxEnd, slots.length);
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
    endIndex: bestStart + blockSize - 1,
    avgPrice: sums[bestStart] / blockSize,
  };
}

// Next window at/under the cheapest-third threshold, relative to currentIndex.
// currentIndex may be -1 (now is before/outside the array) — the "in a cheap
// slot now" check is then skipped and the forward search starts at slot 0.
export function findNextCheapWindow(slots, currentIndex) {
  if (!slots || slots.length === 0) return null;
  const threshold = priceThreshold(slots, 1 / 3);

  const inRange = currentIndex >= 0 && currentIndex < slots.length;
  if (inRange && slots[currentIndex].priceWithTax <= threshold) {
    let endIdx = currentIndex;
    while (endIdx < slots.length && slots[endIdx].priceWithTax <= threshold) endIdx++;
    return { inCheapNow: true, endsAt: endIdx };
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
// below-threshold slots (30 min). Expressed as explicit run objects: collect
// above-threshold runs, merge neighbours separated by ≤2 slots, keep the longest
// (≥1h). avgPrice spans the merged run, bridged dips included.
export function findPeakBlock(slots) {
  if (!slots || slots.length === 0) return null;
  const threshold = priceThreshold(slots, 0.6);

  const runs = [];
  let start = -1;
  for (let i = 0; i < slots.length; i++) {
    const above = slots[i].priceWithTax >= threshold;
    if (above && start === -1) start = i;
    else if (!above && start !== -1) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, slots.length - 1]);
  if (runs.length === 0) return null;

  const merged = [runs[0].slice()];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const gap = runs[i][0] - prev[1] - 1;
    if (gap <= 2) prev[1] = runs[i][1];
    else merged.push(runs[i].slice());
  }

  let best = null;
  for (const run of merged) {
    if (!best || run[1] - run[0] > best[1] - best[0]) best = run;
  }
  const bestLen = best[1] - best[0] + 1;
  if (bestLen < 4) return null;

  let sum = 0;
  for (let i = best[0]; i <= best[1]; i++) sum += slots[i].priceWithTax;
  return { startIndex: best[0], endIndex: best[1], avgPrice: sum / bestLen };
}

// EMA (α default 0.3) over each wall-clock hour. Buckets are cut at the first
// slot and every Helsinki :00 slot rather than by fixed 4-slot slices, so a 23h
// spring-forward day yields 23 buckets and a 25h fall-back day 25 — each labelled
// by its own slot's real hour instead of drifting after the transition.
export function emaAggregate(slots, alpha = 0.3) {
  if (!slots || slots.length === 0) return [];
  const buckets = [];
  for (let i = 0; i < slots.length; i++) {
    const { minute } = helsinkiHourMinute(slots[i].datetime);
    if (i === 0 || minute === 0) buckets.push([]);
    buckets[buckets.length - 1].push(slots[i]);
  }
  return buckets.map((quarter) => {
    let ema = quarter[0].priceWithTax;
    let emaNoTax = quarter[0].priceNoTax;
    for (let i = 1; i < quarter.length; i++) {
      ema = alpha * quarter[i].priceWithTax + (1 - alpha) * ema;
      emaNoTax = alpha * quarter[i].priceNoTax + (1 - alpha) * emaNoTax;
    }
    return { datetime: quarter[0].datetime, priceNoTax: emaNoTax, priceWithTax: ema };
  });
}
