// Current-week hourly price heatmap query with per-instance caching

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { helsinkiWeekStart } from '../utils/helsinki-time.js';

const HEATMAP_TTL = 15 * 60 * 1000;

/** One weekday row of the heatmap: 24 hourly cells in cents/kWh (null = no data yet). */
export interface HeatmapDay {
  day: number; // 0 = Mon … 6 = Sun; the frontend maps this to a locale weekday label
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
  // In-memory cache, private to this closure. Keyed on the current Helsinki week
  // so a Sunday-night entry is dropped at the Monday rollover instead of serving
  // last week's grid (wrong week number + day labels) until the TTL expires.
  let heatmapCache: { data: HeatmapResponse; timestamp: number; weekKey: string } | null = null;

  /**
   * Build the current week's hourly prices as a 7×24 grid (Helsinki time).
   * Cached in-memory for 15 minutes within the same Helsinki week.
   */
  return async function getHeatmap(db: Db): Promise<HeatmapResponse> {
    // Serve the cache only when it is both fresh (TTL) and for the current week.
    const weekKey = helsinkiWeekStart();
    if (
      heatmapCache &&
      heatmapCache.weekKey === weekKey &&
      Date.now() - heatmapCache.timestamp < HEATMAP_TTL
    ) {
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
    const avgPriceByDayHour = new Map<string, number>();
    for (const row of rows.rows as Array<{ weekday: number; hour: number; avg_price: string }>) {
      const avgPrice = parseFloat(row.avg_price);
      if (Number.isNaN(avgPrice)) continue;
      const weekday = row.weekday - 1; // ISODOW 1=Mon → 0
      avgPriceByDayHour.set(`${weekday}-${row.hour}`, avgPrice);
    }

    // ISO week number (Helsinki) — used only for the week label in the UI.
    const weekResult = await db.execute(sql`
      SELECT
        EXTRACT(WEEK FROM NOW() AT TIME ZONE 'Europe/Helsinki')::int AS week_number
    `);
    const currentWeek = (weekResult.rows as Array<{ week_number: number }>)[0];

    // Build the matrix — cents/kWh rounded to 2dp, null for cells without data.
    const matrix: HeatmapDay[] = Array.from({ length: 7 }, (_, day) => {
      const hours = Array.from({ length: 24 }, (_, hour) => {
        const price = avgPriceByDayHour.get(`${day}-${hour}`);
        return price === undefined ? null : Math.round(price * 100 * 100) / 100;
      });
      return { day, hours };
    });

    // Price range over populated cells only (0/0 when the week has no data yet).
    // Rounding is monotonic, so min/max of the rounded cells equal the rounded
    // min/max of the raw values — this two-pass form is behaviour-identical to
    // accumulating during the build, just without the in-callback mutation.
    const populated = matrix.flatMap((row) => row.hours.filter((cell): cell is number => cell !== null));
    const minPrice = populated.length > 0 ? Math.min(...populated) : 0;
    const maxPrice = populated.length > 0 ? Math.max(...populated) : 0;

    const response = {
      matrix,
      minPrice,
      maxPrice,
      weekNumber: currentWeek.week_number,
    };

    heatmapCache = { data: response, timestamp: Date.now(), weekKey };

    return response;
  };
}
