// Tests that an upstream fetch error inside backfillPrices' while loop propagates
// out of the function (audit #3967). backfillPrices calls fetchSahkotinPrices on
// every chunk; fetchSahkotinPrices throws on a non-ok response, and a rejected
// fetch propagates unchanged. Neither is swallowed by the loop — so a failing
// chunk must reject the whole backfill (rather than silently terminating as if
// history ran out, or spinning), whether it fails on the very first chunk or
// after earlier chunks already succeeded.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices } from './sahkotin.js';
import { okJson, failedResponse as failed } from '../test-support/fetch-stub.js';
import { makeCountingInsertDb as countingDb } from '../test-support/fake-db.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfillPrices fetch-error propagation (audit #3967)', () => {
  it('rejects with the sahkotin error when the first chunk fails, never touching the DB', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => failed(503, 'Service Unavailable')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, state } = countingDb();

    await expect(backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 }))
      .rejects.toThrow('sahkotin.fi API error: 503 Service Unavailable');
    expect(state.inserts).toBe(0); // failed before any upsert
  });

  it('propagates an error that occurs after earlier chunks already succeeded', async () => {
    // First chunk OK (and upserted), second chunk fails → the loop must reject
    // mid-walk, not stop quietly as if it had reached the start of history.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ prices: [{ date: '2024-01-01T00:00:00Z', value: 50 }] }))
      .mockResolvedValueOnce(failed(500, 'Internal Server Error'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, state } = countingDb();

    await expect(backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 }))
      .rejects.toThrow('sahkotin.fi API error: 500 Internal Server Error');
    expect(state.inserts).toBe(1); // exactly the one good chunk was written
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates a raw fetch rejection (network failure / timeout) from inside the loop', async () => {
    // fetchSahkotinPrices does not catch, so a rejected fetch (e.g. an
    // AbortSignal timeout or a network error) surfaces unchanged.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, state } = countingDb();

    await expect(backfillPrices(db, { maxChunks: 1000, requestDelayMs: 0 }))
      .rejects.toThrow('network down');
    expect(state.inserts).toBe(0);
  });
});
