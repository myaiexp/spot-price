// Backend price-API access. Same-origin relative base — the frontend is served
// from /porssi/ and the API is proxied at /porssi/api by nginx.
const API_BASE = '/porssi/api';

// Every request is time-bounded, mirroring the collector's FETCH_TIMEOUT_MS: a
// bare fetch() never rejects on a stalled response, so a hung proxy would leave
// the UI on "Ladataan..." forever with no error path (audit #5562).
export const FETCH_TIMEOUT_MS = 15_000;

// Combine the caller's cancel signal (a superseded refresh) with the timeout, so
// a request dies on whichever fires first. AbortSignal.any is recent enough to
// be worth a guard — without it we keep the timeout, which is the part that
// matters, and merely lose the early cancel.
function requestSignal(signal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchJSON(path, signal) {
  const res = await fetch(`${API_BASE}${path}`, { signal: requestSignal(signal) });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// Optional day datasets (unpublished tomorrow, or a blip on yesterday's ghost
// series) must not fail the whole paint. A *caller* abort (superseded refresh)
// still rejects — swallowing it as null lets a stale load resolve and overwrite
// the newer paint (finding #7108). Timeout AbortError does not abort `signal`,
// so it still degrades to null. Yesterday used to reject Promise.all and blank
// the dashboard even when today/now succeeded (finding #7117).
function optionalJson(path, signal) {
  return fetchJSON(path, signal).catch((err) => {
    if (signal?.aborted) throw err;
    return null;
  });
}

// The day/now price bundle one dashboard paint needs, fetched in parallel and
// returned keyed by dataset so no caller depends on a positional order. The
// heatmap is not part of it — see fetchHeatmap.
export async function fetchPriceBundle(signal) {
  const [today, yesterday, tomorrow, now] = await Promise.all([
    fetchJSON('/prices/today', signal),
    optionalJson('/prices/yesterday', signal),
    optionalJson('/prices/tomorrow', signal),
    fetchJSON('/prices/now', signal),
  ]);
  return { today, yesterday, tomorrow, now };
}

// The heatmap is loaded separately — it's slow on a cold start.
export function fetchHeatmap(signal) {
  return fetchJSON('/prices/heatmap', signal);
}
