// Tests price-row canonicalization and ON CONFLICT upsert.
import { describe, it, expect } from 'vitest';
import { makePriceInsert, upsertPrices } from './upsert.js';
import { prices } from '../db/schema.js';
import { makeCapturingInsertDb } from '../test-support/fake-db.js';
import { flattenSqlText } from '../test-support/window-db.js';

const DT = '2026-06-02T12:00:00+03:00';

describe('makePriceInsert (finding #7132)', () => {
  it('formats both prices as 5-decimal strings', () => {
    const row = makePriceInsert(DT, 0.05, 0.06275);
    expect(row).toEqual({
      datetime: DT,
      priceNoTax: '0.05000',
      priceWithTax: '0.06275',
    });
    expect(typeof row.priceNoTax).toBe('string');
    expect(typeof row.priceWithTax).toBe('string');
  });

  it('preserves the sign of negative prices', () => {
    // Nord Pool spot prices go negative; canonicalization must not clamp them.
    const row = makePriceInsert(DT, -0.03, -0.03765);
    expect(row.priceNoTax).toBe('-0.03000');
    expect(row.priceWithTax).toBe('-0.03765');
  });

  it('canonicalizes IEEE-754 artifacts that String() would keep', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754; toFixed(5) is why this
    // helper exists — a bare String() would write the 17-digit artifact.
    const raw = 0.1 + 0.2;
    expect(String(raw)).toBe('0.30000000000000004');
    const row = makePriceInsert(DT, raw, raw);
    expect(row.priceNoTax).toBe('0.30000');
    expect(row.priceWithTax).toBe('0.30000');
  });

  it('maps zero to a 5-decimal zero string', () => {
    const row = makePriceInsert(DT, 0, 0);
    expect(row.priceNoTax).toBe('0.00000');
    expect(row.priceWithTax).toBe('0.00000');
  });
});

describe('upsertPrices ON CONFLICT (finding #7612)', () => {
  it('targets datetime and rewrites both EXCLUDED price columns', async () => {
    const { db, captured } = makeCapturingInsertDb();

    await upsertPrices(db, [makePriceInsert(DT, 0.05, 0.06275)]);

    // Dropping onConflictDoUpdate, targeting the wrong key, or SETting only one
    // column would still green a fake that ignores the config — this is the pin.
    expect(captured.conflict).not.toBeNull();
    expect(captured.conflict?.target).toBe(prices.datetime);
    const set = captured.conflict?.set ?? {};
    expect(Object.keys(set).sort()).toEqual(['priceNoTax', 'priceWithTax']);
    expect(flattenSqlText(set.priceNoTax)).toContain('EXCLUDED.price_no_tax');
    expect(flattenSqlText(set.priceWithTax)).toContain('EXCLUDED.price_with_tax');
  });
});
