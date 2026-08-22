// Route tests for GET /today, /yesterday, /tomorrow (audit #3963, #7128).
// Envelope (status, {slots, date}, parsed numbers) plus the Helsinki [start,
// end) window each handler actually queries. makeSelectDb would ignore WHERE
// and hide a shifted day or a dropped bound — makeWindowFilterDb records the
// window and returns only rows inside it, so /today and /yesterday cannot
// silently share a fixture.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate } from '../utils/helsinki-time.js';
import { makeWindowFilterDb } from '../test-support/window-db.js';
import { row, type RawRow, type Slot } from '../test-support/rows.js';

type DayBody = { slots: Slot[]; date: string };

function expectedWindow(date: string) {
  const { start, end } = getHelsinkiDateRange(date);
  return { gte: start.toISOString(), lt: end.toISOString() };
}

function startIso(date: string): string {
  return getHelsinkiDateRange(date).start.toISOString();
}

function slotIso(date: string, offsetMs: number): string {
  return new Date(getHelsinkiDateRange(date).start.getTime() + offsetMs).toISOString();
}

describe('GET /today (audit #3963)', () => {
  it('200 with {slots, date} where date is today (Helsinki)', async () => {
    const today = getHelsinkiToday();
    const first = startIso(today);
    const second = slotIso(today, 15 * 60 * 1000);
    const rows: RawRow[] = [
      { datetime: first, priceNoTax: '5', priceWithTax: '6.275' },
      { datetime: second, priceNoTax: '7', priceWithTax: '8.785' },
    ];
    const { db, lastWindow } = makeWindowFilterDb(rows);
    const app = createApp(db);
    const res = await app.request('/api/prices/today');
    expect(res.status).toBe(200);
    expect(lastWindow()).toEqual(expectedWindow(today));
    const body = (await res.json()) as DayBody;
    expect(body.date).toBe(today);
    expect(body.slots).toEqual([
      { datetime: first, priceNoTax: 5, priceWithTax: 6.275 },
      { datetime: second, priceNoTax: 7, priceWithTax: 8.785 },
    ]);
  });

  it('200 with an empty slots array when the day has no data', async () => {
    const today = getHelsinkiToday();
    const { db } = makeWindowFilterDb([]);
    const app = createApp(db);
    const res = await app.request('/api/prices/today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DayBody;
    expect(body.slots).toEqual([]);
    expect(body.date).toBe(today);
  });
});

describe('GET /yesterday (audit #3963, #7128)', () => {
  it('200 with {slots, date} for yesterday\'s Helsinki window, not today\'s', async () => {
    const today = getHelsinkiToday();
    const yesterday = shiftDate(today, -1);
    const todaySlot = startIso(today);
    const yesterdaySlot = startIso(yesterday);
    const { db, lastWindow } = makeWindowFilterDb([
      row(todaySlot, 1),
      row(yesterdaySlot, 10),
    ]);
    const app = createApp(db);
    const res = await app.request('/api/prices/yesterday');
    expect(res.status).toBe(200);
    expect(lastWindow()).toEqual(expectedWindow(yesterday));
    expect(lastWindow()).not.toEqual(expectedWindow(today));
    const body = (await res.json()) as DayBody;
    expect(body.date).toBe(yesterday);
    expect(body.slots.map((s) => s.datetime)).toEqual([yesterdaySlot]);
  });

  it('200 with {slots: []} when yesterday has no rows (today\'s rows do not leak)', async () => {
    const today = getHelsinkiToday();
    const yesterday = shiftDate(today, -1);
    const { db, lastWindow } = makeWindowFilterDb([row(startIso(today), 1)]);
    const app = createApp(db);
    const res = await app.request('/api/prices/yesterday');
    expect(res.status).toBe(200);
    expect(lastWindow()).toEqual(expectedWindow(yesterday));
    const body = (await res.json()) as DayBody;
    expect(body.date).toBe(yesterday);
    expect(body.slots).toEqual([]);
  });
});

describe('GET /today and /yesterday query distinct windows (audit #7128)', () => {
  it('each day-scoped GET asks for its own Helsinki [start, end)', async () => {
    const today = getHelsinkiToday();
    const yesterday = shiftDate(today, -1);
    const { db, lastWindow } = makeWindowFilterDb([
      row(startIso(today), 1),
      row(startIso(yesterday), 10),
    ]);
    const app = createApp(db);

    const todayRes = await app.request('/api/prices/today');
    const todayWindow = lastWindow();
    expect(todayRes.status).toBe(200);
    expect(todayWindow).toEqual(expectedWindow(today));

    const yesterdayRes = await app.request('/api/prices/yesterday');
    const yesterdayWindow = lastWindow();
    expect(yesterdayRes.status).toBe(200);
    expect(yesterdayWindow).toEqual(expectedWindow(yesterday));
    expect(yesterdayWindow).not.toEqual(todayWindow);
  });
});

describe('GET /tomorrow (audit #3963)', () => {
  it('200 with {slots, date} where date is tomorrow (Helsinki) when data exists', async () => {
    const tomorrow = shiftDate(getHelsinkiToday(), 1);
    const tomorrowSlot = startIso(tomorrow);
    const { db, lastWindow } = makeWindowFilterDb([row(tomorrowSlot, 3)]);
    const app = createApp(db);
    const res = await app.request('/api/prices/tomorrow');
    expect(res.status).toBe(200);
    expect(lastWindow()).toEqual(expectedWindow(tomorrow));
    const body = (await res.json()) as DayBody;
    expect(body.date).toBe(tomorrow);
    expect(body.slots.map((s) => s.datetime)).toEqual([tomorrowSlot]);
  });

  it('404 with an {error} message when tomorrow has no data yet', async () => {
    const { db } = makeWindowFilterDb([]);
    const app = createApp(db);
    const res = await app.request('/api/prices/tomorrow');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not yet available/i);
  });
});
