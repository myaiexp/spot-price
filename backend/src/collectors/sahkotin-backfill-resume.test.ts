// Tests backfillPrices' optional `startFrom` resume point (audit #2674-era #7).
// The backfill walks backwards from an EXCLUSIVE upper bound: by default today's
// UTC midnight, but callers may pass `startFrom` to resume from an earlier
// boundary instead of re-walking the whole history. These tests pin the first
// fetch window's `end` (= the bound) and `start` (= bound − 30 days) for both
// the default and the explicit-startFrom cases.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices } from './sahkotin.js';
import type { Db } from '../db/connection.js';

const okJson = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

// A db stand-in whose upsert resolves to one affected row per chunk.
function countingDb() {
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => Promise.resolve({ rowCount: 1 }),
  };
  return { insert: () => chain } as unknown as Db;
}

// First chunk has data, second is empty → the walk stops after exactly one fetch
// window, so calls[0] is the window anchored at the upper bound under test.
function stubOneChunkThenEmpty() {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(okJson({ prices: [{ date: '2020-01-01T00:00:00Z', value: 50 }] }))
    .mockResolvedValueOnce(okJson({ prices: [] }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return fetchMock;
}

const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfillPrices startFrom resume point', () => {
  it('walks backwards from an explicit startFrom upper bound (exclusive)', async () => {
    const fetchMock = stubOneChunkThenEmpty();
    const startFrom = new Date('2020-06-15T00:00:00Z');

    await backfillPrices(countingDb(), { startFrom, requestDelayMs: 0 });

    const firstUrl = fetchMock.mock.calls[0][0] as string;
    const expectedEnd = startFrom.toISOString();
    const expectedStart = new Date(startFrom.getTime() - CHUNK_MS).toISOString();
    expect(firstUrl).toContain(`end=${encodeURIComponent(expectedEnd)}`);
    expect(firstUrl).toContain(`start=${encodeURIComponent(expectedStart)}`);
  });

  it('does not mutate the caller-supplied startFrom Date', async () => {
    stubOneChunkThenEmpty();
    const startFrom = new Date('2020-06-15T00:00:00Z');
    const before = startFrom.getTime();

    await backfillPrices(countingDb(), { startFrom, requestDelayMs: 0 });

    expect(startFrom.getTime()).toBe(before);
  });

  it('defaults to today\'s UTC midnight when startFrom is omitted', async () => {
    const fetchMock = stubOneChunkThenEmpty();

    await backfillPrices(countingDb(), { requestDelayMs: 0 });

    const now = new Date();
    const todayUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain(`end=${encodeURIComponent(todayUtcMidnight)}`);
  });
});
