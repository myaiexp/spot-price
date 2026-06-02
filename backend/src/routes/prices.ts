// HTTP route handlers for /api/prices (today, yesterday, tomorrow, now, range, heatmap)
import { Hono } from 'hono';
import { gte, lt, and, asc } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate } from '../utils/helsinki-time.js';
import { getHeatmap } from '../queries/heatmap.js';

interface PriceSlot {
  datetime: string;
  priceNoTax: number;
  priceWithTax: number;
}

/**
 * Convert a raw Drizzle row (with string numerics) to a PriceSlot.
 */
function toSlot(row: { datetime: string; priceNoTax: string; priceWithTax: string }): PriceSlot {
  return {
    datetime: new Date(row.datetime).toISOString(),
    priceNoTax: parseFloat(row.priceNoTax),
    priceWithTax: parseFloat(row.priceWithTax),
  };
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

  return rows.map(toSlot);
}

export function pricesRoutes(db: Db): Hono {
  const router = new Hono();

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
        : slotStart + 15 * 60 * 1000;
      return nowMs >= slotStart && nowMs < slotEnd;
    });

    if (!currentSlot) {
      return c.json({ error: 'Current time slot not found in today\'s data' }, 404);
    }

    // Calculate percentile: what % of today's slots are cheaper
    const cheaperCount = todaySlots.filter(s => s.priceWithTax < currentSlot.priceWithTax).length;
    const percentile = Math.round((cheaperCount / todaySlots.length) * 100);

    // Find yesterday's slot at the same time-of-day
    const yesterday = shiftDate(today, -1);
    const yesterdaySlots = await getSlotsForDate(db, yesterday);

    // Match by same time-of-day: extract hours and minutes from Helsinki time
    const currentDt = new Date(currentSlot.datetime);
    const currentHelsinkiTime = currentDt.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Helsinki',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const yesterdaySlot = yesterdaySlots.find((slot) => {
      const slotDt = new Date(slot.datetime);
      const slotHelsinkiTime = slotDt.toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Helsinki',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return slotHelsinkiTime === currentHelsinkiTime;
    }) ?? null;

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
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return c.json({ error: 'Dates must be in YYYY-MM-DD format' }, 400);
    }

    // Check max 90 days
    const fromRange = getHelsinkiDateRange(from);
    const toRange = getHelsinkiDateRange(to);
    const daysDiff = Math.round((toRange.end.getTime() - fromRange.start.getTime()) / (24 * 60 * 60 * 1000));

    if (daysDiff > 90) {
      return c.json({ error: 'Date range cannot exceed 90 days' }, 400);
    }

    if (fromRange.start >= toRange.end) {
      return c.json({ error: '"from" must be before "to"' }, 400);
    }

    const rows = await db
      .select()
      .from(prices)
      .where(and(
        gte(prices.datetime, fromRange.start.toISOString()),
        lt(prices.datetime, toRange.end.toISOString()),
      ))
      .orderBy(asc(prices.datetime));

    const slots = rows.map(toSlot);

    return c.json({ slots, from, to });
  });

  // GET /heatmap — current week's hourly prices as a 7×24 grid
  router.get('/heatmap', async (c) => {
    return c.json(await getHeatmap(db));
  });

  return router;
}
