// Route tests for GET /today, /yesterday, /tomorrow (audit #3963, #7128).
// Envelope (status, {slots, date}, parsed numbers) plus the Helsinki [start,
// end) window each handler actually queries. makeSelectDb would ignore WHERE
// and hide a shifted day or a dropped bound — makeWindowFilterDb records the
// window and returns only rows inside it, so /today and /yesterday cannot
// silently share a fixture.
//
// The clock is frozen at 00:30 Helsinki, while UTC is still on the previous
// calendar date, and every expected date and window is a literal (finding
// #9934). Deriving them from getHelsinkiToday() — the helper the handlers call
// — made the test its own oracle: a handler taking "today" from
// toISOString().slice(0, 10) agrees with Helsinki for most of the day and passed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApp } from '../app.js';
import { makeWindowFilterDb, type QueryWindow } from '../test-support/window-db.js';
import { row, type RawRow, type Slot } from '../test-support/rows.js';

type DayBody = { slots: Slot[]; date: string };

type Day = { date: string; window: QueryWindow };

interface Clock {
  label: string;
  now: string;
  today: Day;
  yesterday: Day;
  tomorrow: Day;
}

const CLOCKS: Clock[] = [
  {
    // 22:30Z = 00:30 EET (+2) on 01-16; UTC is still 01-15.
    label: 'winter 22:30Z (EET +2)',
    now: '2026-01-15T22:30:00.000Z',
    today: {
      date: '2026-01-16',
      window: { gte: '2026-01-15T22:00:00.000Z', lt: '2026-01-16T22:00:00.000Z' },
    },
    yesterday: {
      date: '2026-01-15',
      window: { gte: '2026-01-14T22:00:00.000Z', lt: '2026-01-15T22:00:00.000Z' },
    },
    tomorrow: {
      date: '2026-01-17',
      window: { gte: '2026-01-16T22:00:00.000Z', lt: '2026-01-17T22:00:00.000Z' },
    },
  },
  {
    // 21:30Z = 00:30 EEST (+3) on 06-15; UTC is still 06-14.
    label: 'summer 21:30Z (EEST +3)',
    now: '2026-06-14T21:30:00.000Z',
    today: {
      date: '2026-06-15',
      window: { gte: '2026-06-14T21:00:00.000Z', lt: '2026-06-15T21:00:00.000Z' },
    },
    yesterday: {
      date: '2026-06-14',
      window: { gte: '2026-06-13T21:00:00.000Z', lt: '2026-06-14T21:00:00.000Z' },
    },
    tomorrow: {
      date: '2026-06-16',
      window: { gte: '2026-06-15T21:00:00.000Z', lt: '2026-06-16T21:00:00.000Z' },
    },
  },
];

const QUARTER_MS = 15 * 60 * 1000;

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

describe.each(CLOCKS)('day endpoints at $label', (clock) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(clock.now));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('GET /today (audit #3963)', () => {
    it('200 with {slots, date} for the Helsinki date, not the UTC one', async () => {
      const first = clock.today.window.gte;
      const second = plus(first, QUARTER_MS);
      const rows: RawRow[] = [
        { datetime: first, priceNoTax: '5', priceWithTax: '6.275' },
        { datetime: second, priceNoTax: '7', priceWithTax: '8.785' },
      ];
      const { db, lastWindow } = makeWindowFilterDb(rows);
      const res = await createApp(db).request('/api/prices/today');
      expect(res.status).toBe(200);
      expect(lastWindow()).toEqual(clock.today.window);
      const body = (await res.json()) as DayBody;
      expect(body.date).toBe(clock.today.date);
      expect(body.slots).toEqual([
        { datetime: first, priceNoTax: 5, priceWithTax: 6.275 },
        { datetime: second, priceNoTax: 7, priceWithTax: 8.785 },
      ]);
    });

    it('200 with an empty slots array when the day has no data', async () => {
      const { db, lastWindow } = makeWindowFilterDb([]);
      const res = await createApp(db).request('/api/prices/today');
      expect(res.status).toBe(200);
      expect(lastWindow()).toEqual(clock.today.window);
      const body = (await res.json()) as DayBody;
      expect(body.slots).toEqual([]);
      expect(body.date).toBe(clock.today.date);
    });
  });

  describe('GET /yesterday (audit #3963, #7128)', () => {
    it("200 with {slots, date} for yesterday's Helsinki window, not today's", async () => {
      const todaySlot = clock.today.window.gte;
      const yesterdaySlot = clock.yesterday.window.gte;
      const { db, lastWindow } = makeWindowFilterDb([row(todaySlot, 1), row(yesterdaySlot, 10)]);
      const res = await createApp(db).request('/api/prices/yesterday');
      expect(res.status).toBe(200);
      expect(lastWindow()).toEqual(clock.yesterday.window);
      const body = (await res.json()) as DayBody;
      expect(body.date).toBe(clock.yesterday.date);
      expect(body.slots.map((s) => s.datetime)).toEqual([yesterdaySlot]);
    });

    it("200 with {slots: []} when yesterday has no rows (today's rows do not leak)", async () => {
      const { db, lastWindow } = makeWindowFilterDb([row(clock.today.window.gte, 1)]);
      const res = await createApp(db).request('/api/prices/yesterday');
      expect(res.status).toBe(200);
      expect(lastWindow()).toEqual(clock.yesterday.window);
      const body = (await res.json()) as DayBody;
      expect(body.date).toBe(clock.yesterday.date);
      expect(body.slots).toEqual([]);
    });
  });

  describe('GET /tomorrow (audit #3963)', () => {
    it('200 with {slots, date} for the Helsinki tomorrow when data exists', async () => {
      const tomorrowSlot = clock.tomorrow.window.gte;
      const { db, lastWindow } = makeWindowFilterDb([
        row(clock.today.window.gte, 1),
        row(tomorrowSlot, 3),
      ]);
      const res = await createApp(db).request('/api/prices/tomorrow');
      expect(res.status).toBe(200);
      expect(lastWindow()).toEqual(clock.tomorrow.window);
      const body = (await res.json()) as DayBody;
      expect(body.date).toBe(clock.tomorrow.date);
      expect(body.slots.map((s) => s.datetime)).toEqual([tomorrowSlot]);
    });

    it('404 with an {error} message when tomorrow has no data yet', async () => {
      const { db, lastWindow } = makeWindowFilterDb([row(clock.today.window.gte, 1)]);
      const res = await createApp(db).request('/api/prices/tomorrow');
      expect(res.status).toBe(404);
      expect(lastWindow()).toEqual(clock.tomorrow.window);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not yet available/i);
    });
  });
});
