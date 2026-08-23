// Tests sahkotin slot filtering and all-invalid abort (finding #7131, #7116).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSahkotinPrices, backfillPrices } from './sahkotin.js';
import { mwhToKwh, applyVat } from '../utils/price-conversion.js';
import { makeCapturingInsertDb as capturingDb, makeCountingInsertDb as countingDb } from '../test-support/fake-db.js';
import { stubFetch, okJson } from '../test-support/fetch-stub.js';

const RANGE = ['2024-01-01T00:00:00Z', '2024-01-31T00:00:00Z'] as const;

function goodSlot(hour: number, value = 50) {
  return { date: `2024-01-01T${String(hour).padStart(2, '0')}:00:00Z`, value };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchSahkotinPrices slot validation (finding #7131, finding #7116)', () => {
  it('drops mixed malformed slots and returns only the valid ones', async () => {
    const validA = goodSlot(0, 50);
    const validB = goodSlot(5, 42.5);
    stubFetch({
      prices: [
        validA,
        { ...goodSlot(1), date: '' },             // empty date
        { ...goodSlot(2), date: 'not-a-date' },   // unparseable
        { ...goodSlot(3), date: 1704067200000 },  // non-string date
        { ...goodSlot(4), value: NaN },           // non-finite
        { ...goodSlot(4), value: Infinity },
        { ...goodSlot(4), value: '50' },          // non-number value
        validB,
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchSahkotinPrices(...RANGE);

    expect(result).toEqual([validA, validB]);
  });

  it('logs how many slots were dropped from a mixed chunk', async () => {
    stubFetch({
      prices: [goodSlot(0), { ...goodSlot(1), date: '' }, { ...goodSlot(2), value: NaN }],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchSahkotinPrices(...RANGE);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped 2 slot(s)'));
  });

  it('all-valid chunk: nothing is skipped and no warning is logged', async () => {
    stubFetch({ prices: [goodSlot(0), goodSlot(1)] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchSahkotinPrices(...RANGE);

    expect(result).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps finite zero and negative values (finding #7617)', async () => {
    // Nord Pool goes negative; a `value > 0` (or `>= 0`) guard would still pass
    // every other sahkotin fixture, all of which use goodSlot(..., 50).
    const zero = goodSlot(0, 0);
    const negative = goodSlot(1, -12.5);
    stubFetch({ prices: [zero, negative, goodSlot(2, 50)] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchSahkotinPrices(...RANGE);

    expect(result).toEqual([zero, negative, goodSlot(2, 50)]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('empty prices array still returns [] (genuine end of history)', async () => {
    stubFetch({ prices: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await fetchSahkotinPrices(...RANGE)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws when a non-empty prices array has no valid slots', async () => {
    stubFetch({
      prices: [
        { date: '', value: 50 },
        { date: 'garbage', value: 40 },
        { date: '2024-01-01T00:00:00Z', value: NaN },
      ],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(fetchSahkotinPrices(...RANGE)).rejects.toThrow(/no valid slots/i);
  });
});

describe('backfillPrices malformed chunks (finding #7131, finding #7116)', () => {
  it('mixed invalid slots: upserts the valid ones and keeps walking', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({
        prices: [goodSlot(0, 50), { ...goodSlot(1), date: '' }, goodSlot(2, 40)],
      }))
      .mockResolvedValueOnce(okJson({ prices: [goodSlot(0, 30)] }))
      .mockResolvedValueOnce(okJson({ prices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, state } = countingDb();

    await backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 });

    // Two non-empty chunks (mixed then valid), then empty → walk did not halt
    // on the dropped rows. countingDb's rowCount is per-insert (not per-slot),
    // so inserts/fetch-count are the walk signal; slot-level drop is asserted
    // on fetchSahkotinPrices and on the capturing mixed-write test below.
    expect(state.inserts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('mixed chunk writes only the valid slots', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({
        prices: [goodSlot(0, 50), { ...goodSlot(1), date: '' }, goodSlot(2, 40)],
      }))
      .mockResolvedValueOnce(okJson({ prices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = capturingDb();

    await backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 });

    const rows = captured.rows as Array<{ datetime: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.datetime)).toEqual([goodSlot(0).date, goodSlot(2).date]);
  });

  it('all-invalid chunk aborts loudly instead of stopping as end of history', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ prices: [goodSlot(0, 50)] }))
      .mockResolvedValueOnce(okJson({ prices: [{ date: '', value: 1 }, { date: 'nope', value: 2 }] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, state } = countingDb();

    await expect(backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 }))
      .rejects.toThrow(/no valid slots/i);
    expect(state.inserts).toBe(1); // the good chunk committed; we did not swallow the next
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('backfillPrices write-path conversion (finding #7132)', () => {
  it('upserts MWh→kWh × VAT values canonicalized to 5 decimals', async () => {
    const mwh = 50;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ prices: [goodSlot(0, mwh)] }))
      .mockResolvedValueOnce(okJson({ prices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, captured } = capturingDb();

    await backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 });

    const noTax = mwhToKwh(mwh);
    const withTax = applyVat(noTax);
    expect(captured.rows).toEqual([
      {
        datetime: goodSlot(0, mwh).date,
        priceNoTax: noTax.toFixed(5),
        priceWithTax: withTax.toFixed(5),
      },
    ]);
    // Guard the conversion itself: EUR/MWh must not land in the EUR/kWh columns.
    expect(captured.rows[0]).not.toMatchObject({ priceNoTax: mwh.toFixed(5) });
  });
});
