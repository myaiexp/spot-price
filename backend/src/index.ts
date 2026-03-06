import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb } from './db/connection.js';

export function main(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const port = parseInt(process.env.API_PORT || '3500', 10);
  const db = createDb(databaseUrl);
  const app = createApp(db);

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Spot price API running on port ${port}`);
  });
}

main();
