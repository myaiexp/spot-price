// EUR/MWh→EUR/kWh and dated Finnish electricity VAT conversion helpers.
import { getHelsinkiDateRange } from './helsinki-time.js';

/**
 * Finnish VAT on electricity by delivery date (vero.fi "Rates of VAT"). Each
 * rate applies from 00:00 Helsinki on `from` until the next row's `from`:
 *   - 23%   general rate, 2010-07-01 … 2012-12-31
 *   - 24%   general rate from 2013-01-01
 *   - 10%   temporary electricity rate, 2022-12-01 … 2023-04-30
 *   - 24%   general rate again from 2023-05-01
 *   - 25.5% general rate from 2024-09-01
 * sahkotin.fi history begins Dec 2012, so the table only reaches back past that;
 * earlier instants throw rather than guess. Only the backfill reads this — live
 * collect stores spot-hinta.fi's own PriceWithTax. Append a row when the rate
 * changes, then re-run the backfill over the affected span.
 */
const VAT_PERIODS: ReadonlyArray<{ from: string; rate: number }> = [
  { from: '2010-07-01', rate: 0.23 },
  { from: '2013-01-01', rate: 0.24 },
  { from: '2022-12-01', rate: 0.10 },
  { from: '2023-05-01', rate: 0.24 },
  { from: '2024-09-01', rate: 0.255 },
];

// Period starts as UTC instants of Helsinki local midnight — a UTC-midnight
// boundary would give the first 2–3 Helsinki hours of each period the old rate.
const VAT_PERIOD_STARTS = VAT_PERIODS.map((p) => ({
  startMs: getHelsinkiDateRange(p.from).start.getTime(),
  rate: p.rate,
}));

export function mwhToKwh(eurPerMwh: number): number {
  return eurPerMwh / 1000;
}

/** VAT rate (e.g. 0.255) in force for electricity delivered at instant `at`. */
export function vatRateAt(at: Date): number {
  const t = at.getTime();
  if (Number.isNaN(t)) {
    throw new RangeError('vatRateAt: invalid date');
  }
  for (let i = VAT_PERIOD_STARTS.length - 1; i >= 0; i--) {
    if (t >= VAT_PERIOD_STARTS[i].startMs) return VAT_PERIOD_STARTS[i].rate;
  }
  throw new RangeError(
    `vatRateAt: no electricity VAT rate known before ${VAT_PERIODS[0].from} (got ${at.toISOString()})`,
  );
}

/** Tax-inclusive price at the VAT rate in force at `at` (the slot's instant). */
export function applyVat(priceNoTax: number, at: Date): number {
  return priceNoTax * (1 + vatRateAt(at));
}
