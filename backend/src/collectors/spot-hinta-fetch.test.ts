// Tests live collect's spot-hinta URL and fetch timeout (finding #7611).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import { FETCH_TIMEOUT_MS } from '../utils/http.js';
import { makeInsertDb } from '../test-support/fake-db.js';
import { stubFetch } from '../test-support/fetch-stub.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectPrices request shape (finding #7611)', () => {
  it('fetches TodayAndDayForward with AbortSignal.timeout(FETCH_TIMEOUT_MS)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = stubFetch([]);

    await collectPrices(makeInsertDb(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    // Exact URL: a swap to /Today still contains "Today" and would starve Huomenna.
    expect(url).toBe('https://api.spot-hinta.fi/TodayAndDayForward');
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(opts?.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });
});
