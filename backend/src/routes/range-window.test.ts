// Route test: GET /api/prices/range queries the correct [start, end) UTC window
// (audit — /range query-window regression coverage).
//
// range-validation.test.ts pins the request CONTRACT (which inputs 400 vs 200)
// using makeSelectDb, whose where() discards the condition and returns the
// seeded rows for ANY window — so those tests stay green no matter what window
// the handler actually queries. The one thing /range exists to get right is its
// window boundaries, and specifically that `to` is INCLUSIVE (the whole `to` day
// is in range). A regression passing toRange.start instead of toRange.end to
// getSlotsForRange would make `to` exclusive and a from===to query always empty,
// yet leave every makeSelectDb test passing.
//
// makeWindowFilterDb closes that gap: it records the [gte, lt) bounds the handler
// queried and returns only seeded rows inside that half-open window — so both the
// exact bounds and the inclusive-`to` behaviour are asserted against real query
// arithmetic.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { getHelsinkiDateRange } from '../utils/helsinki-time.js';
import { row } from '../test-support/rows.js';
import { makeWindowFilterDb } from '../test-support/window-db.js';

// Expected half-open window for a from..to (inclusive `to`) /range request:
// [start of `from` day, start of the day AFTER `to`) in UTC — DST-correct via
// the same helper the handler uses.
function expectedWindow(from: string, to: string) {
  return {
    gte: getHelsinkiDateRange(from).start.toISOString(),
    lt: getHelsinkiDateRange(to).end.toISOString(),
  };
}

describe('GET /range query window', () => {
  it('from === to queries exactly [start-of-day, start-of-next-day) — the full `to` day', async () => {
    // March 10 is winter (EET, +2): the Helsinki day spans UTC 03-09T22:00 →
    // 03-10T22:00. Seed the FIRST and LAST slots of that day plus the first slot
    // of the NEXT day (which sits exactly on the exclusive upper bound).
    const rows = [
      row('2026-03-09T22:00:00.000Z', 1), // 00:00 Helsinki — first slot of 03-10
      row('2026-03-10T21:45:00.000Z', 2), // 23:45 Helsinki — last slot of 03-10
      row('2026-03-10T22:00:00.000Z', 3), // 00:00 Helsinki 03-11 — must be EXCLUDED
    ];
    const { db, lastWindow } = makeWindowFilterDb(rows);
    const app = createApp(db);
    const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-10');
    expect(res.status).toBe(200);

    // The handler queried the inclusive-`to` window, not a `to`-exclusive one.
    expect(lastWindow()).toEqual(expectedWindow('2026-03-10', '2026-03-10'));

    // Both slots of the `to` day are returned; the next-day slot on the exclusive
    // upper bound is dropped. A regression making `to` exclusive would return [].
    const body = (await res.json()) as { slots: { datetime: string }[] };
    expect(body.slots.map((s) => s.datetime)).toEqual([
      '2026-03-09T22:00:00.000Z',
      '2026-03-10T21:45:00.000Z',
    ]);
  });

  it('multi-day forward range spans [start-of-from, start-of-day-after-to)', async () => {
    const rows = [
      row('2026-03-09T22:00:00.000Z', 1), // 03-10 00:00 Helsinki — included
      row('2026-03-11T12:00:00.000Z', 2), // 03-11 — included
      row('2026-03-12T21:45:00.000Z', 3), // 03-12 23:45 Helsinki — last of `to` day
      row('2026-03-12T22:00:00.000Z', 4), // 03-13 00:00 Helsinki — EXCLUDED (upper bound)
      row('2026-03-09T21:59:00.000Z', 5), // 03-09 23:59 Helsinki — EXCLUDED (before start)
    ];
    const { db, lastWindow } = makeWindowFilterDb(rows);
    const app = createApp(db);
    const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-12');
    expect(res.status).toBe(200);

    expect(lastWindow()).toEqual(expectedWindow('2026-03-10', '2026-03-12'));

    const body = (await res.json()) as { slots: { datetime: string }[] };
    expect(body.slots.map((s) => s.datetime)).toEqual([
      '2026-03-09T22:00:00.000Z',
      '2026-03-11T12:00:00.000Z',
      '2026-03-12T21:45:00.000Z',
    ]);
  });
});
