import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from './db/connection.js';
import { pricesRoutes } from './routes/prices.js';
import { collectPrices } from './collector.js';

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.use('*', cors({
    origin: ['https://mase.fi', 'http://localhost:5173'],
  }));

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.post('/api/collect', async (c) => {
    const result = await collectPrices(db);
    return c.json(result);
  });

  app.route('/api/prices', pricesRoutes(db));

  return app;
}
