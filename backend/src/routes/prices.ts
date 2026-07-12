// HTTP route registration for /api/prices (today, yesterday, tomorrow, now, range, heatmap)
import { Hono } from 'hono';
import type { Db } from '../db/connection.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate, isValidCalendarDate } from '../utils/helsinki-time.js';
import { createHeatmap } from '../queries/heatmap.js';
import { createNowQuery } from '../queries/now.js';
import { getSlotsForDate, getSlotsForRange } from '../queries/day.js';

// Matches a YYYY-MM-DD date string. Module-level so it is compiled once rather
// than re-created on every /range request.
const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Maximum span accepted by /range, in days (both endpoints inclusive).
const MAX_RANGE_DAYS = 90;

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

export function pricesRoutes(db: Db): Hono {
  const router = new Hono();
  // Per-app query closures: each app instance gets its own cache (no cross-app leak).
  const getHeatmap = createHeatmap();
  const getNow = createNowQuery();

  // Day endpoints: /today (offset 0), /yesterday (-1), /tomorrow (+1, 404 until
  // tomorrow's prices are published). All return { slots, date }.
  registerDayRoute(router, db, '/today', 0);
  registerDayRoute(router, db, '/yesterday', -1);
  registerDayRoute(router, db, '/tomorrow', 1, 'Tomorrow prices not yet available');

  // GET /now — current 15-minute slot, percentile among today, and yesterday's
  // same-time slot. Polled live by the frontend; getNow caches per Helsinki
  // 15-minute slot (see createNowQuery).
  router.get('/now', async (c) => {
    const result = await getNow(db);
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
