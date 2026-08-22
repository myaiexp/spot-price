// Heatmap week-window bounds, ISODOW mapping, and DST span
//
// heatmap-precision / heatmap-week-cache feed canned cells through
// makeHeatmapExecuteDb and never inspect execute() arguments, so a bound slip
// (Sunday .start instead of .end, shiftDate(weekKey, 5), UTC midnight, a
// 7*86400000 ms span) or EXTRACT(DOW) instead of ISODOW still passed. This
// file is the heatmap counterpart of range-window.test.ts: capture the
// parameterized [start, end) ISO bounds and assert they equal
// getHelsinkiDateRange(weekKey).start … getHelsinkiDateRange(shiftDate(weekKey, 6)).end,
// including weeks that contain a DST transition. Seed ISODOW 7 and assert it
// lands on matrix[6].
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHeatmap } from './heatmap.js';
import { getHelsinkiDateRange, helsinkiWeekStart, shiftDate } from '../utils/helsinki-time.js';
import { makeHeatmapExecuteDb, type HeatmapCell } from '../test-support/fake-db.js';
import { flattenSqlText, type QueryWindow } from '../test-support/window-db.js';

const HOUR = 3_600_000;
const WEEK_MS = 7 * 86_400_000;

afterEach(() => {
  vi.useRealTimers();
});

// Expected half-open Helsinki week: [Mon 00:00, next Mon 00:00) as UTC ISOs.
function expectedWeekWindow(weekKey: string): QueryWindow {
  return {
    gte: getHelsinkiDateRange(weekKey).start.toISOString(),
    lt: getHelsinkiDateRange(shiftDate(weekKey, 6)).end.toISOString(),
  };
}

async function heatmapAt(isoNow: string, cells: HeatmapCell[] = []) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(isoNow));
  const db = makeHeatmapExecuteDb(cells, 24);
  const result = await createHeatmap()(db);
  return { result, db, weekKey: helsinkiWeekStart() };
}

describe('getHeatmap week SQL window', () => {
  it('queries [Mon 00:00, next Mon 00:00) of the current Helsinki week', async () => {
    // Wed 2026-06-17 13:00 EEST — week start Mon 2026-06-15. Summer, no DST
    // inside the week: a 7*86400000 slip would still match the span, but UTC
    // midnight (2026-06-15T00:00Z) or Sunday .start would not match the ISOs.
    const { db, weekKey } = await heatmapAt('2026-06-17T10:00:00.000Z');
    expect(weekKey).toBe('2026-06-15');
    expect(db.lastWindow()).toEqual(expectedWeekWindow('2026-06-15'));
    expect(db.lastWindow()).toEqual({
      gte: '2026-06-14T21:00:00.000Z', // Mon 00:00 EEST
      lt: '2026-06-21T21:00:00.000Z', // next Mon 00:00 EEST
    });
  });

  it('spring-forward week spans 167h, not 7×24h', async () => {
    // Thu 2026-03-26 — week Mon 2026-03-23 … Sun 2026-03-29 (clocks 03:00→04:00).
    // Next Mon 00:00 is already EEST, so the exclusive end is one hour earlier
    // than a naive weekStart + 7*86400000.
    const { db, weekKey } = await heatmapAt('2026-03-26T10:00:00.000Z');
    expect(weekKey).toBe('2026-03-23');
    const window = db.lastWindow();
    expect(window).toEqual(expectedWeekWindow('2026-03-23'));
    expect(window).toEqual({
      gte: '2026-03-22T22:00:00.000Z', // Mon 00:00 EET
      lt: '2026-03-29T21:00:00.000Z', // next Mon 00:00 EEST
    });
    const span = new Date(window!.lt).getTime() - new Date(window!.gte).getTime();
    expect(span).toBe(167 * HOUR);
    expect(span).not.toBe(WEEK_MS);
  });

  it('fall-back week spans 169h, not 7×24h', async () => {
    // Thu 2026-10-22 — week Mon 2026-10-19 … Sun 2026-10-25 (clocks 04:00→03:00).
    const { db, weekKey } = await heatmapAt('2026-10-22T10:00:00.000Z');
    expect(weekKey).toBe('2026-10-19');
    const window = db.lastWindow();
    expect(window).toEqual(expectedWeekWindow('2026-10-19'));
    expect(window).toEqual({
      gte: '2026-10-18T21:00:00.000Z', // Mon 00:00 EEST
      lt: '2026-10-25T22:00:00.000Z', // next Mon 00:00 EET
    });
    const span = new Date(window!.lt).getTime() - new Date(window!.gte).getTime();
    expect(span).toBe(169 * HOUR);
    expect(span).not.toBe(WEEK_MS);
  });

  it('winter week starts at Helsinki midnight, not UTC midnight', async () => {
    // Wed 2026-01-14 — week Mon 2026-01-12. EET +2: local Monday 00:00 is
    // Sunday 22:00 UTC, not Monday 00:00 UTC.
    const { db, weekKey } = await heatmapAt('2026-01-14T10:00:00.000Z');
    expect(weekKey).toBe('2026-01-12');
    expect(db.lastWindow()).toEqual(expectedWeekWindow('2026-01-12'));
    expect(db.lastWindow()?.gte).toBe('2026-01-11T22:00:00.000Z');
    expect(db.lastWindow()?.gte).not.toBe('2026-01-12T00:00:00.000Z');
  });
});

describe('getHeatmap ISODOW mapping and aggregation SQL', () => {
  it('maps ISODOW 1→matrix[0] (Mon) and ISODOW 7→matrix[6] (Sun)', async () => {
    // EXTRACT(DOW) would send Sunday as 0 (and Saturday as 6). Seeding 7 and
    // asserting matrix[6] fails a `weekday` (no −1) mapping and a DOW wrap
    // (`weekday % 7` → 0). Combined with the SQL-text assertion below, a
    // DOW-for-ISODOW swap cannot hide.
    const { result } = await heatmapAt('2026-06-17T10:00:00.000Z', [
      { weekday: 1, hour: 0, avg_price: '0.10000' },
      { weekday: 7, hour: 12, avg_price: '0.20000' },
    ]);
    expect(result.matrix).toHaveLength(7);
    expect(result.matrix[0].day).toBe(0);
    expect(result.matrix[0].hours[0]).toBe(10);
    expect(result.matrix[6].day).toBe(6);
    expect(result.matrix[6].hours[12]).toBe(20);
    expect(result.matrix[6].hours).toHaveLength(24); // 7×24 grid, not 25
    expect(result.matrix[1].hours[0]).toBeNull();
  });

  it('SQL uses EXTRACT(ISODOW), exclusive datetime <, and GROUP BY weekday, hour', async () => {
    // Bound capture cannot see the operator or the EXTRACT name. flattenSqlText
    // skips parameters and joins the fragments so a DOW swap, a `datetime <=`
    // upper bound, or a grouping that would preserve the fall-back 25th hour
    // fails here. GROUP BY hour is how the two fall-back hour-3s average into
    // one 24-column cell — intentional, documented on getHeatmap.
    const { db } = await heatmapAt('2026-10-22T10:00:00.000Z');
    const sql = flattenSqlText(db.lastCellQuery());
    expect(sql).toMatch(/EXTRACT\(ISODOW FROM /);
    expect(sql).not.toMatch(/EXTRACT\(DOW FROM /);
    expect(sql).toMatch(/datetime </);
    expect(sql).toMatch(/GROUP BY weekday, hour/);
  });
});
