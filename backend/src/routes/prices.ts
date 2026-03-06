import { Hono } from 'hono';
import type { Db } from '../db/connection.js';

export function pricesRoutes(_db: Db): Hono {
  const router = new Hono();

  // Stub — implemented in Task 4
  router.get('/today', (c) => c.json({ slots: [], date: '' }));

  return router;
}
