import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb, closeDb } from './db/connection.js';

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

  // Graceful shutdown: stop accepting connections, then drain the pg pool so the
  // process exits cleanly under systemd (SIGTERM) or Ctrl-C (SIGINT) instead of
  // leaving open sockets for the runtime to force-kill.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down`);
    server.close();
    await closeDb(db);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

// Server entry point: run directly with `node dist/index.js` (prod) or
// `tsx src/index.ts` (dev). Guarded so importing this module (e.g. for tests)
// does not trigger startup side-effects.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const currentFile = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && resolve(process.argv[1]) === currentFile;

if (isMainModule) {
  main();
}
