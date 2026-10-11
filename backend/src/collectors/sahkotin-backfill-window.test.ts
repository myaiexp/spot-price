// Tests that backfillPrices upserts only slots inside the chunk's [start, end).
// The URL asks sahkotin.fi for that half-open window, but the write path used to
// trust the upstream to honour it (finding #12150).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices } from './sahkotin.js';
import { okJson } from '../test-support/fetch-stub.js';
import { makeCapturingInsertDb } from '../test-support/fake-db.js';

const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfillPrices half-open write window (finding #12150)', () => {
  it('upserts slots at start and end − 1h, and drops start − 1h, end, and end + 1h', async () => {
    const walkBackFrom = new Date('2024-06-01T00:00:00.000Z');
    let edges: { atStart: string; beforeEnd: string } | null = null;

    const fetchMock = vi.fn(async (url: string) => {
      // Second chunk is empty so the walk stops. The first response is built
      // from the window the code actually requested, not a hardcoded 30 days.
      if (edges) return okJson({ prices: [] });
      const params = new URL(url).searchParams;
      const startMs = new Date(params.get('start') ?? '').getTime();
      const endMs = new Date(params.get('end') ?? '').getTime();
      const iso = (ms: number) => new Date(ms).toISOString();
      const beforeStart = iso(startMs - HOUR_MS);
      const atStart = iso(startMs);
      const beforeEnd = iso(endMs - HOUR_MS);
      const atEnd = iso(endMs);
      const afterEnd = iso(endMs + HOUR_MS);
      edges = { atStart, beforeEnd };
      return okJson({
        prices: [beforeStart, atStart, beforeEnd, atEnd, afterEnd].map((date) => ({ date, value: 80 })),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = makeCapturingInsertDb();

    await backfillPrices(db, { walkBackFrom, maxChunks: 10, requestDelayMs: 0 });

    const rows = captured.rows as Array<{ datetime: string }>;
    expect(edges).not.toBeNull();
    expect(rows.map((r) => r.datetime)).toEqual([edges!.atStart, edges!.beforeEnd]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropped 3 sahkotin.fi slot(s) outside'));
  });

  it('keeps walking when every returned slot sits on the exclusive end', async () => {
    const walkBackFrom = new Date('2024-06-01T00:00:00.000Z');
    let chunks = 0;
    const fetchMock = vi.fn(async (url: string) => {
      chunks += 1;
      if (chunks > 2) return okJson({ prices: [] });
      const end = new URL(url).searchParams.get('end');
      return okJson({ prices: [{ date: end, value: 10 }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, captured } = makeCapturingInsertDb();

    await backfillPrices(db, { walkBackFrom, maxChunks: 10, requestDelayMs: 0 });

    // prices: [] is what ends history. A non-empty chunk of only the bound
    // must not. Nothing from those chunks is written.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(captured.rows).toEqual([]);
  });
});
