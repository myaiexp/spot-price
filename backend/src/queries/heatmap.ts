// Current-week hourly price heatmap query with per-instance caching

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { helsinkiWeekStart, getHelsinkiDateRange, shiftDate } from '../utils/helsinki-time.js';
import { createTimeKeyedCache } from '../utils/time-keyed-cache.js';

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
  // Cache keyed on the current Helsinki week: a Sunday-night entry is dropped at
  // the Monday rollover (wrong key) instead of serving last week's grid (wrong
  // week number + day labels) until the TTL expires. Key-equality + TTL guard
  // and per-closure isolation live in createTimeKeyedCache.
  const cache = createTimeKeyedCache<HeatmapResponse>(HEATMAP_TTL);

  /**
   * Build the current week's hourly prices as a 7×24 grid (Helsinki time).
   * Cached in-memory for 15 minutes within the same Helsinki week.
   */
  return async function getHeatmap(db: Db): Promise<HeatmapResponse> {
    const weekKey = helsinkiWeekStart();
    const cached = cache.get(weekKey);
    if (cached) {
      return cached;
    }

    // Current Helsinki week [Mon 00:00, next Mon 00:00) as UTC instants. weekKey
    // is already this week's Monday (YYYY-MM-DD); each boundary is the DST-aware
    // Helsinki-midnight UTC instant, so a DST transition inside the week shifts
    // the bound by exactly the right hour. Filtering the raw timestamptz column
    // against these bound parameters keeps the primary-key index usable — the
    // former `datetime AT TIME ZONE …` on the column forced a full sequential
    // scan of the entire prices history on every cache miss, though the query
    // only ever needs the current week's ~700 rows. AT TIME ZONE stays in the
    // SELECT, where it groups the already-narrowed rows by local weekday/hour.
    //
    // GROUP BY local hour is a 24-column grid: on the fall-back Sunday
    // EXTRACT(HOUR) returns 3 for both the EEST 03:00 and the EET 03:00, so AVG
    // merges those two hours into one cell. That is intentional — the heatmap
    // has no 25th column. The chart's emaAggregate keeps 25 distinct buckets
    // because it is a time series, not a 7×24 matrix.
    const { start } = getHelsinkiDateRange(weekKey);
    const { end } = getHelsinkiDateRange(shiftDate(weekKey, 6));
    const rows = await db.execute(sql`
      SELECT
        EXTRACT(ISODOW FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS weekday,
        EXTRACT(HOUR FROM datetime AT TIME ZONE 'Europe/Helsinki')::int AS hour,
        AVG(price_with_tax) AS avg_price
      FROM prices
      WHERE datetime >= ${start.toISOString()}
        AND datetime < ${end.toISOString()}
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

    cache.set(weekKey, response);

    return response;
  };
}
