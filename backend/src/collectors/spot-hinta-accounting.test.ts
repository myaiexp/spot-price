// Tests that collectPrices reports an honest upsert count (audit #1310).
// Postgres INSERT ... ON CONFLICT DO UPDATE returns rowCount = inserted + updated,
// so the result must expose a single `upserted` count — not a fabricated
// inserted/updated split that always reported every affected row as an insert.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import type { Db } from '../db/connection.js';
import { makeInsertDb as fakeDb } from '../test-support/fake-db.js';
import { stubFetch } from '../test-support/fetch-stub.js';

// spot-hinta.fi TodayAndDayForward slots (subset of fields collectPrices reads).
function makeSlots(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    Rank: i,
    DateTime: `2026-06-02T${String(i % 24).padStart(2, '0')}:00:00+03:00`,
    PriceNoTax: 0.05 + i * 0.001,
    PriceWithTax: (0.05 + i * 0.001) * 1.255,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('collectPrices upsert accounting (audit #1310)', () => {
  it('insert-only batch: upserted equals batch size', async () => {
    stubFetch(makeSlots(10));
    // All 10 rows new → Postgres rowCount = 10.
    const result = await collectPrices(fakeDb(10));
    expect(result.upserted).toBe(10);
  });

  it('update-only batch: upserted equals batch size (not mislabeled as inserts)', async () => {
    stubFetch(makeSlots(10));
    // All 10 rows already exist and are re-set → Postgres rowCount is still 10.
    // The old split reported { inserted: 10, updated: 0 } here — a flat lie.
    const result = await collectPrices(fakeDb(10));
    expect(result.upserted).toBe(10);
    expect(result).not.toHaveProperty('inserted');
    expect(result).not.toHaveProperty('updated');
  });

  it('mixed insert/update batch: upserted equals batch size', async () => {
    stubFetch(makeSlots(8));
    // 3 inserts + 5 updates → Postgres rowCount = 8; it does not split them.
    const result = await collectPrices(fakeDb(8));
    expect(result.upserted).toBe(8);
  });

  it('empty API response: upserted is 0 and the DB is never touched', async () => {
    stubFetch([]);
    const insertSpy = vi.fn();
    const db = { insert: insertSpy } as unknown as Db;
    const result = await collectPrices(db);
    expect(result.upserted).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
