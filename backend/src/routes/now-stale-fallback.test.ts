// Route test: GET /now degrades to the most recent slot (flagged stale) when
// collection lags (audit #3). Previously, if `now` sat past the last stored
// slot's window the handler 404'd with "Current time slot not found", so the UI
// showed nothing every time collection was late. The handler now returns the
// last available slot with `stale: true` instead, while a live `now` still
// returns the active slot with `stale: false`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';

type RawRow = { datetime: string; priceNoTax: string; priceWithTax: string };

// Db whose select-chain resolves to the given rows for any queried day (today
// and yesterday both get these). Stale logic keys on today's slots only.
function seededDb(rows: RawRow[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

const row = (datetime: string, price: number): RawRow => ({
  datetime,
  priceNoTax: String(price),
  priceWithTax: String(price),
});

type Slot = { datetime: string; priceNoTax: number; priceWithTax: number };
type NowBody = { slot: Slot; percentile: number; yesterdaySlot: Slot | null; stale: boolean };

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
    // Percentile is still computed against today's slots (last slot is dearest).
    expect(body.percentile).toBe(67); // round(2/3 * 100)
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
});
