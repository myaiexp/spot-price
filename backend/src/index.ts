// API server entry: loads the project .env, serves the Hono app, drains on exit.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb, closeDb } from './db/connection.js';
import { projectEnvPath } from './utils/project-env.js';

export function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const port = parseInt(process.env.API_PORT || '3600', 10);
  const db = createDb(databaseUrl);
  const app = createApp(db);

  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    console.log(`Spot price API running on port ${port}`);
  });

  // Graceful shutdown: stop accepting connections and let in-flight requests
  // finish, THEN drain the pg pool so the process exits cleanly under systemd
  // (SIGTERM) or Ctrl-C (SIGINT) instead of leaving open sockets for the runtime
  // to force-kill. server.close() only stops NEW connections; its callback fires
  // once existing requests drain — awaiting it is what preserves in-flight work.
  // A timeout guard bounds the wait so a stuck keep-alive connection cannot block
  // shutdown forever: after SHUTDOWN_TIMEOUT_MS we drain and exit regardless.
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`Shutdown: server.close did not settle within ${SHUTDOWN_TIMEOUT_MS}ms, draining anyway`);
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref(); // don't let the guard itself keep the event loop alive
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await closeDb(db);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

// Server entry point: run directly with `node dist/index.js` (prod) or
// `tsx src/index.ts` (dev). Guarded so importing this module (e.g. for tests)
// does not trigger startup side-effects — including reading the project .env.
// dotenv never overrides a var systemd's EnvironmentFile already set.
const currentFile = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === currentFile;

if (isMainModule) {
  config({ path: projectEnvPath(import.meta.url) });
  main();
}
