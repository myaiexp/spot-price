// Route test for createApp's onError JSON 500 contract (audit #7135). Health
// and happy-path price tests never enter this branch, so a rewrite that dropped
// onError (leaking the raw exception, or a non-JSON Hono default) would ship.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp } from './app.js';
import type { Db } from './db/connection.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// Select-chain whose orderBy rejects — the same path getSlotsForDate awaits.
function rejectingSelectDb(error: Error): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.reject(error),
  };
  return { select: () => chain } as unknown as Db;
}

describe('createApp onError (audit #7135)', () => {
  it('query rejection on /today is JSON 500, not the raw exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const leak = 'super-secret-db-error';
    const app = createApp(rejectingSelectDb(new Error(leak)));
    const res = await app.request('/api/prices/today');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'Internal Server Error' });
    expect(JSON.stringify(body)).not.toContain(leak);
  });
});
