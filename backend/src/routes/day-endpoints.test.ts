// Route tests for the day endpoints GET /today, /yesterday, /tomorrow (audit
// #3963). These handlers had zero route-level coverage: nothing exercised the
// HTTP status or response envelope, so a change to the {slots, date} shape or to
// /tomorrow's 404-when-empty contract could ship unnoticed. These pin status +
// basic body shape for each, deriving the expected `date` from the SAME Helsinki
// helpers the handlers use so the assertions hold whatever the wall-clock day.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { getHelsinkiToday, shiftDate } from '../utils/helsinki-time.js';
import { makeSelectDb as seededDb } from '../test-support/fake-db.js';
import type { RawRow, Slot } from '../test-support/rows.js';

type DayBody = { slots: Slot[]; date: string };

const ROWS: RawRow[] = [
  { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: '5', priceWithTax: '6.275' },
  { datetime: '2026-03-10T08:15:00.000Z', priceNoTax: '7', priceWithTax: '8.785' },
];

describe('GET /today (audit #3963)', () => {
  it('200 with {slots, date} where date is today (Helsinki)', async () => {
    const app = createApp(seededDb(ROWS));
    const res = await app.request('/api/prices/today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DayBody;
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots).toHaveLength(2);
    expect(body.date).toBe(getHelsinkiToday());
    // Each slot carries the parsed-number envelope, not raw NUMERIC strings.
    expect(body.slots[0]).toEqual({
      datetime: '2026-03-10T08:00:00.000Z',
      priceNoTax: 5,
      priceWithTax: 6.275,
    });
  });

  it('200 with an empty slots array when the day has no data', async () => {
    const app = createApp(seededDb([]));
    const res = await app.request('/api/prices/today');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DayBody;
    expect(body.slots).toEqual([]);
    expect(body.date).toBe(getHelsinkiToday());
  });
});

describe('GET /yesterday (audit #3963)', () => {
  it('200 with {slots, date} where date is yesterday (Helsinki)', async () => {
    const app = createApp(seededDb(ROWS));
    const res = await app.request('/api/prices/yesterday');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DayBody;
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots).toHaveLength(2);
    expect(body.date).toBe(shiftDate(getHelsinkiToday(), -1));
  });
});

describe('GET /tomorrow (audit #3963)', () => {
  it('200 with {slots, date} where date is tomorrow (Helsinki) when data exists', async () => {
    const app = createApp(seededDb(ROWS));
    const res = await app.request('/api/prices/tomorrow');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DayBody;
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots).toHaveLength(2);
    expect(body.date).toBe(shiftDate(getHelsinkiToday(), 1));
  });

  it('404 with an {error} message when tomorrow has no data yet', async () => {
    const app = createApp(seededDb([]));
    const res = await app.request('/api/prices/tomorrow');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not yet available/i);
  });
});
