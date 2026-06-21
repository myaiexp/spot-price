// Shared Drizzle upsert for price rows — used by both the live collector and backfill.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { prices } from '../db/schema.js';

export interface PriceValue {
  datetime: string;
  priceNoTax: string;
  priceWithTax: string;
}

/**
 * Insert price rows, overwriting both price columns on a `datetime` (primary key)
 * conflict. Returns the pg result; callers read `rowCount`, which Postgres reports
 * as inserted + updated combined (it does not split the two — see collectPrices).
 */
export function upsertPrices(db: Db, values: PriceValue[]) {
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
