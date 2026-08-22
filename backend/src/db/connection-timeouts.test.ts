// createDb must pass finite connect/query timeouts to pg.Pool so a stalled
// Postgres fails the request instead of hanging it (audit #7110).
import { describe, it, expect, vi, afterEach } from 'vitest';
import pg from 'pg';
import { createDb, POOL_CONNECT_TIMEOUT_MS, POOL_QUERY_TIMEOUT_MS } from './connection.js';

const OrigPool = pg.Pool;

afterEach(() => {
  pg.Pool = OrigPool;
});

describe('createDb pool timeouts (audit #7110)', () => {
  it('passes finite connection, statement, and query timeouts to pg.Pool', () => {
    const Pool = vi.fn(function MockPool(this: { on: unknown; end: unknown }) {
      this.on = vi.fn();
      this.end = vi.fn();
    });
    pg.Pool = Pool as unknown as typeof pg.Pool;

    createDb('postgres://spot-price/test');

    expect(Pool).toHaveBeenCalledTimes(1);
    const opts = Pool.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.connectionString).toBe('postgres://spot-price/test');
    expect(opts.connectionTimeoutMillis).toBe(POOL_CONNECT_TIMEOUT_MS);
    expect(opts.statement_timeout).toBe(POOL_QUERY_TIMEOUT_MS);
    expect(opts.query_timeout).toBe(POOL_QUERY_TIMEOUT_MS);
    expect(POOL_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(POOL_QUERY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
