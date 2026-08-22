// Postgres connection pool factory (Drizzle + node-postgres)
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// Bounds so a stalled or saturated Postgres surfaces as a fast 500 through
// app.onError instead of hanging the request forever. pg's defaults for
// connectionTimeoutMillis, statement_timeout, and query_timeout are all
// "wait forever". Values sit under the frontend's FETCH_TIMEOUT_MS (15s) so
// the 500 arrives before the browser gives up — same rationale as the
// collector's outbound FETCH_TIMEOUT_MS (audit #7110).
export const POOL_CONNECT_TIMEOUT_MS = 5_000;
export const POOL_QUERY_TIMEOUT_MS = 10_000;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
    statement_timeout: POOL_QUERY_TIMEOUT_MS,
    query_timeout: POOL_QUERY_TIMEOUT_MS,
  });
  // node-postgres emits 'error' on the pool when an IDLE client's connection
  // drops (Postgres restart, network blip, backend termination) — outside any
  // request, so app.onError never sees it. Without a listener Node treats it as
  // an unhandled 'error' and crashes the long-running API process. Logging it
  // keeps the process alive; pg discards the dead client and opens a fresh one
  // on the next checkout.
  pool.on('error', (err) => {
    console.error('[pg pool] idle client error', err);
  });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Close the connection pool backing a Db so its sockets are released and the
 * process can exit cleanly. Use on graceful shutdown (SIGTERM/SIGINT) and in
 * tests/scripts that must not leak open connections. Resolves once pg.Pool.end()
 * has drained the pool; calling it twice on the same pool rejects (pg behaviour).
 */
export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
