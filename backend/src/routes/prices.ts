// HTTP route handlers for /api/prices (today, yesterday, tomorrow, now, range, heatmap)
import { Hono } from 'hono';
import { gte, lt, and, asc } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate, isValidCalendarDate, helsinkiMinutesOfDay } from '../utils/helsinki-time.js';
import { createHeatmap } from '../queries/heatmap.js';

interface PriceSlot {
  datetime: string;
  priceNoTax: number;
  priceWithTax: number;
}

// Matches a YYYY-MM-DD date string. Module-level so it is compiled once rather
// than re-created on every /range request.
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Maximum span accepted by /range, in days (both endpoints inclusive).
const MAX_RANGE_DAYS = 90;

// Duration of a single price slot (15 minutes) in milliseconds.
const SLOT_DURATION_MS = 15 * 60 * 1000;

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
function toSlot(row: PriceRow): PriceSlot | null {
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
    const slot = toSlot(row);
    return slot ? [slot] : [];
  });
}

/**
 * Query all price slots for a given YYYY-MM-DD date (Helsinki timezone day).
 */
async function getSlotsForDate(db: Db, dateStr: string): Promise<PriceSlot[]> {
  const { start, end } = getHelsinkiDateRange(dateStr);

  const rows = await db
    .select()
    .from(prices)
    .where(and(gte(prices.datetime, start.toISOString()), lt(prices.datetime, end.toISOString())))
    .orderBy(asc(prices.datetime));

  return mapSlots(rows);
}

export function pricesRoutes(db: Db): Hono {
  const router = new Hono();
  // Per-app heatmap query: each app instance gets its own cache (no cross-app leak).
  const getHeatmap = createHeatmap();

  // GET /today — all slots for today (Helsinki time)
  router.get('/today', async (c) => {
    const today = getHelsinkiToday();
    const slots = await getSlotsForDate(db, today);
    return c.json({ slots, date: today });
  });

  // GET /yesterday — all slots for yesterday (Helsinki time)
  router.get('/yesterday', async (c) => {
    const today = getHelsinkiToday();
    const yesterday = shiftDate(today, -1);
    const slots = await getSlotsForDate(db, yesterday);
    return c.json({ slots, date: yesterday });
  });

  // GET /tomorrow — all slots for tomorrow (Helsinki time), 404 if none
  router.get('/tomorrow', async (c) => {
    const today = getHelsinkiToday();
    const tomorrow = shiftDate(today, 1);
    const slots = await getSlotsForDate(db, tomorrow);

    if (slots.length === 0) {
      return c.json({ error: 'Tomorrow prices not yet available' }, 404);
    }

    return c.json({ slots, date: tomorrow });
  });

  // GET /now — current 15-minute slot, percentile among today, and yesterday's same-time slot
  router.get('/now', async (c) => {
    const now = new Date();
    const today = getHelsinkiToday();
    const todaySlots = await getSlotsForDate(db, today);

    if (todaySlots.length === 0) {
      return c.json({ error: 'No price data for today' }, 404);
    }

    // Find the slot matching the current 15-minute window.
    // Each slot's datetime is the start of its 15-minute window.
    const nowMs = now.getTime();
    const currentSlot = todaySlots.find((slot, i) => {
      const slotStart = new Date(slot.datetime).getTime();
      const slotEnd = i < todaySlots.length - 1
        ? new Date(todaySlots[i + 1].datetime).getTime()
        : slotStart + SLOT_DURATION_MS;
      return nowMs >= slotStart && nowMs < slotEnd;
    });

    if (!currentSlot) {
      return c.json({ error: 'Current time slot not found in today\'s data' }, 404);
    }

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

    return c.json({ slot: currentSlot, percentile, yesterdaySlot });
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

    const rows = await db
      .select()
      .from(prices)
      .where(and(
        gte(prices.datetime, fromRange.start.toISOString()),
        lt(prices.datetime, toRange.end.toISOString()),
      ))
      .orderBy(asc(prices.datetime));

    const slots = mapSlots(rows);

    return c.json({ slots, from, to });
  });

  // GET /heatmap — current week's hourly prices as a 7×24 grid
  router.get('/heatmap', async (c) => {
    return c.json(await getHeatmap(db));
  });

  return router;
}
