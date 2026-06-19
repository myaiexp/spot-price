import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Db } from './db/connection.js';
import { pricesRoutes } from './routes/prices.js';

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.use('*', secureHeaders());

  // Dev origin is excluded in production to prevent cross-origin requests from
  // local dev servers hitting the live API.
  app.use('*', cors({
    origin: process.env.NODE_ENV === 'production'
      ? ['https://mase.fi']
      : ['https://mase.fi', 'http://localhost:5173'],
  }));

  app.onError((err, c) => {
    console.error('[error]', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/prices', pricesRoutes(db));

  return app;
}
