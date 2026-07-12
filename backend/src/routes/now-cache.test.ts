// Route test: GET /now caches its response so live polling doesn't issue two DB
// reads (today + yesterday slices) on every request. The cache is keyed by the
// current Helsinki 15-minute slot and bounded by a 60s TTL: polls within a slot
// reuse one result, while slot turnover OR TTL expiry forces a fresh read. Pins
// that contract so a regression back to per-poll DB round-trips trips here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
// /now issues two day-scoped SELECTs per cache MISS (today + yesterday); a cache
// HIT issues none — so selectCount() is the cache probe.
import { makeCountingSelectDb as countingDb } from '../test-support/fake-db.js';
import { row } from '../test-support/rows.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /now response cache', () => {
  it('serves polls within a slot from cache, refetching only after TTL or slot turnover', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-01-15T12:15:00Z = 14:15 Helsinki (EET, winter) — inside the 12:15Z slot.
    vi.setSystemTime(new Date('2026-01-15T12:15:00.000Z'));
    const rows = [
      row('2026-01-15T12:00:00.000Z', 5),
      row('2026-01-15T12:15:00.000Z', 6), // current
      row('2026-01-15T12:30:00.000Z', 7),
    ];
    const { db, selectCount } = countingDb(rows);
    const app = createApp(db);

    const first = await app.request('/api/prices/now');
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(selectCount()).toBe(2); // today + yesterday on the cold read

    // Second poll, same instant -> cache hit: no new DB reads, identical body.
    const second = await app.request('/api/prices/now');
    expect(selectCount()).toBe(2);
    expect(await second.json()).toEqual(firstBody);

    // Same slot but past the 60s TTL -> refetch (picks up an off-boundary upsert).
    vi.setSystemTime(new Date('2026-01-15T12:16:10.000Z')); // 14:16 Helsinki, still slot 57, +70s
    await app.request('/api/prices/now');
    expect(selectCount()).toBe(4);

    // Slot turnover -> cache key changes -> refetch regardless of TTL.
    vi.setSystemTime(new Date('2026-01-15T12:30:00.000Z')); // 14:30 Helsinki, slot 58
    await app.request('/api/prices/now');
    expect(selectCount()).toBe(6);
  });

  it('does not leak cached data across app instances', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-15T12:15:00.000Z'));
    const rows = [row('2026-01-15T12:15:00.000Z', 6)];

    const a = countingDb(rows);
    await createApp(a.db).request('/api/prices/now');
    expect(a.selectCount()).toBe(2);

    // A fresh app has its own per-closure cache — it must read its own DB, not
    // serve app A's cached result.
    const b = countingDb(rows);
    await createApp(b.db).request('/api/prices/now');
    expect(b.selectCount()).toBe(2);
  });
});
