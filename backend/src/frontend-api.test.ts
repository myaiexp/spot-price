// Tests for the frontend's API layer (../../frontend/js/api.js): every request
// carries an abort signal (timeout + caller cancel), 404 means "no data yet"
// rather than an error, other non-ok statuses throw, today/now failures still
// reject (last-known-good), and fetchHeatmap hits /prices/heatmap.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchJSON, fetchPriceBundle, fetchHeatmap, FETCH_TIMEOUT_MS } from '../../frontend/js/api.js';
import { stubFetch, stubFailedFetch } from './test-support/fetch-stub.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The stub helpers declare 0-arg mocks; the recorded args are still there, so
// read them through one loosely-typed accessor instead of casting at each use.
const callsOf = (mock: unknown) => (mock as { mock: { calls: unknown[][] } }).mock.calls;
const signalOf = (mock: unknown, call = 0) => (callsOf(mock)[call][1] as RequestInit).signal;

describe('fetchJSON', () => {
  it('pins FETCH_TIMEOUT_MS at 15 seconds (finding #7901, audit #5562)', () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it('bounds every request with AbortSignal.timeout(FETCH_TIMEOUT_MS) (finding #7901)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = stubFetch({ slots: [] });
    await fetchJSON('/prices/today');
    expect(callsOf(fetchMock)[0][0]).toBe('/porssi/api/prices/today');
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
    expect(signalOf(fetchMock)).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it('aborts when the caller signal fires before the timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = stubFetch({ slots: [] });
    const controller = new AbortController();
    await fetchJSON('/prices/today', controller.signal);
    const signal = signalOf(fetchMock)!;
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('returns null on 404 (dataset not published yet)', async () => {
    stubFailedFetch(404, 'Not Found');
    expect(await fetchJSON('/prices/tomorrow')).toBeNull();
  });

  it('throws on other non-ok statuses', async () => {
    stubFailedFetch(500, 'Internal Server Error');
    await expect(fetchJSON('/prices/today')).rejects.toThrow('API 500');
  });
});

describe('fetchPriceBundle', () => {
  it('passes an abort signal to every request', async () => {
    const fetchMock = stubFetch({ slots: [] });
    const controller = new AbortController();
    await fetchPriceBundle(controller.signal);
    expect(callsOf(fetchMock)).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(signalOf(fetchMock, i)).toBeInstanceOf(AbortSignal);
  });

  it('returns each dataset under its own key, not by position (finding #9591)', async () => {
    // Every endpoint answers with its own path, so a swapped key (or a return
    // order drifting from the request order) fails here.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ from: url.replace('/porssi/api', '') }),
      })),
    );
    expect(await fetchPriceBundle()).toEqual({
      today: { from: '/prices/today' },
      yesterday: { from: '/prices/yesterday' },
      tomorrow: { from: '/prices/tomorrow' },
      now: { from: '/prices/now' },
    });
  });

  it('degrades a failed tomorrow fetch to null instead of failing the paint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/tomorrow')) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    const { today, tomorrow } = await fetchPriceBundle();
    expect(today).toEqual({ slots: [] });
    expect(tomorrow).toBeNull();
  });

  it('degrades a failed yesterday fetch to null instead of failing the paint (finding #7117)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/yesterday')) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    const { today, yesterday, now } = await fetchPriceBundle();
    expect(today).toEqual({ slots: [] });
    expect(yesterday).toBeNull();
    expect(now).toEqual({ slots: [] });
  });

  it('does not swallow a caller-aborted tomorrow fetch into a resolved null', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/tomorrow')) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    await expect(fetchPriceBundle(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not swallow a caller-aborted yesterday fetch into a resolved null', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/yesterday')) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    await expect(fetchPriceBundle(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still degrades a timeout-aborted yesterday fetch to null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/yesterday')) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    const { today, yesterday } = await fetchPriceBundle(new AbortController().signal);
    expect(today).toEqual({ slots: [] });
    expect(yesterday).toBeNull();
  });

  it('still degrades a timeout-aborted tomorrow fetch to null', async () => {
    // Timeout AbortError: the caller's signal is NOT aborted, so unpublished /
    // slow tomorrow must not fail the whole paint.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/tomorrow')) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    const { today, tomorrow } = await fetchPriceBundle(new AbortController().signal);
    expect(today).toEqual({ slots: [] });
    expect(tomorrow).toBeNull();
  });

  it('rejects when /prices/today throws so last-known-good is kept (finding #7614)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/today')) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    await expect(fetchPriceBundle()).rejects.toThrow('network down');
  });

  it('rejects when /prices/now throws so last-known-good is kept (finding #7614)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/now')) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    await expect(fetchPriceBundle()).rejects.toThrow('network down');
  });
});

describe('fetchHeatmap', () => {
  it('requests /prices/heatmap with an abort signal (finding #7614)', async () => {
    const fetchMock = stubFetch({ cells: [] });
    const controller = new AbortController();
    await fetchHeatmap(controller.signal);
    expect(callsOf(fetchMock)[0][0]).toBe('/porssi/api/prices/heatmap');
    expect(signalOf(fetchMock)).toBeInstanceOf(AbortSignal);
  });
});
