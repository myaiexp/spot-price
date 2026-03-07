import { Hono } from 'hono';
import { gte, lt, and, asc } from 'drizzle-orm';
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

  // GET /heatmap — EMA-weighted heatmap of prices by weekday and hour
  router.get('/heatmap', async (c) => {
    // Check cache
    if (heatmapCache && Date.now() - heatmapCache.timestamp < HEATMAP_TTL) {
      return c.json(heatmapCache.data);
    }

    // Fetch all prices ordered by datetime ASC
    const rows = await db
      .select()
      .from(prices)
      .orderBy(asc(prices.datetime));

    // Group by (weekday, hour, week-identifier)
    // Key: "weekday-hour-weekId" → array of price values (oldest first)
    const hourlyByWeek = new Map<string, number[]>();

    for (const row of rows) {
      const dt = new Date(row.datetime);
      // Extract Helsinki hour
      const hour = parseInt(
        dt.toLocaleString('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false }),
        10
      );
      // Get weekday as 0=Mon..6=Sun
      const dayName = dt.toLocaleString('en-US', { timeZone: 'Europe/Helsinki', weekday: 'long' });
      const dayMap: Record<string, number> = {
        Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3,
        Friday: 4, Saturday: 5, Sunday: 6,
      };
      const weekday = dayMap[dayName];

      // Week identifier: ISO week-year (use Helsinki date for consistency)
      const helsinkiDate = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });
      // Compute ISO week number from Helsinki date
      const [y, m, d] = helsinkiDate.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      const dayOfWeek = dateObj.getUTCDay() || 7; // Mon=1..Sun=7
      dateObj.setUTCDate(dateObj.getUTCDate() + 4 - dayOfWeek);
      const yearStart = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil(((dateObj.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const weekId = `${dateObj.getUTCFullYear()}-W${weekNum}`;

      const key = `${weekday}-${hour}-${weekId}`;
      const price = parseFloat(row.priceWithTax);

      if (!hourlyByWeek.has(key)) {
        hourlyByWeek.set(key, []);
      }
      hourlyByWeek.get(key)!.push(price);
    }

    // Step 4: Within each (weekday, hour, week), EMA the sub-hour slots into one hourly value
    // Step 5: For each (weekday, hour), collect weekly values chronologically, compute EMA
    // Group weekly values by (weekday, hour)
    const cellValues = new Map<string, { weekId: string; value: number }[]>();

    for (const [key, values] of hourlyByWeek) {
      const parts = key.split('-');
      const weekdayStr = parts[0];
      const hourStr = parts[1];
      const weekId = parts.slice(2).join('-');

      // EMA sub-hour slots if multiple, otherwise use as-is
      const hourlyValue = values.length > 1
        ? computeEma(values, 0.3)
        : values[0];

      const cellKey = `${weekdayStr}-${hourStr}`;
      if (!cellValues.has(cellKey)) {
        cellValues.set(cellKey, []);
      }
      cellValues.get(cellKey)!.push({ weekId, value: hourlyValue });
    }

    // Build the matrix
    let globalMin = Infinity;
    let globalMax = -Infinity;

    const matrix = Array.from({ length: 7 }, (_, day) => {
      const hours = Array.from({ length: 24 }, (_, hour) => {
        const cellKey = `${day}-${hour}`;
        const entries = cellValues.get(cellKey);

        if (!entries || entries.length === 0) {
          return 0;
        }

        // Sort by weekId chronologically
        entries.sort((a, b) => a.weekId.localeCompare(b.weekId));
        const weeklyValues = entries.map((e) => e.value);

        // EMA across weeks
        const emaValue = computeEma(weeklyValues, 0.3);
        // DB stores EUR/kWh, convert to c/kWh (× 100)
        const centsPerKwh = emaValue * 100;

        if (centsPerKwh < globalMin) globalMin = centsPerKwh;
        if (centsPerKwh > globalMax) globalMax = centsPerKwh;

        return Math.round(centsPerKwh * 100) / 100;
      });

      return { day, label: DAY_LABELS[day], hours };
    });

    // Handle edge case where no data exists
    if (globalMin === Infinity) globalMin = 0;
    if (globalMax === -Infinity) globalMax = 0;

    const response = {
      matrix,
      minPrice: Math.round(globalMin * 100) / 100,
      maxPrice: Math.round(globalMax * 100) / 100,
    };

    // Cache the result
    heatmapCache = { data: response, timestamp: Date.now() };

    return c.json(response);
  });

  return router;
}
