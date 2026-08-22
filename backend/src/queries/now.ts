// /now current-slot query: cheap-rank among today, yesterday's same-time slot, cache.

import type { Db } from '../db/connection.js';
import { getHelsinkiToday, helsinkiMinutesOfDay, shiftDate } from '../utils/helsinki-time.js';
import { createTimeKeyedCache } from '../utils/time-keyed-cache.js';
import { getSlotsForDate, type PriceSlot } from './day.js';

/** Current-slot payload: slot, cheap-rank among today, yesterday's same-time slot, freshness. */
export interface NowResponse {
  slot: PriceSlot;
  /**
   * Share (0–100) of today's slots that cost MORE than the current one — i.e.
   * literally "this price is cheaper than N% of today". High = cheap.
   *
   * The direction is baked into the name on purpose: the field used to be a
   * bottom-up `percentile` (share of slots *cheaper* than the current one, so
   * high = expensive), which the hero card read as a cheap signal and painted
   * peak prices green (audit #5549/#5563). Both ends of the wire now speak the
   * same polarity, and the name says which.
   */
  cheaperThanPercent: number;
  yesterdaySlot: PriceSlot | null;
  stale: boolean;
}

// Duration of a single price slot (15 minutes) in milliseconds. Interior
// windows are this fixed width — the same [start, start+15min) rule as the
// frontend's findSlotContaining — not stretched to the next stored start.
const SLOT_DURATION_MS = 15 * 60 * 1000;

// /now response cache lifetime — one collection sub-interval. Paired with a
// per-15-minute-slot cache key (below), this bounds how long an off-boundary
// collector upsert can stay masked while the slot key still drops the cache the
// instant the active slot turns over.
const NOW_TTL = 60 * 1000;

/**
 * Latest slot whose start is at or before `nowMs`, or undefined when `nowMs`
 * sits before every stored slot. Slots are datetime-ascending from the query.
 */
function mostRecentPastSlot(slots: PriceSlot[], nowMs: number): PriceSlot | undefined {
  let last: PriceSlot | undefined;
  for (const slot of slots) {
    if (new Date(slot.datetime).getTime() <= nowMs) last = slot;
  }
  return last;
}

/**
 * Compute the current-slot payload for instant `now` and Helsinki day `today`.
 * Returns null when today has no slots, or when `now` is before the first
 * stored slot — the route maps both to 404. Issues the two day-scoped DB reads
 * (today + yesterday); the caching closure reuses the result so polls within a
 * slot don't repeat them.
 */
async function computeNowResponse(db: Db, now: Date, today: string): Promise<NowResponse | null> {
  const todaySlots = await getSlotsForDate(db, today);

  if (todaySlots.length === 0) {
    return null;
  }

  // Each slot's datetime is the start of its 15-minute window; find the one
  // whose [start, start+15min) window contains `now`. Matching the frontend's
  // findSlotContaining (fixed 15 min, not stretched to the next stored start)
  // so an interior hole is a miss rather than a live previous slot.
  const nowMs = now.getTime();
  const activeSlot = todaySlots.find((slot) => {
    const start = new Date(slot.datetime).getTime();
    return nowMs >= start && nowMs < start + SLOT_DURATION_MS;
  });

  // Delayed collection / missing data: serve the most recent *past* slot
  // flagged `stale` instead of a 404, so the UI shows a price with a freshness
  // hint rather than nothing. Covers now past the last stored window AND an
  // interior gap. now *before* the first slot has no past slot to fall back
  // to — returning last-of-day here would paint a future price as current.
  const currentSlot = activeSlot ?? mostRecentPastSlot(todaySlots, nowMs);
  if (!currentSlot) {
    return null;
  }
  const stale = activeSlot === undefined;

  // Cheap-rank: what % of today's slots cost more than the current one. Ties
  // (the 15-min slots of one hourly source price share a value) count for
  // neither side, so an all-flat day reads 0 — nothing is dearer — rather than
  // claiming the price beats the whole day.
  const dearerCount = todaySlots.filter(s => s.priceWithTax > currentSlot.priceWithTax).length;
  const cheaperThanPercent = Math.round((dearerCount / todaySlots.length) * 100);

  // Find yesterday's slot at the same Helsinki WALL-CLOCK time-of-day.
  //
  // Semantics are deliberately wall-clock, not 24h-ago (UTC instant): for spot
  // prices "yesterday at this time" means the same local hour (peaks are
  // wall-clock-anchored), and the whole codebase keys days by Helsinki local
  // time. Matching is on an explicit minutes-of-day key (helsinkiMinutesOfDay)
  // rather than a formatted local-time string, which makes it deterministic and
  // free of locale/ICU string quirks. Consequences near DST, both intentional:
  //   - spring-forward: a current time that didn't exist yesterday (the skipped
  //     03:00–04:00 hour) has no match -> null, rather than silently surfacing a
  //     different hour.
  //   - fall-back: yesterday repeats the wall-clock hour, so two instants share
  //     the key; find() returns the first (earliest) deterministically.
  const yesterday = shiftDate(today, -1);
  const yesterdaySlots = await getSlotsForDate(db, yesterday);

  const currentMinutes = helsinkiMinutesOfDay(new Date(currentSlot.datetime));
  const yesterdaySlot = yesterdaySlots.find(
    (slot) => helsinkiMinutesOfDay(new Date(slot.datetime)) === currentMinutes,
  ) ?? null;

  return { slot: currentSlot, cheaperThanPercent, yesterdaySlot, stale };
}

/**
 * Create a /now query bound to its own cache. Each call returns an independent
 * getNow closure so separate app instances — and successive tests — never share
 * cached data (same isolation guarantee as createHeatmap).
 *
 * Returns the domain payload, or null when there is no current slot to serve
 * (empty today, or now before the first stored slot) — the /now route maps null
 * to 404. The response (including null) is cached for NOW_TTL keyed by the
 * current Helsinki 15-minute slot: repeated polls within a slot reuse one
 * result instead of issuing two DB round-trips each (today + yesterday slices).
 * The slot key drops the cache the instant the slot turns over (every 15 min);
 * the TTL bounds staleness from an off-boundary collector upsert landing
 * mid-slot. Key-equality + TTL guard and per-closure isolation live in
 * createTimeKeyedCache.
 */
export function createNowQuery(): (db: Db) => Promise<NowResponse | null> {
  const cache = createTimeKeyedCache<NowResponse | null>(NOW_TTL);

  return async function getNow(db: Db): Promise<NowResponse | null> {
    const now = new Date();
    const today = getHelsinkiToday();
    const slotKey = `${today}:${Math.floor(helsinkiMinutesOfDay(now) / 15)}`;

    // `null` is a cached miss (empty today / before first slot) — don't treat
    // it as a cache hole the way a truthy check would.
    const cached = cache.get(slotKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await computeNowResponse(db, now, today);
    cache.set(slotKey, result);
    return result;
  };
}
