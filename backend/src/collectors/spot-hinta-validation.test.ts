// Tests that collectPrices screens out slots with malformed DateTime fields
// before upserting (audit #3129). DateTime is the `prices` primary key, so a
// missing/empty/unparseable value from upstream must be skipped — not written —
// and the skip must be visible (logged) without poisoning the rest of the batch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import type { Db } from '../db/connection.js';

// A valid spot-hinta.fi slot with a parseable DateTime.
function goodSlot(i: number) {
  return {
    Rank: i,
    DateTime: `2026-06-02T${String(i % 24).padStart(2, '0')}:00:00+03:00`,
    PriceNoTax: 0.05 + i * 0.001,
    PriceWithTax: (0.05 + i * 0.001) * 1.255,
  };
}

// Db stand-in that records the rows handed to `.values()` so a test can assert
// exactly which slots survived filtering. rowCount mirrors Postgres' upsert count
// (= number of rows written).
function capturingDb() {
  const captured: { rows: unknown[] } = { rows: [] };
  const chain = {
    values: (rows: unknown[]) => { captured.rows = rows; return chain; },
    onConflictDoUpdate: () => Promise.resolve({ rowCount: captured.rows.length }),
  };
  return { db: { insert: () => chain } as unknown as Db, captured };
}

function stubFetch(slots: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => slots,
    })),
  );
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
