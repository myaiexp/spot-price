// Pure-function tests for the EUR/MWh→EUR/kWh and dated VAT helpers (audit
// #3966, finding #9575). backfillPrices turns sahkotin.fi's tax-free EUR/MWh
// into tax-inclusive EUR/kWh via mwhToKwh then applyVat(noTax, slotInstant).
// The VAT rate must be the one in force on the slot's Helsinki date, so every
// rate change is pinned on both sides of Helsinki midnight — a UTC-midnight
// boundary would misrate the first two or three Helsinki hours of each period.
import { describe, it, expect } from 'vitest';
import { mwhToKwh, applyVat, vatRateAt } from './price-conversion.js';

const at = (iso: string) => new Date(iso);

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

describe('vatRateAt (finding #9575)', () => {
  // [change, last hour at the old rate, first instant at the new rate, old, new]
  const boundaries: Array<[string, string, string, number, number]> = [
    ['23% → 24% on 2013-01-01 (EET, +02)', '2012-12-31T21:00:00Z', '2012-12-31T22:00:00Z', 0.23, 0.24],
    ['24% → 10% on 2022-12-01 (EET, +02)', '2022-11-30T21:00:00Z', '2022-11-30T22:00:00Z', 0.24, 0.10],
    ['10% → 24% on 2023-05-01 (EEST, +03)', '2023-04-30T20:00:00Z', '2023-04-30T21:00:00Z', 0.10, 0.24],
    ['24% → 25.5% on 2024-09-01 (EEST, +03)', '2024-08-31T20:00:00Z', '2024-08-31T21:00:00Z', 0.24, 0.255],
  ];

  for (const [change, lastOld, firstNew, oldRate, newRate] of boundaries) {
    it(`${change}: switches exactly at Helsinki midnight`, () => {
      expect(vatRateAt(at(lastOld))).toBe(oldRate);
      expect(vatRateAt(new Date(at(firstNew).getTime() - 1))).toBe(oldRate);
      expect(vatRateAt(at(firstNew))).toBe(newRate);
    });
  }

  it('keys on the Helsinki date, not the UTC date, just after local midnight', () => {
    // Each instant is 01:00 Helsinki on the new-rate day but still the previous
    // UTC date — a UTC-date lookup would return the old rate.
    expect(vatRateAt(at('2024-08-31T22:00:00Z'))).toBe(0.255);
    expect(vatRateAt(at('2023-04-30T22:00:00Z'))).toBe(0.24);
    expect(vatRateAt(at('2022-11-30T23:00:00Z'))).toBe(0.10);
    expect(vatRateAt(at('2012-12-31T23:00:00Z'))).toBe(0.24);
  });

  it('returns the in-force rate mid-period', () => {
    expect(vatRateAt(at('2012-12-15T12:00:00Z'))).toBe(0.23);
    expect(vatRateAt(at('2018-06-15T12:00:00Z'))).toBe(0.24);
    expect(vatRateAt(at('2023-02-01T12:00:00Z'))).toBe(0.10);
    expect(vatRateAt(at('2023-10-01T12:00:00Z'))).toBe(0.24);
    expect(vatRateAt(at('2026-09-14T12:00:00Z'))).toBe(0.255);
  });

  it('throws before the first known rate rather than guessing', () => {
    // 2010-07-01 00:00 Helsinki is 2010-06-30T21:00Z.
    expect(vatRateAt(at('2010-06-30T21:00:00Z'))).toBe(0.23);
    expect(() => vatRateAt(at('2010-06-30T20:59:59Z'))).toThrow(RangeError);
  });

  it('throws on an invalid Date', () => {
    expect(() => vatRateAt(new Date('not-a-date'))).toThrow(RangeError);
  });
});

describe('applyVat (audit #3966, finding #9575)', () => {
  it('multiplies by 1 + the rate in force at the given instant', () => {
    expect(applyVat(1, at('2025-01-15T12:00:00Z'))).toBeCloseTo(1.255, 12);
    expect(applyVat(1, at('2020-01-15T12:00:00Z'))).toBeCloseTo(1.24, 12);
    expect(applyVat(1, at('2023-01-15T12:00:00Z'))).toBeCloseTo(1.1, 12);
    expect(applyVat(0.05, at('2025-01-15T12:00:00Z'))).toBeCloseTo(0.06275, 12);
  });

  it('is defined in terms of vatRateAt, not a hardcoded literal', () => {
    for (const iso of ['2012-12-20T00:00:00Z', '2019-03-03T03:00:00Z', '2023-03-03T03:00:00Z', '2026-01-01T00:00:00Z']) {
      expect(applyVat(2, at(iso))).toBeCloseTo(2 * (1 + vatRateAt(at(iso))), 12);
    }
  });

  it('maps zero to zero and preserves a negative sign', () => {
    const d = at('2025-01-15T12:00:00Z');
    expect(applyVat(0, d)).toBe(0);
    expect(applyVat(-0.1, d)).toBeCloseTo(-0.1255, 12);
  });
});

describe('mwhToKwh + applyVat composed — the backfill pipeline (audit #3966)', () => {
  it('matches the no-tax then with-tax values backfillPrices stores', () => {
    // backfillPrices computes noTax = mwhToKwh(value); withTax = applyVat(noTax, slotDate).
    const noTax = mwhToKwh(100); // 0.1 €/kWh
    expect(noTax).toBeCloseTo(0.1, 12);
    expect(applyVat(noTax, at('2025-01-15T12:00:00Z'))).toBeCloseTo(0.1255, 12);
    expect(applyVat(noTax, at('2023-01-15T12:00:00Z'))).toBeCloseTo(0.11, 12);
  });
});
