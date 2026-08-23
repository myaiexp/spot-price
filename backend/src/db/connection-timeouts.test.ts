// createDb must pass finite connect/query timeouts to pg.Pool so a stalled
// Postgres fails the request instead of hanging it (audit #7110), and must
// listen for idle-client 'error' so a Postgres restart cannot crash the
// long-running API (finding #7613).
import { describe, it, expect, vi, afterEach } from 'vitest';
import pg from 'pg';
import { createDb, POOL_CONNECT_TIMEOUT_MS, POOL_QUERY_TIMEOUT_MS } from './connection.js';

const OrigPool = pg.Pool;

afterEach(() => {
  pg.Pool = OrigPool;
});

function mockPool() {
  const on = vi.fn();
  const Pool = vi.fn(function MockPool(this: { on: typeof on; end: unknown }) {
    this.on = on;
    this.end = vi.fn();
  });
  pg.Pool = Pool as unknown as typeof pg.Pool;
  return { Pool, on };
}

describe('createDb pool timeouts (audit #7110)', () => {
  it('passes finite connection, statement, and query timeouts to pg.Pool', () => {
    const { Pool } = mockPool();

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

describe('createDb idle-client error listener (finding #7613)', () => {
  it('registers pool.on("error") and logs instead of throwing', () => {
    const { on } = mockPool();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      createDb('postgres://spot-price/test');

      expect(on).toHaveBeenCalledWith('error', expect.any(Function));
      const handler = on.mock.calls[0][1] as (err: Error) => void;
      const idleErr = new Error('terminating connection due to administrator command');
      expect(() => handler(idleErr)).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith('[pg pool] idle client error', idleErr);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
