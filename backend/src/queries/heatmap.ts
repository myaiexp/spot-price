// Current-week hourly price heatmap query with per-instance caching

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';

const DAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

const HEATMAP_TTL = 15 * 60 * 1000;

/** One weekday row of the heatmap: 24 hourly cells in cents/kWh (null = no data yet). */
export interface HeatmapDay {
  day: number; // 0 = Mon … 6 = Sun
  label: string; // Finnish weekday abbreviation
  hours: Array<number | null>; // length 24; cents/kWh rounded to 2dp, null when no data
}

/** Response shape returned by getHeatmap and the GET /heatmap route. */
export interface HeatmapResponse {
  matrix: HeatmapDay[]; // 7 days × 24 hours, Monday first
  minPrice: number; // lowest populated cell, cents/kWh (0 when no data)
  maxPrice: number; // highest populated cell, cents/kWh (0 when no data)
  weekNumber: number; // ISO week number (Helsinki)
}

/**
 * Create a heatmap query bound to its own 15-minute cache. Each call returns an
 * independent getHeatmap closure so separate app instances — and successive
 * tests — never share cached data; a module-level cache previously leaked one
 * app's rows into the next regardless of its DB.
 */
export function createHeatmap(): (db: Db) => Promise<HeatmapResponse> {
  // In-memory heatmap cache with 15-min TTL, private to this closure.
  let heatmapCache: { data: HeatmapResponse; timestamp: number } | null = null;

  /**
   * Build the current week's hourly prices as a 7×24 grid (Helsinki time).
   * Cached in-memory for 15 minutes.
   */
  return async function getHeatmap(db: Db): Promise<HeatmapResponse> {
    // Check cache
    if (heatmapCache && Date.now() - heatmapCache.timestamp < HEATMAP_TTL) {
      return heatmapCache.data;
    }

    // Current week Mon..Sun in Helsinki time, include all available data
    const rows = await db.execute(sql`
      SELECT
        EXTRACT(ISODOW FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS weekday,
        EXTRACT(HOUR FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS hour,
        AVG(price_with_tax) AS avg_price
      FROM prices
      WHERE datetime AT TIME ZONE 'Europe/Helsinki'
        >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Helsinki')
        AND datetime AT TIME ZONE 'Europe/Helsinki'
        < date_trunc('week', NOW() AT TIME ZONE 'Europe/Helsinki') + interval '7 days'
      GROUP BY weekday, hour
      ORDER BY weekday, hour
    `);

    // Build lookup. AVG is computed in exact NUMERIC in SQL (no lossy ::float
    // cast); node-postgres hands NUMERIC back as a string, so the conversion to
    // a JS number happens here at the boundary. A malformed/NaN average (never
    // expected: price_with_tax is NOT NULL and each group has ≥1 row) is skipped
    // rather than poisoning the grid with NaN.
    const cellValues = new Map<string, number>();
    for (const row of rows.rows as Array<{ weekday: number; hour: number; avg_price: string }>) {
      const avgPrice = parseFloat(row.avg_price);
      if (Number.isNaN(avgPrice)) continue;
      const weekday = row.weekday - 1; // ISODOW 1=Mon → 0
      cellValues.set(`${weekday}-${row.hour}`, avgPrice);
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

    return response;
  };
}
