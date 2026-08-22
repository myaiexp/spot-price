// Tests that collectPrices screens out slots with malformed DateTime or price
// fields before upserting (audit #3129, finding #7130). DateTime is the
// `prices` primary key, so a missing/empty/unparseable value from upstream
// must be skipped — not written — and the skip must be visible (logged)
// without poisoning the rest of the batch. PriceNoTax / PriceWithTax must be
// finite numbers: Infinity would become the string "Infinity" via toFixed(5),
// and a string-encoded price (a realistic JSON variant) would otherwise be
// dropped only if the type/finite guard fires.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import type { Db } from '../db/connection.js';
import type { PriceInsert } from './upsert.js';
import { makeCapturingInsertDb as capturingDb } from '../test-support/fake-db.js';
import { stubFetch } from '../test-support/fetch-stub.js';

// A valid spot-hinta.fi slot with a parseable DateTime.
function goodSlot(i: number) {
  return {
    Rank: i,
    DateTime: `2026-06-02T${String(i % 24).padStart(2, '0')}:00:00+03:00`,
    PriceNoTax: 0.05 + i * 0.001,
    PriceWithTax: (0.05 + i * 0.001) * 1.255,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectPrices DateTime validation (audit #3129)', () => {
  it('skips malformed slots and upserts only the valid ones', async () => {
    const slots: unknown[] = [
      goodSlot(0),
      { ...goodSlot(1), DateTime: '' },            // empty string
      goodSlot(2),
      { ...goodSlot(3), DateTime: 'not-a-date' },  // unparseable
      { ...goodSlot(4), DateTime: undefined },     // missing
      goodSlot(5),
    ];
    stubFetch(slots);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = capturingDb();

    const result = await collectPrices(db);

    // 3 good slots survive; 3 malformed ones are dropped.
    expect(captured.rows).toHaveLength(3);
    expect(result.upserted).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped 3 slot(s)'));
  });

  it('all-malformed batch: upserted is 0 and the DB is never touched', async () => {
    stubFetch([
      { ...goodSlot(0), DateTime: '' },
      { ...goodSlot(1), DateTime: 'garbage' },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insertSpy = vi.fn();
    const db = { insert: insertSpy } as unknown as Db;

    const result = await collectPrices(db);

    expect(result.upserted).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('all-valid batch: nothing is skipped and no warning is logged', async () => {
    stubFetch([goodSlot(0), goodSlot(1), goodSlot(2)]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = capturingDb();

    const result = await collectPrices(db);

    expect(captured.rows).toHaveLength(3);
    expect(result.upserted).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('collectPrices price-field validation (finding #7130)', () => {
  // Each case is a slot that must be skipped: non-finite numbers (NaN/Infinity
  // would stringify via toFixed(5) into NUMERIC columns) and non-numbers
  // (string-encoded prices are a realistic JSON variant; missing fields too).
  const badPriceSlots: Array<[string, Record<string, unknown>]> = [
    ['NaN PriceNoTax', { ...goodSlot(1), PriceNoTax: Number.NaN }],
    ['NaN PriceWithTax', { ...goodSlot(1), PriceWithTax: Number.NaN }],
    ['Infinity PriceNoTax', { ...goodSlot(1), PriceNoTax: Infinity }],
    ['-Infinity PriceWithTax', { ...goodSlot(1), PriceWithTax: -Infinity }],
    ['missing PriceNoTax', { ...goodSlot(1), PriceNoTax: undefined }],
    ['missing PriceWithTax', { ...goodSlot(1), PriceWithTax: undefined }],
    ['string PriceNoTax', { ...goodSlot(1), PriceNoTax: '0.05' }],
    ['string PriceWithTax', { ...goodSlot(1), PriceWithTax: '0.06275' }],
    ['null PriceNoTax', { ...goodSlot(1), PriceNoTax: null }],
  ];

  it('skips NaN/Infinity/missing/string prices and upserts only valid siblings', async () => {
    const slots: unknown[] = [
      goodSlot(0),
      ...badPriceSlots.map(([, slot]) => slot),
      goodSlot(2),
    ];
    stubFetch(slots);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = capturingDb();

    const result = await collectPrices(db);

    expect(captured.rows).toHaveLength(2);
    expect((captured.rows as PriceInsert[]).map((r) => r.datetime)).toEqual([
      goodSlot(0).DateTime,
      goodSlot(2).DateTime,
    ]);
    expect(result.upserted).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Skipped ${badPriceSlots.length} slot(s)`),
    );
  });

  for (const [label, slot] of badPriceSlots) {
    it(`drops a lone ${label} slot without touching the DB`, async () => {
      stubFetch([slot]);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const insertSpy = vi.fn();
      const db = { insert: insertSpy } as unknown as Db;

      const result = await collectPrices(db);

      expect(result.upserted).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped 1 slot(s)'));
    });
  }
});
