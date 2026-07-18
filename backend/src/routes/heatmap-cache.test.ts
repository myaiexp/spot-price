// Route test: the heatmap cache must be per-app, not a module-level singleton
// (audit #1612). A module-level cache let one app's rows leak into the next
// app instance regardless of its DB, breaking test isolation and multi-tenant
// correctness. Two sequential createApp() instances must each serve their own DB.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';
import { makeHeatmapExecuteDb } from '../test-support/fake-db.js';

// Db stand-in for the heatmap query: getHeatmap calls db.execute twice per
// invocation — first the cell rows, then the week-number row. Tag each DB with a
// distinct constant weekNumber so the response reveals which DB it was served from.
function fakeHeatmapDb(weekNumber: number): Db {
  return makeHeatmapExecuteDb([{ weekday: 1, hour: 0, avg_price: 0.1 }], weekNumber);
}

async function heatmapWeek(db: Db): Promise<number> {
  const app = createApp(db);
  const res = await app.request('/api/prices/heatmap');
  const body = (await res.json()) as { weekNumber: number };
  return body.weekNumber;
}

describe('heatmap cache isolation per app (audit #1612)', () => {
  it("a second createApp(db2) serves db2's data, not the first app's cached rows", async () => {
    const first = await heatmapWeek(fakeHeatmapDb(11));
    expect(first).toBe(11);
    // With a module-level cache this returns the stale 11; a per-app cache returns 22.
    const second = await heatmapWeek(fakeHeatmapDb(22));
    expect(second).toBe(22);
  });
});
