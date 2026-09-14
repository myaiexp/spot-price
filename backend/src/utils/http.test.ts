// Tests fetchUpstreamJson, the shared timed upstream fetch (finding #9606).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchUpstreamJson, FETCH_TIMEOUT_MS } from './http.js';
import { okJson, stubFetch, stubFailedFetch } from '../test-support/fetch-stub.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchUpstreamJson (finding #9606)', () => {
  it('returns the parsed body untouched — shape checks belong to the caller', async () => {
    stubFetch({ anything: [1, 2] });
    expect(await fetchUpstreamJson('https://example.test/p', 'example.fi')).toEqual({ anything: [1, 2] });
  });

  it('requests the URL with redirect follow and AbortSignal.timeout(FETCH_TIMEOUT_MS)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = stubFetch([]);

    await fetchUpstreamJson('https://example.test/p?a=1', 'example.fi');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/p?a=1');
    expect(opts.redirect).toBe('follow');
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
    expect(opts.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it('throws "<source> API error: <status> <sanitized text>" on a non-2xx response', async () => {
    stubFailedFetch(502, 'Bad\r\nGateway');
    await expect(fetchUpstreamJson('https://example.test/p', 'example.fi')).rejects.toThrow(
      /^example\.fi API error: 502 Bad Gateway$/,
    );
  });

  it('propagates a body that is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ...okJson(null),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    })));
    await expect(fetchUpstreamJson('https://example.test/p', 'example.fi')).rejects.toThrow(SyntaxError);
  });
});
