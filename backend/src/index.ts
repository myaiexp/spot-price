import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb } from './db/connection.js';

export function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const port = parseInt(process.env.API_PORT || '3600', 10);
  const db = createDb(databaseUrl);
  const app = createApp(db);

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    console.log(`Spot price API running on port ${port}`);
  });
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
