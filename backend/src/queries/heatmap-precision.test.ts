// Pins heatmap aggregate handling after switching the SQL from
// AVG(price_with_tax::float) to AVG(price_with_tax) (audit #3913). The query now
// returns each NUMERIC average as a full-precision string (node-postgres yields
// NUMERIC as a string); getHeatmap must parse it to a number at the boundary,
// round to exact cents/kWh, and never let a malformed value reach the grid as NaN.
import { describe, it, expect } from 'vitest';
import { createHeatmap } from './heatmap.js';
import type { Db } from '../db/connection.js';
import { makeHeatmapExecuteDb, type HeatmapCell } from '../test-support/fake-db.js';

// getHeatmap calls db.execute twice — first the aggregated cell rows (avg_price
// as the NUMERIC *string* node-postgres returns), then the week row (fixed 24).
function fakeDb(cells: HeatmapCell[]): Db {
  return makeHeatmapExecuteDb(cells, 24);
}

describe('heatmap NUMERIC aggregate handling (audit #3913)', () => {
  it('parses NUMERIC string averages and rounds to exact cents/kWh', async () => {
    const getHeatmap = createHeatmap();
    const result = await getHeatmap(
      fakeDb([
        // ISODOW 1 = Mon → matrix day 0
        { weekday: 1, hour: 0, avg_price: '0.10000' },
        { weekday: 1, hour: 1, avg_price: '0.25000' },
        // ISODOW 2 = Tue → matrix day 1. Full-precision string with the extra
        // scale AVG(numeric) produces; must parse and round exactly to 12.35.
        { weekday: 2, hour: 0, avg_price: '0.12347500000000000000' },
      ]),
    );

    expect(result.matrix[0].hours[0]).toBe(10); // 0.10000 €/kWh → 10.00 c
    expect(result.matrix[0].hours[1]).toBe(25); // 0.25000 €/kWh → 25.00 c
    expect(result.matrix[1].hours[0]).toBe(12.35); // 0.123475 €/kWh → 12.3475 → 12.35 c
    expect(result.matrix[0].hours[2]).toBeNull(); // no data → null cell
    expect(result.minPrice).toBe(10);
    expect(result.maxPrice).toBe(25);
    expect(result.weekNumber).toBe(24);
  });

  it('skips a malformed avg_price instead of emitting NaN', async () => {
    const getHeatmap = createHeatmap();
    const result = await getHeatmap(
      fakeDb([
        { weekday: 1, hour: 0, avg_price: '0.10000' },
        { weekday: 1, hour: 1, avg_price: 'not-a-number' },
      ]),
    );

    expect(result.matrix[0].hours[0]).toBe(10);
    expect(result.matrix[0].hours[1]).toBeNull(); // malformed → skipped → null, not NaN
    expect(result.minPrice).toBe(10);
    expect(result.maxPrice).toBe(10);
  });

  it('keeps a 0 and a negative NUMERIC average as numeric cells in min/max (finding #7617)', async () => {
    // heatmap.js greys only null/undefined; 0 is a real Nord Pool hour. Treating
    // avg_price <= 0 as missing would leave min/max as the remaining positive
    // cell (10) instead of the negative floor.
    const getHeatmap = createHeatmap();
    const result = await getHeatmap(
      fakeDb([
        { weekday: 1, hour: 0, avg_price: '0' },
        { weekday: 1, hour: 1, avg_price: '-0.05000' },
        { weekday: 1, hour: 2, avg_price: '0.10000' },
      ]),
    );

    expect(result.matrix[0].hours[0]).toBe(0);
    expect(result.matrix[0].hours[1]).toBe(-5);
    expect(result.matrix[0].hours[2]).toBe(10);
    expect(result.minPrice).toBe(-5);
    expect(result.maxPrice).toBe(10);
  });

  it('reports minPrice/maxPrice 0 when the week has no populated cells', async () => {
    const getHeatmap = createHeatmap();
    const result = await getHeatmap(fakeDb([]));

    expect(result.matrix.every((row) => row.hours.every((cell) => cell === null))).toBe(true);
    expect(result.minPrice).toBe(0);
    expect(result.maxPrice).toBe(0);
  });
});
