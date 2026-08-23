// Pins the collector CLI dispatch (finding #7904). parseBackfillArg and the
// collect/backfill libraries are covered elsewhere; this file is the wiring
// that decides which one runs and with which walkBackFrom. Importing
// collector.ts must not itself collect — main() is the testable entry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { main, collectorEnvPath } from './collector.js';
import type { Db } from './db/connection.js';
import { getHelsinkiDateRange } from './utils/helsinki-time.js';

const fakeDb = {} as Db;

function makeDeps() {
  const createDb = vi.fn(() => fakeDb);
  const collectPrices = vi.fn(async () => ({ upserted: 3 }));
  const backfillPrices = vi.fn(async () => ({ totalUpserted: 7 }));
  return {
    env: { DATABASE_URL: 'postgres://spot-price/test' },
    createDb,
    collectPrices,
    backfillPrices,
  };
}

describe('collector CLI main (finding #7904)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 and does not touch the DB when DATABASE_URL is missing', async () => {
    const deps = makeDeps();
    const code = await main(['node', 'collector.js'], { ...deps, env: {} });
    expect(code).toBe(1);
    expect(deps.createDb).not.toHaveBeenCalled();
    expect(deps.collectPrices).not.toHaveBeenCalled();
    expect(deps.backfillPrices).not.toHaveBeenCalled();
  });

  it('calls collectPrices on bare argv (live 15-min collect)', async () => {
    const deps = makeDeps();
    const code = await main(['node', 'collector.js'], deps);
    expect(code).toBe(0);
    expect(deps.createDb).toHaveBeenCalledWith('postgres://spot-price/test');
    expect(deps.collectPrices).toHaveBeenCalledOnce();
    expect(deps.collectPrices).toHaveBeenCalledWith(fakeDb);
    expect(deps.backfillPrices).not.toHaveBeenCalled();
  });

  it('calls backfillPrices with Helsinki midnight for --backfill=YYYY-MM-DD', async () => {
    // Winter: 2024-01-01 00:00 Helsinki is 2023-12-31T22:00:00Z. new Date('2024-01-01')
    // is UTC midnight — 2h into the named Helsinki day — and would walk sahkotin
    // hourly rows into live spot-hinta ownership of Helsinki today.
    const deps = makeDeps();
    const code = await main(['node', 'collector.js', '--backfill=2024-01-01'], deps);
    expect(code).toBe(0);
    expect(deps.collectPrices).not.toHaveBeenCalled();
    expect(deps.backfillPrices).toHaveBeenCalledOnce();
    const [, opts] = deps.backfillPrices.mock.calls[0] as [
      Db,
      { walkBackFrom?: Date } | undefined,
    ];
    expect(opts?.walkBackFrom?.toISOString()).toBe(
      getHelsinkiDateRange('2024-01-01').start.toISOString(),
    );
    expect(opts?.walkBackFrom?.toISOString()).toBe('2023-12-31T22:00:00.000Z');
  });

  it('calls backfillPrices with no walkBackFrom for a bare --backfill', async () => {
    const deps = makeDeps();
    const code = await main(['node', 'collector.js', '--backfill'], deps);
    expect(code).toBe(0);
    expect(deps.collectPrices).not.toHaveBeenCalled();
    expect(deps.backfillPrices).toHaveBeenCalledOnce();
    expect(deps.backfillPrices).toHaveBeenCalledWith(fakeDb, {});
  });

  it('exits 1 and does not touch the DB for an invalid --backfill date', async () => {
    const deps = makeDeps();
    const code = await main(['node', 'collector.js', '--backfill=nope'], deps);
    expect(code).toBe(1);
    expect(deps.createDb).not.toHaveBeenCalled();
    expect(deps.collectPrices).not.toHaveBeenCalled();
    expect(deps.backfillPrices).not.toHaveBeenCalled();
  });
});

describe('collectorEnvPath (finding #7935)', () => {
  it('resolves the project-root .env from src/ and dist/, not backend/.env', () => {
    // Both the documented `cd backend && npm run backfill` and the collector
    // unit's WorkingDirectory are backend/, where backend/.env does not exist.
    // dotenv must follow the file (src/ or dist/), not cwd.
    expect(collectorEnvPath('file:///repo/backend/src/collector.ts')).toBe(
      '/repo/.env',
    );
    expect(collectorEnvPath('file:///repo/backend/dist/collector.js')).toBe(
      '/repo/.env',
    );
    expect(collectorEnvPath()).toBe(
      fileURLToPath(new URL('../../.env', import.meta.url)),
    );
  });
});
