import { sql } from 'drizzle-orm';
import type { Db } from './db/connection.js';
import { prices } from './db/schema.js';

// --- Constants & conversion helpers ---

/**
 * External price-API endpoints, grouped here so every upstream dependency is
 * visible in one place. spot-hinta.fi serves the live today+tomorrow 15-min
 * slots (polled every 15 min by collectPrices); sahkotin.fi serves the historical
 * hourly series used by the one-shot backfill (fetchSahkotinPrices / backfillPrices).
 */
const SPOT_HINTA_TODAY_URL = 'https://api.spot-hinta.fi/TodayAndDayForward';
const SAHKOTIN_PRICES_URL = 'https://sahkotin.fi/prices';

export const ELECTRICITY_VAT = 0.255;

/**
 * Abort an upstream price-API request after this many ms. The payloads are small
 * JSON, so a hung or stalled upstream — not a slow-but-progressing one — is the
 * only thing this bound guards against; it stops collection from blocking forever.
 */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Pause between consecutive sahkotin.fi backfill requests. This is a courtesy
 * rate-limit, not a correctness requirement: a full backfill (Dec 2012 → today,
 * ~30-day chunks) fires ~160 sequential requests at one a second, which keeps us
 * a well-behaved client of a free third-party API. Lowering it would speed up
 * large backfills but risks hammering / getting throttled by the upstream, so
 * keep it conservative — the backfill is a rare, offline, one-shot job.
 */
const BACKFILL_REQUEST_DELAY_MS = 1000;

/** Width of each backfill fetch window, in days. The loop walks backwards one of
 * these at a time from today until sahkotin.fi runs out of history (Dec 2012). */
const BACKFILL_CHUNK_DAYS = 30;

/**
 * Floor date used ONLY to size the runaway safety cap (see backfillMaxChunks).
 * sahkotin.fi's real history starts in Dec 2012; this floor is deliberately set
 * years earlier so the derived cap always sits comfortably above a legitimate
 * full backfill and can never trip on real data.
 */
const BACKFILL_EPOCH_FLOOR_MS = Date.UTC(2010, 0, 1);

/**
 * Multiplier applied to the floor-to-today chunk count when sizing the safety
 * cap. Pure headroom — the cap is a runaway guard, never a functional limit —
 * so we double the already-generous floor-derived count.
 */
const BACKFILL_MAX_CHUNKS_SAFETY_FACTOR = 2;

/**
 * Upper bound on backfill chunk iterations for a run ending at `end`. This is a
 * safety valve against a misbehaving upstream that returns non-empty (e.g.
 * looping) data forever — NOT a functional limit. A legitimate backfill stops
 * naturally when sahkotin.fi returns an empty chunk past the start of recorded
 * history (Dec 2012); today that's ~165 chunks. We size the cap from a floor
 * date set well before Dec 2012 and double it, so it always sits far above any
 * real run (~400 today) and the headroom only widens as time passes — both the
 * real count and the cap grow from "today", but the floor sits years earlier.
 */
export function backfillMaxChunks(end: Date): number {
  const chunkMs = BACKFILL_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  const chunksToFloor = Math.ceil((end.getTime() - BACKFILL_EPOCH_FLOOR_MS) / chunkMs);
  return chunksToFloor * BACKFILL_MAX_CHUNKS_SAFETY_FACTOR;
}

/**
 * Max length of an upstream HTTP statusText we'll echo into a log/error message.
 * A legitimate reason phrase ("Internal Server Error", "Service Unavailable") is
 * well under this; the bound stops a hostile/garbage upstream from flooding logs.
 */
const MAX_STATUS_TEXT_LEN = 100;

/**
 * Sanitize an upstream-controlled HTTP statusText before it enters an error or
 * log message. The reason phrase is copied verbatim from the upstream response
 * line, so treat it as untrusted: replace every control character — C0 (incl.
 * CR/LF/TAB, which could forge or split log lines), DEL, and C1 — with a space,
 * collapse the resulting runs, and bound the length. Returns '' when nothing
 * printable survives, so callers can drop it and keep just the status code.
 */
export function sanitizeStatusText(statusText: string): string {
  let out = '';
  for (const ch of statusText) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    out += isControl ? ' ' : ch;
  }
  return out.replace(/ +/g, ' ').trim().slice(0, MAX_STATUS_TEXT_LEN);
}

/**
 * Format an upstream HTTP failure into a safe, bounded error suffix. Keeps the
 * status CODE verbatim (the useful diagnostic) and appends the statusText only
 * after sanitizing it — so upstream-controlled text can't inject into logs.
 */
function httpErrorDetail(response: Response): string {
  const detail = sanitizeStatusText(response.statusText);
  return detail ? `${response.status} ${detail}` : String(response.status);
}

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

/**
 * Runtime type guard for spot-hinta.fi slots. Checks all fields we write to the
 * DB: DateTime must be a non-empty string that parses to a real instant (it is
 * the primary key in `prices`), and both price fields must be finite numbers (a
 * missing or NaN price would write "undefined" / "NaN" into NUMERIC columns).
 */
function isValidSpotHintaSlot(slot: unknown): slot is SpotHintaSlot {
  if (typeof slot !== 'object' || slot === null) return false;
  const s = slot as Record<string, unknown>;
  return (
    typeof s.DateTime === 'string' &&
    s.DateTime.length > 0 &&
    !Number.isNaN(new Date(s.DateTime).getTime()) &&
    typeof s.PriceNoTax === 'number' &&
    Number.isFinite(s.PriceNoTax) &&
    typeof s.PriceWithTax === 'number' &&
    Number.isFinite(s.PriceWithTax)
  );
}

// --- sahkotin.fi types & backfill ---

interface SahkotinSlot {
  date: string;   // ISO 8601
  value: number;  // EUR/MWh, no tax
}

/** Runtime type guard for sahkotin.fi price slots */
function isSahkotinSlot(slot: unknown): slot is SahkotinSlot {
  if (typeof slot !== 'object' || slot === null) return false;
  const s = slot as Record<string, unknown>;
  return typeof s.date === 'string' && typeof s.value === 'number' && Number.isFinite(s.value);
}

/** Fetch price data from sahkotin.fi for a date range */
export async function fetchSahkotinPrices(start: string, end: string): Promise<SahkotinSlot[]> {
  const url = `${SAHKOTIN_PRICES_URL}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`sahkotin.fi API error: ${httpErrorDetail(response)}`);
  }

  const raw: unknown = await response.json();
  if (typeof raw !== 'object' || raw === null) return [];
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.prices)) return [];
  return (data.prices as unknown[]).filter(isSahkotinSlot);
}

/**
 * Backfill all available historical data from sahkotin.fi.
 *
 * `opts` exists only to give tests a seam over the two values that otherwise
 * depend on wall-clock / upstream timing — `maxChunks` (the safety cap) and
 * `requestDelayMs` (the inter-request pause). Both default to the production
 * values, so a normal `backfillPrices(db)` call behaves exactly as before.
 */
export async function backfillPrices(
  db: Db,
  opts: { maxChunks?: number; requestDelayMs?: number } = {},
): Promise<{ totalUpserted: number }> {
  let totalUpserted = 0;
  const chunkDays = BACKFILL_CHUNK_DAYS;
  const requestDelayMs = opts.requestDelayMs ?? BACKFILL_REQUEST_DELAY_MS;

  // `end` is today's UTC midnight, used as the EXCLUSIVE upper bound of the fetch
  // window — so the most recent slot fetched is yesterday's last hour (today 00:00Z
  // is excluded). This intentionally backfills up through yesterday and works
  // backwards; today/tomorrow are owned by the live collectPrices job (spot-hinta.fi
  // TodayAndDayForward, every 15 min). Do NOT subtract a day from `end` — that would
  // drop most of yesterday's data, since the bound is a precise instant, not a date.
  const now = new Date();
  let end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let chunkIndex = 0;

  // Safety valve: a legitimate backfill terminates when the upstream returns an
  // empty chunk past Dec 2012. If it never does (looping/garbage upstream data),
  // stop and throw rather than spin forever. The bound is sized far above any
  // real run (see backfillMaxChunks), so hitting it always signals a fault.
  const maxChunks = opts.maxChunks ?? backfillMaxChunks(end);

  while (true) {
    if (chunkIndex >= maxChunks) {
      throw new Error(
        `backfillPrices aborted: hit the ${maxChunks}-chunk safety cap without an empty ` +
        `upstream response. A legitimate full backfill (sahkotin.fi history starts Dec 2012) ` +
        `stays well below this bound, so a non-terminating loop here means the upstream is ` +
        `returning unexpected/looping data — refusing to run away.`,
      );
    }

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

    // Be polite to the upstream API between requests (see constant).
    await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
  }

  return { totalUpserted };
}

export async function collectPrices(db: Db): Promise<{ upserted: number }> {
  const response = await fetch(SPOT_HINTA_TODAY_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`spot-hinta.fi API error: ${httpErrorDetail(response)}`);
  }

  const raw: unknown = await response.json();

  if (!Array.isArray(raw) || raw.length === 0) {
    return { upserted: 0 };
  }

  // Drop any slot that fails runtime validation so malformed upstream data can't
  // poison the batch. Logs the count so upstream data quality issues stay visible.
  const validSlots = raw.filter(isValidSpotHintaSlot);
  const skipped = raw.length - validSlots.length;
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} slot(s) with invalid fields from spot-hinta.fi`);
  }

  if (validSlots.length === 0) {
    return { upserted: 0 };
  }

  const values = validSlots.map((slot) => ({
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

  // PostgreSQL INSERT ... ON CONFLICT DO UPDATE reports rowCount as the total
  // affected rows (inserted + updated combined), so it cannot be split into an
  // inserted/updated breakdown. Report the single honest count.
  return { upserted: result.rowCount ?? 0 };
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
      console.log(`Collection complete: ${result.upserted} rows upserted`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Operation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
