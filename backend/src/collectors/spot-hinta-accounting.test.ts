// Tests that collectPrices reports the database affected-row count (audit #1310,
// finding #12154). Postgres INSERT ... ON CONFLICT DO UPDATE returns one
// rowCount (inserted + updated) and does not split them. That count is not the
// batch length, and the result must not grow inserted/updated keys.
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectPrices upsert accounting (audit #1310)', () => {
  it('reports rowCount when it differs from the batch size (finding #12154)', async () => {
    stubFetch(makeSlots(10));
    // 10 valid slots written; the database says 7 rows were affected. A
    // passthrough of values.length reports 10 and cannot see the difference.
    // Postgres does not split that 7 into inserted vs updated.
    const result = await collectPrices(fakeDb(7));
    expect(result.upserted).toBe(7);
    expect(result).not.toHaveProperty('inserted');
    expect(result).not.toHaveProperty('updated');
  });

  it('treats a null rowCount as zero affected rows (finding #12154)', async () => {
    stubFetch(makeSlots(4));
    const result = await collectPrices(fakeDb(null));
    expect(result.upserted).toBe(0);
  });

  // TodayAndDayForward is the live day. [] is not "nothing new to write" the
  // way an empty sahkotin chunk is end of history — it means the upstream
  // published nothing, and exit 0 would hide that for the whole 15-min timer.
  it('empty API response throws and the DB is never touched (finding #11901)', async () => {
    stubFetch([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insertSpy = vi.fn();
    const db = { insert: insertSpy } as unknown as Db;

    await expect(collectPrices(db)).rejects.toThrow(
      'spot-hinta.fi returned an empty price list',
    );
    expect(insertSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
