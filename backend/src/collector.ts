import { sql } from 'drizzle-orm';
import type { Db } from './db/connection.js';
import { prices } from './db/schema.js';

// --- Constants & conversion helpers ---

export const ELECTRICITY_VAT = 0.255;

/** Convert EUR/MWh to EUR/kWh */
export function mwhToKwh(eurPerMwh: number): number {
  return eurPerMwh / 1000;
}

/** Apply Finnish electricity VAT (25.5%) */
export function applyVat(priceNoTax: number): number {
  return priceNoTax * (1 + ELECTRICITY_VAT);
}

// --- spot-hinta.fi types ---

interface SpotHintaSlot {
  Rank: number;
  DateTime: string;
  PriceNoTax: number;
  PriceWithTax: number;
}

// --- sahkotin.fi types & backfill ---

interface SahkotinSlot {
  date: string;   // ISO 8601
  value: number;  // EUR/MWh, no tax
}

interface SahkotinResponse {
  prices: SahkotinSlot[];
}

/** Fetch price data from sahkotin.fi for a date range */
export async function fetchSahkotinPrices(start: string, end: string): Promise<SahkotinSlot[]> {
  const url = `https://sahkotin.fi/prices?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const response = await fetch(url, { redirect: 'follow' });

  if (!response.ok) {
    throw new Error(`sahkotin.fi API error: ${response.status} ${response.statusText}`);
  }

  const data: SahkotinResponse = await response.json();
  return data.prices ?? [];
}

/** Backfill all available historical data from sahkotin.fi */
export async function backfillPrices(db: Db): Promise<{ totalUpserted: number }> {
  let totalUpserted = 0;
  const chunkDays = 30;

  // Start from yesterday, work backwards
  const now = new Date();
  let end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let chunkIndex = 0;

  while (true) {
    const start = new Date(end.getTime() - chunkDays * 24 * 60 * 60 * 1000);

    console.log(`Chunk ${chunkIndex + 1}: ${start.toISOString()} → ${end.toISOString()}`);

    const slots = await fetchSahkotinPrices(start.toISOString(), end.toISOString());

    if (slots.length === 0) {
      console.log('No more data available, stopping.');
      break;
    }

    const values = slots.map((slot) => {
      const noTax = mwhToKwh(slot.value);
      const withTax = applyVat(noTax);
      return {
        datetime: slot.date,
        priceNoTax: String(noTax),
        priceWithTax: String(withTax),
      };
    });

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

    const upserted = result.rowCount ?? 0;
    totalUpserted += upserted;
    console.log(`  Upserted ${upserted} rows (total: ${totalUpserted})`);

    // Move window backwards
    end = start;
    chunkIndex++;

    // Rate-limit: 1 second between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { totalUpserted };
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
    if (process.argv.includes('--backfill')) {
      const result = await backfillPrices(db);
      console.log(`Backfill complete: ${result.totalUpserted} total rows upserted`);
    } else {
      const result = await collectPrices(db);
      console.log(`Collection complete: ${result.inserted} inserted, ${result.updated} updated`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Operation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
