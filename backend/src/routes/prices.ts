import { Hono } from 'hono';
import { gte, lt, and, asc, sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';

interface PriceSlot {
  datetime: string;
  priceNoTax: number;
  priceWithTax: number;
}

/**
 * Returns the current date as YYYY-MM-DD in Europe/Helsinki timezone.
 */
function getHelsinkiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
}

/**
 * Given a YYYY-MM-DD string, returns UTC Date objects representing
 * midnight-to-midnight in Helsinki time.
 */
function getHelsinkiDateRange(dateStr: string): { start: Date; end: Date } {
  // Find what UTC time corresponds to midnight Helsinki on dateStr.
  // Helsinki is UTC+2 (EET) or UTC+3 (EEST).
  // We try +02:00 first and verify by formatting back — if the date doesn't match,
  // it must be summer time (+03:00).

  // Try +02:00 first (winter time = EET)
  const tryWinter = new Date(`${dateStr}T00:00:00+02:00`);
  const tryWinterFormatted = tryWinter.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  let start: Date;
  if (tryWinterFormatted === dateStr) {
    // +02:00 is correct for this date
    start = tryWinter;
  } else {
    // Must be summer time (+03:00 = EEST)
    start = new Date(`${dateStr}T00:00:00+03:00`);
  }

  // Same logic for the next day
  const nextDate = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = nextDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  // The end might cross a DST boundary, so recalculate
  const tryNextWinter = new Date(`${nextDateStr}T00:00:00+02:00`);
  const tryNextWinterFormatted = tryNextWinter.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

  let end: Date;
  if (tryNextWinterFormatted === nextDateStr) {
    end = tryNextWinter;
  } else {
    end = new Date(`${nextDateStr}T00:00:00+03:00`);
  }

  return { start, end };
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

/**
 * Shift a YYYY-MM-DD string by a number of days.
 */
function shiftDate(dateStr: string, days: number): string {
  const { start } = getHelsinkiDateRange(dateStr);
  const shifted = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return shifted.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
}

/**
 * Compute exponential moving average over an array of values (oldest first).
 * EMA_0 = values[0], EMA_i = alpha * values[i] + (1 - alpha) * EMA_{i-1}
 */
export function computeEma(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}

const DAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

// In-memory heatmap cache with 15-min TTL
let heatmapCache: { data: unknown; timestamp: number } | null = null;
const HEATMAP_TTL = 15 * 60 * 1000;

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
    // Check cache
    if (heatmapCache && Date.now() - heatmapCache.timestamp < HEATMAP_TTL) {
      return c.json(heatmapCache.data);
    }

    // Current week Mon..Sun in Helsinki time, include all available data
    const rows = await db.execute(sql`
      SELECT
        EXTRACT(ISODOW FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS weekday,
        EXTRACT(HOUR FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS hour,
        AVG(price_with_tax::float) AS avg_price
      FROM prices
      WHERE datetime AT TIME ZONE 'Europe/Helsinki'
        >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Helsinki')
        AND datetime AT TIME ZONE 'Europe/Helsinki'
        < date_trunc('week', NOW() AT TIME ZONE 'Europe/Helsinki') + interval '7 days'
      GROUP BY weekday, hour
      ORDER BY weekday, hour
    `);

    // Build lookup
    const cellValues = new Map<string, number>();
    for (const row of rows.rows as Array<{ weekday: number; hour: number; avg_price: number }>) {
      const weekday = row.weekday - 1; // ISODOW 1=Mon → 0
      cellValues.set(`${weekday}-${row.hour}`, row.avg_price);
    }

    // Current Helsinki weekday (0=Mon) and hour for the frontend to know what's "future"
    const nowInfo = await db.execute(sql`
      SELECT
        EXTRACT(WEEK FROM NOW() AT TIME ZONE 'Europe/Helsinki')::int AS week_number
    `);
    const now = (nowInfo.rows as Array<{ week_number: number }>)[0];

    // Build the matrix — null for cells without data (future)
    let globalMin = Infinity;
    let globalMax = -Infinity;

    const matrix = Array.from({ length: 7 }, (_, day) => {
      const hours = Array.from({ length: 24 }, (_, hour) => {
        const price = cellValues.get(`${day}-${hour}`);
        if (price === undefined) return null;

        const centsPerKwh = price * 100;
        if (centsPerKwh < globalMin) globalMin = centsPerKwh;
        if (centsPerKwh > globalMax) globalMax = centsPerKwh;

        return Math.round(centsPerKwh * 100) / 100;
      });

      return { day, label: DAY_LABELS[day], hours };
    });

    if (globalMin === Infinity) globalMin = 0;
    if (globalMax === -Infinity) globalMax = 0;

    const response = {
      matrix,
      minPrice: Math.round(globalMin * 100) / 100,
      maxPrice: Math.round(globalMax * 100) / 100,
      weekNumber: now.week_number,
    };

    heatmapCache = { data: response, timestamp: Date.now() };

    return c.json(response);
  });

  return router;
}
