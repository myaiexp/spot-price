// Tests the heatmap cache's two invalidation conditions (audit #17). The cache
// must serve within a 15-min TTL *and* only for the current Helsinki week — a
// late-Sunday entry must be dropped at the Monday rollover even when the TTL has
// not yet elapsed, or the UI shows last week's grid (wrong week number + days).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHeatmap } from './heatmap.js';
import type { Db } from '../db/connection.js';

// Db where each getHeatmap call (two db.execute calls: cells, then week) draws
// the next week number from a queue, so a cache MISS is observable as a new
// number and a cache HIT as the previously returned one.
function weekSeqDb(weekNumbers: number[]): Db {
  let pair = 0;
  let callInPair = 0;
  return {
    execute: async () => {
      callInPair += 1;
      if (callInPair === 1) {
        return { rows: [{ weekday: 1, hour: 0, avg_price: '0.1' }] };
      }
      callInPair = 0;
      const wk = weekNumbers[pair];
      pair += 1;
      return { rows: [{ week_number: wk }] };
    },
  } as unknown as Db;
}

async function weekOf(getHeatmap: (db: Db) => Promise<{ weekNumber: number }>, db: Db): Promise<number> {
  return (await getHeatmap(db)).weekNumber;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('heatmap cache invalidation (audit #17)', () => {
  it('serves the cached week within TTL when the Helsinki week is unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const getHeatmap = createHeatmap();
    const db = weekSeqDb([25, 99]); // 99 would only surface on a re-query

    vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z')); // Wed, week start 2026-06-15
    expect(await weekOf(getHeatmap, db)).toBe(25);

    vi.setSystemTime(new Date('2026-06-17T10:10:00.000Z')); // +10 min, same week, within TTL
    expect(await weekOf(getHeatmap, db)).toBe(25); // cache hit, not 99
  });

  it('invalidates on week rollover even within the TTL window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const getHeatmap = createHeatmap();
    const db = weekSeqDb([25, 26]);

    // Sun 2026-06-21 23:53 Helsinki (EEST +3) — week start 2026-06-15.
    vi.setSystemTime(new Date('2026-06-21T20:53:00.000Z'));
    expect(await weekOf(getHeatmap, db)).toBe(25);

    // Mon 2026-06-22 00:05 Helsinki — +12 min (within 15-min TTL) but a new week.
    vi.setSystemTime(new Date('2026-06-21T21:05:00.000Z'));
    expect(await weekOf(getHeatmap, db)).toBe(26); // re-queried, not the stale 25
  });

  it('invalidates after the TTL elapses within the same week', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const getHeatmap = createHeatmap();
    const db = weekSeqDb([25, 26]);

    vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'));
    expect(await weekOf(getHeatmap, db)).toBe(25);

    vi.setSystemTime(new Date('2026-06-17T10:16:00.000Z')); // +16 min > 15-min TTL, same week
    expect(await weekOf(getHeatmap, db)).toBe(26);
  });
});
