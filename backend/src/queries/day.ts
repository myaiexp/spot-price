// Price-slot queries for a single Helsinki day and arbitrary UTC ranges.

import { gte, lt, and, asc } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';
import { getHelsinkiDateRange } from '../utils/helsinki-time.js';

export interface PriceSlot {
  datetime: string;
  priceNoTax: number;
  priceWithTax: number;
}

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
export async function getSlotsForRange(db: Db, start: Date, end: Date): Promise<PriceSlot[]> {
  const rows = await db
    .select()
    .from(prices)
    .where(and(gte(prices.datetime, start.toISOString()), lt(prices.datetime, end.toISOString())))
    .orderBy(asc(prices.datetime));

  return mapSlots(rows);
}

// Price slots for a YYYY-MM-DD Helsinki-timezone day.
export async function getSlotsForDate(db: Db, dateStr: string): Promise<PriceSlot[]> {
  const { start, end } = getHelsinkiDateRange(dateStr);
  return getSlotsForRange(db, start, end);
}
