// Tests fetchSahkotinPrices' 200 success path (audit #3965). The existing
// error-message test only covers the !ok branch (a thrown error); this covers a
// 200 response: the request is built correctly (endpoint + URL-encoded range,
// follow redirects, timeout), and a payload missing `prices` (or with
// prices: null) degrades to [] instead of leaking undefined to callers —
// backfillPrices reads [] as "no more history" and stops cleanly.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSahkotinPrices } from './sahkotin.js';
import { stubFetch as stubOkFetch } from '../test-support/fetch-stub.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchSahkotinPrices success path (audit #3965)', () => {
  it('returns the prices array from a well-formed response', async () => {
    const slots = [
      { date: '2024-01-01T00:00:00Z', value: 50 },
      { date: '2024-01-01T01:00:00Z', value: 42.5 },
    ];
    stubOkFetch({ prices: slots });

    const result = await fetchSahkotinPrices('2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');

    expect(result).toEqual(slots);
  });

  it('queries the sahkotin.fi prices endpoint with URL-encoded start/end', async () => {
    const fetchMock = stubOkFetch({ prices: [] });

    await fetchSahkotinPrices('2024-03-01T00:00:00+02:00', '2024-03-31T00:00:00+03:00');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('sahkotin.fi/prices');
    // The '+' in the ISO offsets must be percent-encoded, not sent raw — a raw
    // '+' is decoded server-side as a space and silently shifts the range.
    expect(url).toContain(`start=${encodeURIComponent('2024-03-01T00:00:00+02:00')}`);
    expect(url).toContain(`end=${encodeURIComponent('2024-03-31T00:00:00+03:00')}`);
    expect(url).not.toContain('+02:00');
  });

  it('follows redirects and attaches a timeout signal', async () => {
    const fetchMock = stubOkFetch({ prices: [] });

    await fetchSahkotinPrices('2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');

    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.redirect).toBe('follow');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchSahkotinPrices data.prices fallback (audit #3965)', () => {
  it('returns [] when the response body has no prices key', async () => {
    stubOkFetch({}); // upstream returned an object without `prices`
    expect(await fetchSahkotinPrices('a', 'b')).toEqual([]);
  });

  it('returns [] when prices is null', async () => {
    stubOkFetch({ prices: null });
    expect(await fetchSahkotinPrices('a', 'b')).toEqual([]);
  });
});
