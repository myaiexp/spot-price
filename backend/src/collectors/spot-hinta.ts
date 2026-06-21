// Live 15-min spot price collection from spot-hinta.fi (TodayAndDayForward).
import { FETCH_TIMEOUT_MS, httpErrorDetail } from '../utils/http.js';
import { upsertPrices } from './upsert.js';
import type { Db } from '../db/connection.js';

const SPOT_HINTA_TODAY_URL = 'https://api.spot-hinta.fi/TodayAndDayForward';

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

  // Format to 5 decimals to match the prices table's NUMERIC(10,5) scale, so the
  // stored string is canonical and round-trips through the API unchanged (a bare
  // String() of a float can emit a 17-digit IEEE-754 artifact).
  const values = validSlots.map((slot) => ({
    datetime: slot.DateTime,
    priceNoTax: slot.PriceNoTax.toFixed(5),
    priceWithTax: slot.PriceWithTax.toFixed(5),
  }));

  const result = await upsertPrices(db, values);

  // PostgreSQL INSERT ... ON CONFLICT DO UPDATE reports rowCount as the total
  // affected rows (inserted + updated combined), so it cannot be split into an
  // inserted/updated breakdown. Report the single honest count.
  return { upserted: result.rowCount ?? 0 };
}
