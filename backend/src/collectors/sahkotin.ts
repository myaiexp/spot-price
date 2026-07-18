// Historical hourly backfill from sahkotin.fi (EUR/MWh → EUR/kWh × VAT).
import { FETCH_TIMEOUT_MS, httpErrorDetail } from '../utils/http.js';
import { mwhToKwh, applyVat } from '../utils/price-conversion.js';
import { upsertPrices, makePriceInsert } from './upsert.js';
import type { Db } from '../db/connection.js';

const SAHKOTIN_PRICES_URL = 'https://sahkotin.fi/prices';

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
 * these at a time from `end` until sahkotin.fi runs out of history (Dec 2012). */
const BACKFILL_CHUNK_DAYS = 30;

// Floor date the cap is sized from — see backfillMaxChunks.
const BACKFILL_EPOCH_FLOOR_MS = Date.UTC(2010, 0, 1);

// Headroom multiplier on the floor-derived count — see backfillMaxChunks.
const BACKFILL_MAX_CHUNKS_SAFETY_FACTOR = 2;

/**
 * Upper bound on backfill chunk iterations for a run ending at `end`. This is a
 * safety valve against a misbehaving upstream that returns non-empty (e.g.
 * looping) data forever — NOT a functional limit. A legitimate backfill stops
 * naturally when sahkotin.fi returns an empty chunk past the start of recorded
 * history (Dec 2012); today that's ~165 chunks. We size the cap from a floor
 * date set well before Dec 2012 (BACKFILL_EPOCH_FLOOR_MS) and double it
 * (BACKFILL_MAX_CHUNKS_SAFETY_FACTOR), so it always sits far above any real run
 * (~400 today) and the headroom only widens as time passes — both the real
 * count and the cap grow from "today", but the floor sits years earlier.
 */
export function backfillMaxChunks(end: Date): number {
  const chunkMs = BACKFILL_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  const chunksToFloor = Math.ceil((end.getTime() - BACKFILL_EPOCH_FLOOR_MS) / chunkMs);
  return chunksToFloor * BACKFILL_MAX_CHUNKS_SAFETY_FACTOR;
}

interface SahkotinSlot {
  date: string;   // ISO 8601
  value: number;  // EUR/MWh, no tax
}

function isSahkotinSlot(slot: unknown): slot is SahkotinSlot {
  if (typeof slot !== 'object' || slot === null) return false;
  const s = slot as Record<string, unknown>;
  return typeof s.date === 'string' && typeof s.value === 'number' && Number.isFinite(s.value);
}

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
 * Backfill historical data from sahkotin.fi, walking backwards in 30-day chunks
 * until the upstream runs out of history.
 *
 * `opts` exists to give callers/tests a seam over the three values that otherwise
 * depend on wall-clock / upstream timing:
 *   - `startFrom`     the EXCLUSIVE upper bound to begin walking back from
 *                     (defaults to today's UTC midnight). Pass an earlier date to
 *                     resume an interrupted backfill instead of re-walking the
 *                     whole history every run.
 *   - `maxChunks`     the runaway safety cap (defaults to backfillMaxChunks(end)).
 *   - `requestDelayMs` the inter-request pause (defaults to the production value).
 * All default to the production values, so a plain `backfillPrices(db)` behaves
 * exactly as before.
 */
export async function backfillPrices(
  db: Db,
  opts: { maxChunks?: number; requestDelayMs?: number; startFrom?: Date } = {},
): Promise<{ totalUpserted: number }> {
  let totalUpserted = 0;
  const chunkDays = BACKFILL_CHUNK_DAYS;
  const requestDelayMs = opts.requestDelayMs ?? BACKFILL_REQUEST_DELAY_MS;

  // `end` is the EXCLUSIVE upper bound of the fetch window; the walk moves
  // backwards from here. It defaults to today's UTC midnight — so the most recent
  // slot fetched is yesterday's last hour (today 00:00Z is excluded), and
  // today/tomorrow stay owned by the live collectPrices job (spot-hinta.fi
  // TodayAndDayForward, every 15 min). Do NOT subtract a day — the bound is a
  // precise instant, not a date, so doing so would drop most of yesterday's data.
  // Callers may pass `startFrom` to resume from an earlier boundary; we clone it
  // so the reassignment below never mutates the caller's Date.
  const now = new Date();
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let end = opts.startFrom ? new Date(opts.startFrom.getTime()) : defaultEnd;

  let chunkIndex = 0;

  // Runaway guard — see backfillMaxChunks.
  const maxChunks = opts.maxChunks ?? backfillMaxChunks(end);

  while (true) {
    if (chunkIndex >= maxChunks) {
      throw new Error(
        `backfillPrices aborted: hit the ${maxChunks}-chunk safety cap without an empty ` +
        `upstream response — upstream is returning unexpected/looping data.`,
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
      return makePriceInsert(slot.date, noTax, withTax);
    });

    const result = await upsertPrices(db, values);

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
