// In-memory Drizzle Db doubles for route + collector tests. Select-chain fakes
// resolve a fixed result set (optionally counting SELECTs to probe caching);
// insert-chain fakes resolve a pg-style { rowCount } (optionally counting chunks
// or capturing the rows written). Every route/collector test hand-rolled these
// same `as unknown as Db` casts before — the fakes' contract now lives here, so a
// change to the Db shape is a one-file edit instead of a dozen.
import type { Db } from '../db/connection.js';

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
export function makeHeatmapExecuteDb(cells: HeatmapCell[], weekNumbers: number | number[]): Db {
  const queue = Array.isArray(weekNumbers) ? weekNumbers : [weekNumbers];
  const constant = !Array.isArray(weekNumbers);
  let pairIndex = 0;
  let callInPair = 0;
  return {
    execute: async () => {
      callInPair += 1;
      if (callInPair === 1) {
        return { rows: cells };
      }
      callInPair = 0;
      const wk = constant ? queue[0] : queue[pairIndex];
      pairIndex += 1;
      return { rows: [{ week_number: wk }] };
    },
  } as unknown as Db;
}

// Insert-chain fake that records the rows handed to .values(), so a test can
// assert exactly which rows survived filtering. rowCount mirrors the written count.
export function makeCapturingInsertDb(): { db: Db; captured: { rows: unknown[] } } {
  const captured: { rows: unknown[] } = { rows: [] };
  const chain = {
    values: (rows: unknown[]) => {
      captured.rows = rows;
      return chain;
    },
    onConflictDoUpdate: () => Promise.resolve({ rowCount: captured.rows.length }),
  };
  return { db: { insert: () => chain } as unknown as Db, captured };
}
