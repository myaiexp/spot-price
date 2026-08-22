// Test row fixtures: the raw NUMERIC-string row shape node-postgres yields,
// the parsed slot envelope the API returns, and factories for rows and
// frontend 15-min slots (so tests don't rebuild `{datetime, price*}` per file).

// Raw price row as node-postgres yields it: NUMERIC columns are strings.
export type RawRow = { datetime: string; priceNoTax: string; priceWithTax: string };

// Parsed slot envelope the API returns (NUMERIC strings → numbers). Same shape
// the frontend calc/estimator tests consume.
export type Slot = { datetime: string; priceNoTax: number; priceWithTax: number };

// Row with both price fields set to the same value — priceNoTax is irrelevant to
// tests that key on priceWithTax (percentile, stale fallback, cache).
export const row = (datetime: string, price: number): RawRow => ({
  datetime,
  priceNoTax: String(price),
  priceWithTax: String(price),
});

// Row with a realistic VAT split: priceWithTax = priceNoTax × 1.255.
export const taxedRow = (datetime: string, priceNoTax: number): RawRow => ({
  datetime,
  priceNoTax: String(priceNoTax),
  priceWithTax: String(priceNoTax * 1.255),
});

// Frontend slot with both price fields set to `price` (default 0). Audit #7119:
// the shared constructor so a shape change is one edit, not N private copies.
export const slot = (datetime: string, price = 0): Slot => ({
  datetime,
  priceNoTax: price,
  priceWithTax: price,
});

// 15-min slots stepping from a UTC ISO start, one per price. Callers that want
// index-as-price pass `Array.from({ length: n }, (_, i) => i)`.
export const stepSlots = (startUtcIso: string, prices: number[]): Slot[] => {
  const start = Date.parse(startUtcIso);
  return prices.map((p, i) =>
    slot(new Date(start + i * 15 * 60 * 1000).toISOString(), p),
  );
};
