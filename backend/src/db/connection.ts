// Postgres connection pool factory (Drizzle + node-postgres)
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
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
