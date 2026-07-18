// WHERE-bound-aware Drizzle Db doubles for tests whose contract IS the query
// window. Unlike fake-db's makeSelectDb — which ignores the WHERE clause and
// answers every window with the same seeded rows — these extract the [gte, lt)
// bounds the handler actually queried, so a regression that shifts the window
// (an exclusive `to`, the wrong day) changes the result and trips the test.
import type { Db } from '../db/connection.js';

// Pull the bound literal values (the right-hand operands of the WHERE
// comparisons, e.g. the gte/lt ISO bounds on prices.datetime) out of a Drizzle
// SQL condition, independent of operand order. A Drizzle SQL node nests its
// parts under `queryChunks`; a bound-parameter chunk carries its literal as a
// STRING `value`, whereas structural chunks carry an ARRAY `value` (SQL
// fragments) and column chunks carry neither — so collecting string `value`s
// yields exactly the bounds.
export function collectBoundValues(node: unknown, out: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return out;
  const n = node as { value?: unknown; queryChunks?: unknown[] };
  if (Array.isArray(n.queryChunks)) {
    for (const chunk of n.queryChunks) collectBoundValues(chunk, out);
  } else if (typeof n.value === 'string') {
    out.push(n.value);
  }
  return out;
}

// The [gte, lt) window a single SELECT queried, as ISO strings.
export interface QueryWindow {
  gte: string;
  lt: string;
}

// Extract the [gte, lt) window from a Drizzle `and(gte(...), lt(...))`
// condition. The two bound literals sort chronologically (same ISO format, so
// lexicographic == chronological), so the lower is gte and the upper is lt.
function windowOf(condition: unknown): QueryWindow {
  const [gte, lt] = collectBoundValues(condition).sort();
  return { gte, lt };
}

/**
 * Db double for handlers that issue day-scoped SELECTs keyed by the day they
 * request (the generalized /now `twoQueryDb`). Each query's fixture is looked up
 * by its gte lower bound — the start-of-day/window key in `byWindowStart`.
 * Matching by the requested window (not call ORDER) means reordering or adding a
 * query can't silently return the wrong day's rows; an unmapped window throws
 * loudly instead of serving a stale fixture. Seed rows ascending to match the
 * handler's orderBy(asc(datetime)).
 */
export function makeWindowKeyedDb<Row>(byWindowStart: Map<string, Row[]>): Db {
  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const { gte, lt } = windowOf(condition);
          const rows = byWindowStart.get(gte);
          if (!rows) {
            throw new Error(
              `makeWindowKeyedDb: no fixture for window starting ${String(gte)} ` +
                `(WHERE bounds: ${[gte, lt].filter(Boolean).join(', ') || 'none'})`,
            );
          }
          return { orderBy: () => Promise.resolve(rows) };
        },
      }),
    }),
  } as unknown as Db;
}

/**
 * Db double for a single-query range handler that FILTERS seeded rows by the
 * [gte, lt) window it actually queried, and records that window so a test can
 * assert the exact bounds. Only rows whose datetime falls in [gte, lt) are
 * returned (half-open, upper bound exclusive), mirroring the real SQL — so a
 * regression that makes `to` exclusive (querying [start, toStart) instead of
 * [start, toEnd)) drops the `to`-day rows and the test fails. Comparison is by
 * timestamp, independent of ISO string formatting.
 */
export function makeWindowFilterDb<Row extends { datetime: string }>(
  rows: Row[],
): { db: Db; lastWindow: () => QueryWindow | null } {
  let captured: QueryWindow | null = null;
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const window = windowOf(condition);
          captured = window;
          const gteMs = new Date(window.gte).getTime();
          const ltMs = new Date(window.lt).getTime();
          const matched = rows
            .filter((r) => {
              const t = new Date(r.datetime).getTime();
              return t >= gteMs && t < ltMs;
            })
            // Mirror the handler's orderBy(asc(datetime)) so the returned order
            // is the real query's order, not the test's seed order.
            .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
          return { orderBy: () => Promise.resolve(matched) };
        },
      }),
    }),
  } as unknown as Db;
  return { db, lastWindow: () => captured };
}
