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
