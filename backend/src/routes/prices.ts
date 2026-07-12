// HTTP route handlers for /api/prices (today, yesterday, tomorrow, now, range, heatmap)
import { Hono } from 'hono';
import { gte, lt, and, asc } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate, isValidCalendarDate, helsinkiMinutesOfDay } from '../utils/helsinki-time.js';
import { createHeatmap } from '../queries/heatmap.js';
import { createTimeKeyedCache } from '../utils/time-keyed-cache.js';

interface PriceSlot {
  datetime: string;
  priceNoTax: number;
  priceWithTax: number;
}

/** Successful /now payload: current slot, its percentile among today, yesterday's same-time slot, and freshness. */
interface NowResponse {
  slot: PriceSlot;
  percentile: number;
  yesterdaySlot: PriceSlot | null;
  stale: boolean;
}

/** /now result: either the 200 payload or a 404 (no price data for today). */
type NowResult = { body: NowResponse; status: 200 } | { body: { error: string }; status: 404 };

// Matches a YYYY-MM-DD date string. Module-level so it is compiled once rather
// than re-created on every /range request.
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Maximum span accepted by /range, in days (both endpoints inclusive).
const MAX_RANGE_DAYS = 90;

// Duration of a single price slot (15 minutes) in milliseconds.
const SLOT_DURATION_MS = 15 * 60 * 1000;

// /now response cache lifetime — one collection sub-interval. Paired with a
// per-15-minute-slot cache key (below), this bounds how long an off-boundary
// collector upsert can stay masked while the slot key still drops the cache the
// instant the active slot turns over.
const NOW_TTL = 60 * 1000;

/**
 * Raw `prices` row as Drizzle infers it from the schema (NUMERIC/timestamp columns
 * come back as strings). Derived from `prices.$inferSelect` rather than hand-typed
 * so a schema column rename or type change is caught here at compile time.
 */
type PriceRow = typeof prices.$inferSelect;

/**
 * Convert a raw Drizzle row (with string numerics) to a PriceSlot, or null when a
 * numeric column fails to parse. node-postgres returns NUMERIC columns as strings;
 * a NULL or malformed value makes parseFloat return NaN, which JSON-serialises to
 * null and would silently corrupt the response. Such a row is unusable for
 * charting/cost, so it is dropped (see mapSlots) rather than emitting NaN.
 */
function rowToPriceSlot(row: PriceRow): PriceSlot | null {
  const priceNoTax = parseFloat(row.priceNoTax);
  const priceWithTax = parseFloat(row.priceWithTax);
  if (Number.isNaN(priceNoTax) || Number.isNaN(priceWithTax)) {
    return null;
  }
  return {
    datetime: new Date(row.datetime).toISOString(),
    priceNoTax,
    priceWithTax,
  };
}

/**
 * Map raw rows to PriceSlots, dropping any row that fails numeric conversion so
 * no NaN reaches the response. Well-formed rows pass through unchanged.
 */
function mapSlots(rows: PriceRow[]): PriceSlot[] {
  return rows.flatMap((row) => {
    const slot = rowToPriceSlot(row);
    return slot ? [slot] : [];
  });
}

/**
 * Query price slots for an arbitrary [start, end) UTC window — the base
 * primitive both the single-day helper and the /range route delegate to, so the
 * ORM query and row mapping live in exactly one place.
 */
async function getSlotsForRange(db: Db, start: Date, end: Date): Promise<PriceSlot[]> {
  const rows = await db
    .select()
    .from(prices)
    .where(and(gte(prices.datetime, start.toISOString()), lt(prices.datetime, end.toISOString())))
    .orderBy(asc(prices.datetime));

  return mapSlots(rows);
}

// Price slots for a YYYY-MM-DD Helsinki-timezone day.
async function getSlotsForDate(db: Db, dateStr: string): Promise<PriceSlot[]> {
  const { start, end } = getHelsinkiDateRange(dateStr);
  return getSlotsForRange(db, start, end);
}

/**
 * Register a day-scoped GET route (/today, /yesterday, /tomorrow) at the given
 * offset from Helsinki "today". When `emptyError` is set, an empty result yields
 * a 404 with that message (used by /tomorrow, whose data isn't published until
 * ~14:00); otherwise an empty day is a valid 200 with an empty slots array.
 */
function registerDayRoute(router: Hono, db: Db, path: string, offset: number, emptyError?: string): void {
  router.get(path, async (c) => {
    const date = shiftDate(getHelsinkiToday(), offset);
    const slots = await getSlotsForDate(db, date);
    if (emptyError && slots.length === 0) {
      return c.json({ error: emptyError }, 404);
    }
    return c.json({ slots, date });
  });
}

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
 * the route caches the result so polls within a slot don't repeat them.
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

export function pricesRoutes(db: Db): Hono {
  const router = new Hono();
  // Per-app heatmap query: each app instance gets its own cache (no cross-app leak).
  const getHeatmap = createHeatmap();

  // Day endpoints: /today (offset 0), /yesterday (-1), /tomorrow (+1, 404 until
  // tomorrow's prices are published). All return { slots, date }.
  registerDayRoute(router, db, '/today', 0);
  registerDayRoute(router, db, '/yesterday', -1);
  registerDayRoute(router, db, '/tomorrow', 1, 'Tomorrow prices not yet available');

  // GET /now — current 15-minute slot, percentile among today, and yesterday's
  // same-time slot. Polled live by the frontend's price display, so the response
  // is cached for NOW_TTL keyed by the current Helsinki 15-minute slot: repeated
  // polls within a slot reuse one result instead of issuing two DB round-trips
  // each (today + yesterday slices). The slot key drops the cache the instant the
  // slot turns over (every 15 min); the TTL bounds staleness from an off-boundary
  // collector upsert landing mid-slot. Key-equality + TTL guard and per-app
  // isolation live in createTimeKeyedCache (same seam as createHeatmap).
  const nowCache = createTimeKeyedCache<NowResult>(NOW_TTL);

  router.get('/now', async (c) => {
    const now = new Date();
    const today = getHelsinkiToday();
    const slotKey = `${today}:${Math.floor(helsinkiMinutesOfDay(now) / 15)}`;

    const cached = nowCache.get(slotKey);
    if (cached) {
      return c.json(cached.body, cached.status);
    }

    const result = await computeNowResponse(db, now, today);
    nowCache.set(slotKey, result);
    return c.json(result.body, result.status);
  });

  // GET /range — slots for a date range, max 90 days
  router.get('/range', async (c) => {
    const from = c.req.query('from');
    const to = c.req.query('to');

    if (!from || !to) {
      return c.json({ error: 'Both "from" and "to" query parameters are required (YYYY-MM-DD)' }, 400);
    }

    // Validate date format
    if (!DATE_FORMAT_REGEX.test(from) || !DATE_FORMAT_REGEX.test(to)) {
      return c.json({ error: 'Dates must be in YYYY-MM-DD format' }, 400);
    }

    // Reject well-formed but impossible calendar dates (e.g. 2026-02-30,
    // 2026-13-01) — JS would otherwise silently normalise them and shift the
    // queried range, or throw on the invalid Date.
    if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) {
      return c.json({ error: 'Dates must be valid calendar dates (YYYY-MM-DD)' }, 400);
    }

    const fromRange = getHelsinkiDateRange(from);
    const toRange = getHelsinkiDateRange(to);

    // `to` is inclusive: toRange.end is midnight at the START of the day after
    // `to`, so the whole `to` day falls in range. fromRange.start >= toRange.end
    // therefore means from is strictly AFTER to (a reversed range) — reject it.
    // from === to is intentionally allowed: it is a valid single-day query, not
    // an error or an empty result (audit #3131).
    if (fromRange.start >= toRange.end) {
      return c.json({ error: '"from" must be on or before "to" (YYYY-MM-DD)' }, 400);
    }

    // Cap the span at MAX_RANGE_DAYS (both endpoints inclusive).
    const daysDiff = Math.round((toRange.end.getTime() - fromRange.start.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff > MAX_RANGE_DAYS) {
      return c.json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` }, 400);
    }

    const slots = await getSlotsForRange(db, fromRange.start, toRange.end);

    return c.json({ slots, from, to });
  });

  // GET /heatmap — current week's hourly prices as a 7×24 grid
  router.get('/heatmap', async (c) => {
    return c.json(await getHeatmap(db));
  });

  return router;
}
