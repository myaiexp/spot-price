// Route test: GET /now degrades to the most recent *past* slot (flagged stale)
// when collection lags (audit #3, finding #7133). Past the last stored slot's
// window the handler used to 404 with "Current time slot not found"; it now
// returns that last slot with `stale: true`. A miss is not "always last of
// day": now before the first slot 404s, and an interior gap is stale with the
// preceding slot. Live `now` still returns the active 15-minute slot with
// `stale: false`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
// Same rows answer both of /now's day-scoped SELECTs (today + yesterday); the
// stale logic keys on today's slots only.
import { makeSelectDb as seededDb } from '../test-support/fake-db.js';
import { row, type RawRow, type Slot } from '../test-support/rows.js';

type NowBody = { slot: Slot; cheaperThanPercent: number; yesterdaySlot: Slot | null; stale: boolean };

async function nowAt(nowIso: string, rows: RawRow[]): Promise<{ status: number; body: NowBody }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(nowIso));
  const app = createApp(seededDb(rows));
  const res = await app.request('/api/prices/now');
  return { status: res.status, body: (await res.json()) as NowBody };
}

afterEach(() => {
  vi.useRealTimers();
});

// Winter day (2026-01-15, EET +2) so no DST edge interferes. Slots run only up
// to 14:30 Helsinki (12:30Z); its window is [12:30Z, 12:45Z).
const TODAY_ROWS = [
  row('2026-01-15T12:00:00.000Z', 3), // 14:00
  row('2026-01-15T12:15:00.000Z', 5), // 14:15
  row('2026-01-15T12:30:00.000Z', 9), // 14:30 — last available
];

describe('GET /now stale fallback (audit #3)', () => {
  it('now past the last slot window -> 200 with the last slot flagged stale', async () => {
    // now = 13:00Z = 15:00 Helsinki, 15 min past the last slot's window end.
    const { status, body } = await nowAt('2026-01-15T13:00:00.000Z', TODAY_ROWS);
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.slot.datetime).toBe('2026-01-15T12:30:00.000Z');
    // The cheap-rank is still computed against today's slots — and the served
    // slot is the dearest of them, so nothing costs more.
    expect(body.cheaperThanPercent).toBe(0);
  });

  it('now exactly at the last slot window end -> stale (boundary is exclusive)', async () => {
    // Last slot 12:30Z window is [12:30Z, 12:45Z); at 12:45Z it is no longer live.
    const { status, body } = await nowAt('2026-01-15T12:45:00.000Z', TODAY_ROWS);
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.slot.datetime).toBe('2026-01-15T12:30:00.000Z');
  });

  it('now within a live slot window -> 200 with that slot, stale false', async () => {
    // now = 12:20Z = 14:20 Helsinki, inside the 12:15Z slot window.
    const { status, body } = await nowAt('2026-01-15T12:20:00.000Z', TODAY_ROWS);
    expect(status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
  });

  it('still 404s when today has no slots at all', async () => {
    const { status } = await nowAt('2026-01-15T12:20:00.000Z', []);
    expect(status).toBe(404);
  });

  it('now before the first slot -> 404, not last-of-day (finding #7133)', async () => {
    // 11:00Z = 13:00 Helsinki, an hour before the first stored slot at 12:00Z.
    // Serving todaySlots[length-1] here would paint 14:30 as "now".
    const { status, body } = await nowAt('2026-01-15T11:00:00.000Z', TODAY_ROWS);
    expect(status).toBe(404);
    expect('slot' in body).toBe(false);
  });

  it('interior gap marks stale with the most recent past slot, not last-of-day (finding #7133)', async () => {
    // 12:00Z window is [12:00, 12:15); 12:30Z is the next stored slot. now at
    // 12:20Z sits in the hole. Backend used to extend the previous window to
    // the next start (live, not stale) while the frontend's findSlotContaining
    // uses a fixed 15 min — pin 15-min windows + stale fallback to the past slot.
    const gappy = [
      row('2026-01-15T12:00:00.000Z', 3),
      row('2026-01-15T12:30:00.000Z', 9),
    ];
    const { status, body } = await nowAt('2026-01-15T12:20:00.000Z', gappy);
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.slot.datetime).toBe('2026-01-15T12:00:00.000Z');
  });
});
