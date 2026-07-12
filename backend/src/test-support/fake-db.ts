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
