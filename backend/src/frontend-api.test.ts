// Tests for the frontend's API layer (../../frontend/js/api.js): every request
// carries an abort signal (timeout + caller cancel), 404 means "no data yet"
// rather than an error, and other non-ok statuses throw.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchJSON, fetchAllData } from '../../frontend/js/api.js';
import { stubFetch, stubFailedFetch } from './test-support/fetch-stub.js';

afterEach(() => vi.unstubAllGlobals());

// The stub helpers declare 0-arg mocks; the recorded args are still there, so
// read them through one loosely-typed accessor instead of casting at each use.
const callsOf = (mock: unknown) => (mock as { mock: { calls: unknown[][] } }).mock.calls;
const signalOf = (mock: unknown, call = 0) => (callsOf(mock)[call][1] as RequestInit).signal;

describe('fetchJSON', () => {
  it('bounds every request with an abort signal', async () => {
    const fetchMock = stubFetch({ slots: [] });
    await fetchJSON('/prices/today');
    expect(callsOf(fetchMock)[0][0]).toBe('/porssi/api/prices/today');
    expect(signalOf(fetchMock)).toBeInstanceOf(AbortSignal);
  });

  it('aborts when the caller signal fires before the timeout', async () => {
    const fetchMock = stubFetch({ slots: [] });
    const controller = new AbortController();
    await fetchJSON('/prices/today', controller.signal);
    const signal = signalOf(fetchMock)!;
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

describe('fetchAllData', () => {
  it('passes an abort signal to every request', async () => {
    const fetchMock = stubFetch({ slots: [] });
    const controller = new AbortController();
    await fetchAllData(controller.signal);
    expect(callsOf(fetchMock)).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(signalOf(fetchMock, i)).toBeInstanceOf(AbortSignal);
  });

  it('degrades a failed tomorrow fetch to null instead of failing the paint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/prices/tomorrow')) throw new Error('network down');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ slots: [] }) };
      }),
    );
    const [today, , tomorrow] = await fetchAllData();
    expect(today).toEqual({ slots: [] });
    expect(tomorrow).toBeNull();
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
    await expect(fetchAllData(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
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
    const [today, , tomorrow] = await fetchAllData(new AbortController().signal);
    expect(today).toEqual({ slots: [] });
    expect(tomorrow).toBeNull();
  });
});
