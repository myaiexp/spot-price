// Tests backfillPrices' optional `walkBackFrom` exclusive upper bound
// (findings #6334, #6331, #6333). The backfill walks backwards from an EXCLUSIVE
// upper bound: by default Helsinki local midnight of the current Helsinki day
// (so live spot-hinta owns Helsinki today), but callers may pass `walkBackFrom`
// to resume from an earlier boundary instead of re-walking the whole history.
// These tests pin the first fetch window's `end` (= the bound) and `start`
// (= bound − 30 days) for both the default and the explicit-walkBackFrom cases,
// and that chunk N+1's `end` equals chunk N's `start` (finding #12149).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { backfillPrices } from './sahkotin.js';
import { okJson } from '../test-support/fetch-stub.js';
import { makeInsertDb } from '../test-support/fake-db.js';
import { getHelsinkiToday, getHelsinkiDateRange } from '../utils/helsinki-time.js';

// One affected row per chunk — this file never asserts on the count.
const countingDb = () => makeInsertDb(1);

function requestedWindow(url: string): { start: string; end: string } {
  const params = new URL(url).searchParams;
  return { start: params.get('start') ?? '', end: params.get('end') ?? '' };
}

// First chunk has one in-window slot, second is empty → the walk stops after
// exactly one fetch window, so calls[0] is the window anchored at the bound.
// The slot is derived from the requested `end` so the half-open filter keeps
// it (a fixed historical date would be dropped and is not what these tests pin).
function stubOneChunkThenEmpty() {
  let chunks = 0;
  const fetchMock = vi.fn(async (url: string) => {
    chunks += 1;
    if (chunks > 1) return okJson({ prices: [] });
    const endMs = new Date(requestedWindow(url).end).getTime();
    return okJson({ prices: [{ date: new Date(endMs - 60 * 60 * 1000).toISOString(), value: 50 }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return fetchMock;
}

const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('backfillPrices walkBackFrom exclusive upper bound', () => {
  it('walks backwards from an explicit walkBackFrom upper bound (exclusive)', async () => {
    const fetchMock = stubOneChunkThenEmpty();
    const walkBackFrom = new Date('2020-06-15T00:00:00Z');

    await backfillPrices(countingDb(), { walkBackFrom, requestDelayMs: 0 });

    const firstUrl = fetchMock.mock.calls[0][0] as string;
    const expectedEnd = walkBackFrom.toISOString();
    const expectedStart = new Date(walkBackFrom.getTime() - CHUNK_MS).toISOString();
    expect(firstUrl).toContain(`end=${encodeURIComponent(expectedEnd)}`);
    expect(firstUrl).toContain(`start=${encodeURIComponent(expectedStart)}`);
  });

  it('does not mutate the caller-supplied walkBackFrom Date', async () => {
    stubOneChunkThenEmpty();
    const walkBackFrom = new Date('2020-06-15T00:00:00Z');
    const before = walkBackFrom.getTime();

    await backfillPrices(countingDb(), { walkBackFrom, requestDelayMs: 0 });

    expect(walkBackFrom.getTime()).toBe(before);
  });

  it('defaults exclusive upper bound to Helsinki today 00:00 (live owns today)', async () => {
    // Midday summer: Helsinki and UTC share the calendar date, but Helsinki
    // midnight is 21:00Z the previous day — not UTC midnight.
    // Date-only fakes: leave setTimeout real so requestDelayMs: 0 still resolves.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T10:00:00Z'));
    const fetchMock = stubOneChunkThenEmpty();

    await backfillPrices(countingDb(), { requestDelayMs: 0 });

    const helsinkiTodayStart = getHelsinkiDateRange(getHelsinkiToday()).start;
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain(`end=${encodeURIComponent(helsinkiTodayStart.toISOString())}`);

    // Live ownership: exclusive end is exactly Helsinki today midnight, so no
    // Helsinki-today instant is inside the fetch window. UTC midnight of the
    // same civil date would extend into early Helsinki today (02:00/03:00).
    const utcMidnightSameCivilDay = Date.UTC(2026, 5, 15);
    expect(helsinkiTodayStart.getTime()).toBeLessThan(utcMidnightSameCivilDay);
    expect(helsinkiTodayStart.toISOString()).toBe('2026-06-14T21:00:00.000Z');
  });

  it('uses Helsinki midnight when UTC day and Helsinki day disagree', async () => {
    // 21:30Z on 14 June = 00:30 Helsinki on 15 June. UTC "today midnight" is
    // still 2026-06-14T00:00Z; Helsinki today start is 2026-06-14T21:00Z.
    // Old UTC-midnight default would walk through Helsinki early 15 June.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-14T21:30:00Z'));
    const fetchMock = stubOneChunkThenEmpty();

    await backfillPrices(countingDb(), { requestDelayMs: 0 });

    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(getHelsinkiToday()).toBe('2026-06-15');
    expect(firstUrl).toContain(
      `end=${encodeURIComponent('2026-06-14T21:00:00.000Z')}`,
    );
    // Explicit non-ownership: must NOT use UTC midnight of either calendar day.
    expect(firstUrl).not.toContain(
      `end=${encodeURIComponent('2026-06-14T00:00:00.000Z')}`,
    );
    expect(firstUrl).not.toContain(
      `end=${encodeURIComponent('2026-06-15T00:00:00.000Z')}`,
    );
  });

  it('uses EET midnight in winter (UTC+2)', async () => {
    // 10:00Z on 15 Jan = 12:00 Helsinki. Helsinki midnight = 22:00Z previous day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    const fetchMock = stubOneChunkThenEmpty();

    await backfillPrices(countingDb(), { requestDelayMs: 0 });

    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain(
      `end=${encodeURIComponent('2026-01-14T22:00:00.000Z')}`,
    );
  });

  it('abuts successive chunks: next end equals previous start, each 30 days wide (finding #12149)', async () => {
    let chunks = 0;
    const fetchMock = vi.fn(async (url: string) => {
      chunks += 1;
      if (chunks > 2) return okJson({ prices: [] });
      const endMs = new Date(requestedWindow(url).end).getTime();
      return okJson({ prices: [{ date: new Date(endMs - 60 * 60 * 1000).toISOString(), value: 40 }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const walkBackFrom = new Date('2020-06-15T00:00:00.000Z');

    await backfillPrices(countingDb(), { walkBackFrom, requestDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const windows = fetchMock.mock.calls.map((call) => requestedWindow(call[0] as string));
    for (let i = 0; i < windows.length - 1; i++) {
      expect(windows[i + 1].end).toBe(windows[i].start);
    }
    for (const window of windows) {
      expect(new Date(window.end).getTime() - new Date(window.start).getTime()).toBe(CHUNK_MS);
    }
  });
});
