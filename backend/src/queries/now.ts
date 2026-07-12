// /now current-slot query: percentile among today, yesterday's same-time slot, cache.

import type { Db } from '../db/connection.js';
import { getHelsinkiToday, helsinkiMinutesOfDay, shiftDate } from '../utils/helsinki-time.js';
import { createTimeKeyedCache } from '../utils/time-keyed-cache.js';
import { getSlotsForDate, type PriceSlot } from './day.js';

/** Successful /now payload: current slot, its percentile among today, yesterday's same-time slot, and freshness. */
interface NowResponse {
  slot: PriceSlot;
  percentile: number;
  yesterdaySlot: PriceSlot | null;
  stale: boolean;
}

/** /now result: either the 200 payload or a 404 (no price data for today). */
export type NowResult = { body: NowResponse; status: 200 } | { body: { error: string }; status: 404 };

// Duration of a single price slot (15 minutes) in milliseconds.
const SLOT_DURATION_MS = 15 * 60 * 1000;

// /now response cache lifetime — one collection sub-interval. Paired with a
// per-15-minute-slot cache key (below), this bounds how long an off-boundary
// collector upsert can stay masked while the slot key still drops the cache the
// instant the active slot turns over.
const NOW_TTL = 60 * 1000;

/**
 * End of slot `i`'s 15-minute window in epoch ms: the next slot's start, or
 * +15min past its own start for the last slot of the day. Pulled out of the
 * /now `.find` predicate so the boundary rule reads at a glance.
 */
function slotWindowEndMs(slots: PriceSlot[], i: number): number {
  const start = new Date(slots[i].datetime).getTime();
  return i < slots.length - 1 ? new Date(slots[i + 1].datetime).getTime() : start + SLOT_DURATION_MS;
}

/**
 * Compute the /now payload for instant `now` and Helsinki day `today`: the
 * current 15-minute slot, its percentile among today, yesterday's same-time
 * slot, and a stale flag. Issues the two day-scoped DB reads (today + yesterday);
 * the caching closure reuses the result so polls within a slot don't repeat them.
 */
async function computeNowResponse(db: Db, now: Date, today: string): Promise<NowResult> {
  const todaySlots = await getSlotsForDate(db, today);

  if (todaySlots.length === 0) {
    return { body: { error: 'No price data for today' }, status: 404 };
  }

  // Each slot's datetime is the start of its 15-minute window; find the one
  // whose window contains `now`.
  const nowMs = now.getTime();
  const activeSlot = todaySlots.find(
    (slot, i) => nowMs >= new Date(slot.datetime).getTime() && nowMs < slotWindowEndMs(todaySlots, i),
  );

  // Fallback for delayed collection: when `now` sits past the last stored
  // slot's window (e.g. it's 21:00 but data only runs to 20:00), serve the most
  // recent slot flagged `stale` instead of a 404, so the UI shows a price with
  // a freshness hint rather than nothing. todaySlots is non-empty here.
  const stale = activeSlot === undefined;
  const currentSlot = activeSlot ?? todaySlots[todaySlots.length - 1];

  // Calculate percentile: what % of today's slots are cheaper
  const cheaperCount = todaySlots.filter(s => s.priceWithTax < currentSlot.priceWithTax).length;
  const percentile = Math.round((cheaperCount / todaySlots.length) * 100);

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

  return { body: { slot: currentSlot, percentile, yesterdaySlot, stale }, status: 200 };
}

/**
 * Create a /now query bound to its own cache. Each call returns an independent
 * getNow closure so separate app instances — and successive tests — never share
 * cached data (same isolation guarantee as createHeatmap).
 *
 * The response is cached for NOW_TTL keyed by the current Helsinki 15-minute
 * slot: repeated polls within a slot reuse one result instead of issuing two DB
 * round-trips each (today + yesterday slices). The slot key drops the cache the
 * instant the slot turns over (every 15 min); the TTL bounds staleness from an
 * off-boundary collector upsert landing mid-slot. Key-equality + TTL guard and
 * per-closure isolation live in createTimeKeyedCache.
 */
export function createNowQuery(): (db: Db) => Promise<NowResult> {
  const cache = createTimeKeyedCache<NowResult>(NOW_TTL);

  return async function getNow(db: Db): Promise<NowResult> {
    const now = new Date();
    const today = getHelsinkiToday();
    const slotKey = `${today}:${Math.floor(helsinkiMinutesOfDay(now) / 15)}`;

    const cached = cache.get(slotKey);
    if (cached) {
      return cached;
    }

    const result = await computeNowResponse(db, now, today);
    cache.set(slotKey, result);
    return result;
  };
}
