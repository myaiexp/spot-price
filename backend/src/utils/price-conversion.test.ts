// Pure-function tests for the EUR/MWh→EUR/kWh and VAT conversion helpers
// (audit #3966). mwhToKwh and applyVat are the two arithmetic primitives the
// backfill uses to turn sahkotin.fi's tax-free EUR/MWh values into the
// tax-inclusive EUR/kWh the app stores. They were only ever exercised
// indirectly through backfillPrices; these tests pin their arithmetic directly,
// so a regression in either operation or in the VAT constant fails here in
// isolation rather than deep inside a DB-level test.
import { describe, it, expect } from 'vitest';
import { mwhToKwh, applyVat, ELECTRICITY_VAT } from './price-conversion.js';

describe('mwhToKwh (audit #3966)', () => {
  it('divides EUR/MWh by 1000 to get EUR/kWh', () => {
    expect(mwhToKwh(50)).toBeCloseTo(0.05, 12); // 50 €/MWh → 0.05 €/kWh
    expect(mwhToKwh(1000)).toBe(1); // exact
    expect(mwhToKwh(123.4)).toBeCloseTo(0.1234, 12);
  });

  it('maps zero to zero', () => {
    expect(mwhToKwh(0)).toBe(0);
  });

  it('preserves the sign of negative spot prices', () => {
    // Nord Pool spot prices go negative; the conversion must not clamp them.
    expect(mwhToKwh(-30)).toBeCloseTo(-0.03, 12);
  });
});

describe('applyVat (audit #3966)', () => {
  it('multiplies by 1 + ELECTRICITY_VAT (25.5%)', () => {
    expect(ELECTRICITY_VAT).toBe(0.255);
    expect(applyVat(0.05)).toBeCloseTo(0.06275, 12); // 0.05 * 1.255
    expect(applyVat(1)).toBeCloseTo(1.255, 12);
  });

  it('is defined in terms of the exported VAT constant, not a hardcoded literal', () => {
    // Guards against the helper and the exported constant drifting apart.
    expect(applyVat(1)).toBeCloseTo(1 + ELECTRICITY_VAT, 12);
    expect(applyVat(2)).toBeCloseTo(2 * (1 + ELECTRICITY_VAT), 12);
  });

  it('maps zero to zero and preserves a negative sign', () => {
    expect(applyVat(0)).toBe(0);
    expect(applyVat(-0.1)).toBeCloseTo(-0.1255, 12);
  });
});

describe('mwhToKwh + applyVat composed — the backfill pipeline (audit #3966)', () => {
  it('matches the no-tax then with-tax values backfillPrices stores', () => {
    // backfillPrices computes noTax = mwhToKwh(value); withTax = applyVat(noTax).
    const noTax = mwhToKwh(100); // 0.1 €/kWh
    expect(noTax).toBeCloseTo(0.1, 12);
    expect(applyVat(noTax)).toBeCloseTo(0.1255, 12);
  });
});
