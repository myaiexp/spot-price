// Tests the backfill runaway safety cap (audit #2985). backfillPrices walks
// backwards in 30-day chunks until sahkotin.fi returns an empty chunk. If a
// misbehaving upstream returns non-empty (e.g. looping) data forever, the cap
// must abort the loop and throw — without changing normal termination, and with
// a bound sized far above any legitimate full backfill.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices, backfillMaxChunks } from './sahkotin.js';
import { okJson } from '../test-support/fetch-stub.js';
import { makeCountingInsertDb as countingDb } from '../test-support/fake-db.js';

// A fixed historical instant is outside whatever chunk "today" walks, and the
// half-open filter then upserts nothing. Pin the cap against a slot that is
// actually inside the window just requested.
function inWindowSlot(url: string) {
  const end = new URL(url).searchParams.get('end');
  const date = new Date(new Date(end ?? '').getTime() - 60 * 60 * 1000).toISOString();
  return { date, value: 50 };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfill runaway safety cap (audit #2985)', () => {
  it('throws after exactly maxChunks when the upstream never empties out', async () => {
    // sahkotin.fi always returns a non-empty chunk → natural termination never
    // happens, so only the cap can stop the loop.
    const fetchMock = vi.fn(async (url: string) => okJson({ prices: [inWindowSlot(url)] }));
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
    let chunks = 0;
    const fetchMock = vi.fn(async (url: string) => {
      chunks += 1;
      if (chunks > 1) return okJson({ prices: [] });
      return okJson({ prices: [inWindowSlot(url)] });
    });
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
