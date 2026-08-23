// In-memory Drizzle Db doubles for route + collector tests. Select-chain fakes
// resolve a fixed result set (optionally counting SELECTs to probe caching);
// insert-chain fakes resolve a pg-style { rowCount } (optionally counting chunks
// or capturing the rows written). Every route/collector test hand-rolled these
// same `as unknown as Db` casts before — the fakes' contract now lives here, so a
// change to the Db shape is a one-file edit instead of a dozen.
import type { Db } from '../db/connection.js';
import { windowOf, type QueryWindow } from './window-db.js';

// Db whose select-chain (from → where → orderBy) resolves to `rows`, ignoring the
// WHERE clause — the seeded rows answer whichever day/range a handler queries, so
// the response is driven purely by the handler's own arithmetic.
export function makeSelectDb<Row>(rows: Row[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

// Same select-chain, but counts how many SELECTs were issued so a test can probe
// caching: a cache MISS issues its day-scoped reads, a HIT issues none.
export function makeCountingSelectDb<Row>(rows: Row[]): { db: Db; selectCount: () => number } {
  let count = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  const db = {
    select: () => {
      count++;
      return chain;
    },
  } as unknown as Db;
  return { db, selectCount: () => count };
}

// Db whose insert-chain (values → onConflictDoUpdate) resolves to a pg-style
// result with the given rowCount — Postgres' ON CONFLICT DO UPDATE affected-row
// count (inserted + updated), which equals the batch size for the whole batch.
export function makeInsertDb(rowCount = 0): Db {
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => Promise.resolve({ rowCount }),
  };
  return { insert: () => chain } as unknown as Db;
}

// Insert-chain fake that counts how many upsert chains were opened (one per
// chunk/batch), so a test can assert exactly how many were processed. rowCount is
// the per-chunk affected-row count (default 1).
export function makeCountingInsertDb(rowCount = 1): { db: Db; state: { inserts: number } } {
  const state = { inserts: 0 };
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => Promise.resolve({ rowCount }),
  };
  const db = {
    insert: () => {
      state.inserts++;
      return chain;
    },
  } as unknown as Db;
  return { db, state };
}

// One aggregated heatmap cell row as getHeatmap's first db.execute returns it:
// a weekday/hour bucket with its NUMERIC average. node-postgres hands NUMERIC
// back as a string, but a bare number is accepted too (parseFloat coerces both).
export interface HeatmapCell {
  weekday: number;
  hour: number;
  avg_price: string | number;
}

// Db double for getHeatmap's two-call execute protocol: each uncached invocation
// issues two db.execute calls — first the aggregated cell rows, then the ISO
// week-number row. Encoding that pairing here means a change to the query
// sequence is a one-file edit, not three. `cells` answers every first (cell)
// call. `weekNumbers` answers each second (week) call: a single number for a
// constant week, or an array used as a queue — one entry consumed per getHeatmap
// call, so a cache MISS draws the next number and a HIT draws none, making cache
// behaviour observable.
//
// The first execute of each pair is the week-window aggregation: lastCellQuery
// / lastWindow capture that SQL node so tests can assert the [Mon 00:00, next
// Mon 00:00) ISO bounds (and EXTRACT/GROUP BY text) instead of trusting canned
// cells. The week-number execute has no parameters and is not captured.
export interface HeatmapExecuteDb extends Db {
  lastCellQuery: () => unknown;
  lastWindow: () => QueryWindow | null;
}

export function makeHeatmapExecuteDb(
  cells: HeatmapCell[],
  weekNumbers: number | number[],
): HeatmapExecuteDb {
  const queue = Array.isArray(weekNumbers) ? weekNumbers : [weekNumbers];
  const constant = !Array.isArray(weekNumbers);
  let pairIndex = 0;
  let callInPair = 0;
  let lastCellQuery: unknown = null;
  const db = {
    execute: async (query?: unknown) => {
      callInPair += 1;
      if (callInPair === 1) {
        lastCellQuery = query ?? null;
        return { rows: cells };
      }
      callInPair = 0;
      const wk = constant ? queue[0] : queue[pairIndex];
      pairIndex += 1;
      return { rows: [{ week_number: wk }] };
    },
    lastCellQuery: () => lastCellQuery,
    lastWindow: (): QueryWindow | null =>
      lastCellQuery == null ? null : windowOf(lastCellQuery),
  } as unknown as HeatmapExecuteDb;
  return db;
}

// Config handed to onConflictDoUpdate — captured so a test can pin the conflict
// target and SET columns. Swallowing this argument is what let a missing or
// partial ON CONFLICT still green the collector suite (finding #7612).
export interface CapturedConflictUpdate {
  target: unknown;
  set: Record<string, unknown>;
}

// Insert-chain fake that records the rows handed to .values() and the
// onConflictDoUpdate config, so a test can assert which rows survived filtering
// and that the upsert actually rewrites both price columns on datetime.
export function makeCapturingInsertDb(): {
  db: Db;
  captured: { rows: unknown[]; conflict: CapturedConflictUpdate | null };
} {
  const captured: { rows: unknown[]; conflict: CapturedConflictUpdate | null } = {
    rows: [],
    conflict: null,
  };
  const chain = {
    values: (rows: unknown[]) => {
      captured.rows = rows;
      return chain;
    },
    onConflictDoUpdate: (config: CapturedConflictUpdate) => {
      captured.conflict = config;
      return Promise.resolve({ rowCount: captured.rows.length });
    },
  };
  return { db: { insert: () => chain } as unknown as Db, captured };
}
