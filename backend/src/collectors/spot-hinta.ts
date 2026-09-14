// Live 15-min spot price collection from spot-hinta.fi (TodayAndDayForward).
import { fetchUpstreamJson } from '../utils/http.js';
import { filterValidSlots } from './slot-filter.js';
import { upsertPrices, makePriceInsert } from './upsert.js';
import type { Db } from '../db/connection.js';

const SPOT_HINTA_TODAY_URL = 'https://api.spot-hinta.fi/TodayAndDayForward';
const SPOT_HINTA_SOURCE = 'spot-hinta.fi';

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
  const raw = await fetchUpstreamJson(SPOT_HINTA_TODAY_URL, SPOT_HINTA_SOURCE);

  if (!Array.isArray(raw) || raw.length === 0) {
    return { upserted: 0 };
  }

  const validSlots = filterValidSlots(raw, isValidSpotHintaSlot, SPOT_HINTA_SOURCE);

  if (validSlots.length === 0) {
    return { upserted: 0 };
  }

  const values = validSlots.map((slot) =>
    makePriceInsert(slot.DateTime, slot.PriceNoTax, slot.PriceWithTax),
  );

  const result = await upsertPrices(db, values);

  // PostgreSQL INSERT ... ON CONFLICT DO UPDATE reports rowCount as the total
  // affected rows (inserted + updated combined), so it cannot be split into an
  // inserted/updated breakdown. Report the single honest count.
  return { upserted: result.rowCount ?? 0 };
}
