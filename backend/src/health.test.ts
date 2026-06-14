// Route test for GET /api/health (audit #3972). The health endpoint — used by
// uptime/liveness probes — had no test, so a change to its status or {status:'ok'}
// body would ship unnoticed. It touches no database, so a trivial Db stub suffices.
import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import type { Db } from './db/connection.js';

// /api/health never queries the database; an empty stub is enough.
const stubDb = {} as unknown as Db;

describe('GET /api/health (audit #3972)', () => {
  it('200 with {status: "ok"}', async () => {
    const app = createApp(stubDb);
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body).toEqual({ status: 'ok' });
  });
});
