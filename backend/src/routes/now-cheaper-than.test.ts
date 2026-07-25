// Route test: GET /now reports the correct cheap-rank (audit #3969, #5549). The
// /now body carries `cheaperThanPercent` — "what % of today's slots cost MORE
// than the current one", so high = cheap — and the hero card's green/amber/red
// tint plus its "Halvempi kuin X% tänään" copy read it directly. The field was
// once a bottom-up `percentile` (share *cheaper* than current), which made the
// hero paint peak prices green; these pin the polarity and the arithmetic
// (strict `>`, divided by today's slot count, rounded) so it can't flip back.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
// Same rows answer both of /now's day-scoped SELECTs (today, then yesterday);
// the rank is computed from today's slots only, so the yesterday lookup just
// resolves to a slot we don't assert on.
import { makeSelectDb as seededDb } from '../test-support/fake-db.js';
import { row, type RawRow, type Slot } from '../test-support/rows.js';
// Cross-layer guard: assert the hero's own band function on the value this
// endpoint really returns, so a polarity flip on either side of the wire fails
// here — not silently in the browser.
import { heroBand } from '../../../frontend/js/hero-calc.js';

type NowBody = { slot: Slot; cheaperThanPercent: number; yesterdaySlot: Slot | null };

// Drive /now at a fixed instant so a known slot is "current". now =
// 2026-01-15T12:15:00Z = 14:15 Helsinki (EET, winter — no DST edge), which lands
// inside the 12:15Z slot of the fixtures below.
async function nowRank(rows: RawRow[]): Promise<{ status: number; body: NowBody }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-15T12:15:00.000Z'));
  const app = createApp(seededDb(rows));
  const res = await app.request('/api/prices/now');
  return { status: res.status, body: (await res.json()) as NowBody };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /now cheaperThanPercent (audit #3969, #5549)', () => {
  it('current slot is the cheapest of 5 -> 80 (4 of 5 cost more)', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 9),
      row('2026-01-15T12:15:00.000Z', 1), // current (14:15) — cheapest
      row('2026-01-15T12:30:00.000Z', 8),
      row('2026-01-15T12:45:00.000Z', 7),
      row('2026-01-15T13:00:00.000Z', 6),
    ];
    const { status, body } = await nowRank(rows);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
    // 4 of 5 slots are strictly dearer -> round(4/5 * 100) = 80. High = cheap,
    // so the hero tints this green — the whole point of the field.
    expect(body.cheaperThanPercent).toBe(80);
    expect(heroBand(body.cheaperThanPercent)).toBe('cheap');
  });

  it('current slot is the most expensive -> 0 (nothing costs more)', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 1),
      row('2026-01-15T12:15:00.000Z', 9), // current (14:15) — most expensive
      row('2026-01-15T12:30:00.000Z', 2),
      row('2026-01-15T12:45:00.000Z', 3),
      row('2026-01-15T13:00:00.000Z', 4),
    ];
    const { status, body } = await nowRank(rows);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
    expect(body.cheaperThanPercent).toBe(0);
    expect(heroBand(body.cheaperThanPercent)).toBe('expensive');
  });

  it('current slot is the median of 5 -> 40', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 1),
      row('2026-01-15T12:15:00.000Z', 3), // current (14:15) — 2 cheaper, 2 dearer
      row('2026-01-15T12:30:00.000Z', 2),
      row('2026-01-15T12:45:00.000Z', 4),
      row('2026-01-15T13:00:00.000Z', 5),
    ];
    const { status, body } = await nowRank(rows);
    expect(status).toBe(200);
    // 2 of 5 slots are strictly dearer -> round(2/5 * 100) = 40.
    expect(body.cheaperThanPercent).toBe(40);
  });

  it('ties count for neither side: equal-priced slots do not inflate the rank', async () => {
    // The four 15-min slots of one hourly source price share a value, so ties are
    // the normal case, not an edge case: only strictly dearer slots count.
    const rows = [
      row('2026-01-15T12:00:00.000Z', 3), // tie with current
      row('2026-01-15T12:15:00.000Z', 3), // current (14:15)
      row('2026-01-15T12:30:00.000Z', 3), // tie with current
      row('2026-01-15T12:45:00.000Z', 9), // dearer
    ];
    const { status, body } = await nowRank(rows);
    expect(status).toBe(200);
    expect(body.cheaperThanPercent).toBe(25); // 1 of 4 dearer, ties excluded
  });
});
