// Global fetch stubs for collector tests: response builders (ok / failed) plus
// helpers that install them on globalThis.fetch via vi.stubGlobal. Callers own
// teardown — vi.unstubAllGlobals() in afterEach.
import { vi } from 'vitest';

// A fetch Response stand-in whose json() yields `body`.
export const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
});

// A failed (!ok) fetch Response stand-in with a caller-chosen status/statusText.
export const failedResponse = (status: number, statusText: string) => ({
  ok: false,
  status,
  statusText,
  json: async () => ({}),
});

// Stub global fetch to always resolve okJson(body); returns the mock for callers
// that assert on the request URL/options.
export function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => okJson(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Stub global fetch to always resolve a failed response; returns the mock.
export function stubFailedFetch(status: number, statusText: string) {
  const fetchMock = vi.fn(async () => failedResponse(status, statusText));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
