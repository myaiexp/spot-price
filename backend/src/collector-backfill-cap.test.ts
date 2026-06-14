// Tests the backfill runaway safety cap (audit #2985). backfillPrices walks
// backwards in 30-day chunks until sahkotin.fi returns an empty chunk. If a
// misbehaving upstream returns non-empty (e.g. looping) data forever, the cap
// must abort the loop and throw — without changing normal termination, and with
// a bound sized far above any legitimate full backfill.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices, backfillMaxChunks } from './collector.js';
import type { Db } from './db/connection.js';

// A fetch Response stand-in whose json() yields `body`.
const okJson = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

// Db stand-in that counts how many upsert chains were opened, so a test can
// assert exactly how many chunks were processed. rowCount = 1 per chunk.
function countingDb() {
  const state = { inserts: 0 };
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => Promise.resolve({ rowCount: 1 }),
  };
  return {
    db: { insert: () => { state.inserts++; return chain; } } as unknown as Db,
    state,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfill runaway safety cap (audit #2985)', () => {
  it('throws after exactly maxChunks when the upstream never empties out', async () => {
    // sahkotin.fi always returns a non-empty chunk → natural termination never
    // happens, so only the cap can stop the loop.
    const fetchMock = vi.fn(async () => okJson({ prices: [{ date: '2020-01-01T00:00:00Z', value: 50 }] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, state } = countingDb();

    await expect(backfillPrices(db, { maxChunks: 3, requestDelayMs: 0 }))
      .rejects.toThrow(/safety cap/i);

    // chunkIndex 0,1,2 each fetched + upserted; index 3 tripped the cap and threw.
    expect(state.inserts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('terminates normally on an empty upstream chunk, never reaching the cap', async () => {
    // First chunk has data, second is empty → the loop stops at the empty chunk,
    // proving the cap does not change normal backfill termination.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ prices: [{ date: '2020-01-01T00:00:00Z', value: 50 }] }))
      .mockResolvedValueOnce(okJson({ prices: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, state } = countingDb();

    const result = await backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 });

    expect(result.totalUpserted).toBe(1); // one non-empty chunk upserted 1 row
    expect(state.inserts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('backfillMaxChunks default bound (audit #2985)', () => {
  // Chunks a legitimate backfill would need to walk from `end` back to the real
  // start of sahkotin.fi history (Dec 2012). The cap must always exceed this.
  const HISTORY_START_MS = Date.UTC(2012, 11, 1);
  const chunksToHistoryStart = (end: Date) =>
    Math.ceil((end.getTime() - HISTORY_START_MS) / (30 * 24 * 60 * 60 * 1000));

  it('sits comfortably above a legitimate full backfill today', () => {
    const today = new Date(Date.UTC(2026, 5, 14));
    const real = chunksToHistoryStart(today); // ~165 chunks
    expect(backfillMaxChunks(today)).toBeGreaterThan(real);
    // Generous headroom, not a hairline margin — it's a safety valve.
    expect(backfillMaxChunks(today)).toBeGreaterThanOrEqual(real + 30);
  });

  it('keeps the headroom decades into the future (cap grows with time)', () => {
    const future = new Date(Date.UTC(2046, 5, 14));
    expect(backfillMaxChunks(future)).toBeGreaterThan(chunksToHistoryStart(future));
  });

  it('returns a positive integer', () => {
    const cap = backfillMaxChunks(new Date(Date.UTC(2026, 5, 14)));
    expect(Number.isInteger(cap)).toBe(true);
    expect(cap).toBeGreaterThan(0);
  });
});
