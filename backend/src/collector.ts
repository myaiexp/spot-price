import { sql } from 'drizzle-orm';
import type { Db } from './db/connection.js';
import { prices } from './db/schema.js';

interface SpotHintaSlot {
  Rank: number;
  DateTime: string;
  PriceNoTax: number;
  PriceWithTax: number;
}

export async function collectPrices(db: Db): Promise<{ inserted: number; updated: number }> {
  const response = await fetch('https://api.spot-hinta.fi/TodayAndDayForward');

  if (!response.ok) {
    throw new Error(`spot-hinta.fi API error: ${response.status} ${response.statusText}`);
  }

  const slots: SpotHintaSlot[] = await response.json();

  if (!Array.isArray(slots) || slots.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const values = slots.map((slot) => ({
    datetime: slot.DateTime,
    priceNoTax: String(slot.PriceNoTax),
    priceWithTax: String(slot.PriceWithTax),
  }));

  const result = await db
    .insert(prices)
    .values(values)
    .onConflictDoUpdate({
      target: prices.datetime,
      set: {
        priceNoTax: sql`EXCLUDED.price_no_tax`,
        priceWithTax: sql`EXCLUDED.price_with_tax`,
      },
    });

  const totalRows = slots.length;
  const rowsAffected = result.rowCount ?? 0;
  // PostgreSQL INSERT ... ON CONFLICT DO UPDATE reports all affected rows.
  // We can't distinguish inserted vs updated without RETURNING + pre-query,
  // so report total as inserted (first run) — the caller just needs the count.
  return { inserted: rowsAffected, updated: totalRows - rowsAffected };
}

// CLI entry point: run directly with `tsx src/collector.ts`
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === currentFile;

if (isMainModule) {
  const { config } = await import('dotenv');
  config();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const { createDb } = await import('./db/connection.js');
  const db = createDb(databaseUrl);

  try {
    const result = await collectPrices(db);
    console.log(`Collection complete: ${result.inserted} inserted, ${result.updated} updated`);
    process.exit(0);
  } catch (err) {
    console.error('Collection failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
