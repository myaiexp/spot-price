// Shared Drizzle upsert for price rows — used by both the live collector and backfill.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';

// String-formatted row ready to upsert (prices are DB-precision decimal strings,
// not numbers). Distinct from the numeric API PriceSlot and the raw select PriceRow.
export interface PriceInsert {
  datetime: string;
  priceNoTax: string;
  priceWithTax: string;
}

/**
 * Build a canonical upsert row from numeric prices — the single home of the
 * NUMERIC(10,5) canonicalization invariant both collectors depend on. Formats
 * each price to 5 decimals to match the prices table's scale, so the stored
 * string is canonical and round-trips through the API unchanged (a bare String()
 * of a float can emit a 17-digit IEEE-754 artifact). A scale change is a one-line
 * edit here instead of a hunt across every collector.
 */
export function makePriceInsert(datetime: string, priceNoTax: number, priceWithTax: number): PriceInsert {
  return {
    datetime,
    priceNoTax: priceNoTax.toFixed(5),
    priceWithTax: priceWithTax.toFixed(5),
  };
}

/**
 * Insert price rows, overwriting both price columns on a `datetime` (primary key)
 * conflict. Returns the pg result; callers read `rowCount`, which Postgres reports
 * as inserted + updated combined (it does not split the two — see collectPrices).
 */
export function upsertPrices(db: Db, values: PriceInsert[]) {
  return db
    .insert(prices)
    .values(values)
    .onConflictDoUpdate({
      target: prices.datetime,
      set: {
        priceNoTax: sql`EXCLUDED.price_no_tax`,
        priceWithTax: sql`EXCLUDED.price_with_tax`,
      },
    });
}
