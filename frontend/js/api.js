// Backend price-API access. Same-origin relative base — the frontend is served
// from /porssi/ and the API is proxied at /porssi/api by nginx.
const API_BASE = '/porssi/api';

export async function fetchJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// The four day/now datasets the initial paint needs, fetched together.
export function fetchAllData() {
  return Promise.all([
    fetchJSON('/prices/today'),
    fetchJSON('/prices/yesterday'),
    fetchJSON('/prices/tomorrow').catch(() => null),
    fetchJSON('/prices/now'),
  ]);
}

// The heatmap is loaded separately — it's slow on a cold start.
export function fetchHeatmap() {
  return fetchJSON('/prices/heatmap');
}
