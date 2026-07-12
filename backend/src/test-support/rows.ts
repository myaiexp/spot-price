// Test row fixtures for route tests: the raw NUMERIC-string row shape
// node-postgres yields, the parsed slot envelope the API returns, and factories
// for building rows (flat price, or a realistic VAT split).

// Raw price row as node-postgres yields it: NUMERIC columns are strings.
export type RawRow = { datetime: string; priceNoTax: string; priceWithTax: string };

// Parsed slot envelope the API returns (NUMERIC strings → numbers).
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
