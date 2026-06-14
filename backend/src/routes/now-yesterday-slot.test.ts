// Route test: GET /now matches yesterday's slot at the same Helsinki WALL-CLOCK
// time (audit #3124). The match is intentionally wall-clock-based, not 24h-ago
// (UTC instant): for electricity prices the meaningful "yesterday at this time"
// is the same local hour (peaks are wall-clock-anchored), and the whole codebase
// keys days by Helsinki local time. These tests pin that semantic across DST so a
// future switch to UTC-instant matching (which would change which slot users see)
// trips here and forces a conscious decision.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';

type RawRow = { datetime: string; priceNoTax: string; priceWithTax: string };

// Fake Db for /now: the handler issues exactly two SELECTs in order — today's
// slots first, then yesterday's. Serve todayRows on the 1st select(), yesterdayRows
// on the 2nd. The WHERE clause is ignored (rows are pre-scoped to the right day),
// so seed each list already sorted ascending, matching db ... orderBy(asc).
function twoQueryDb(todayRows: RawRow[], yesterdayRows: RawRow[]): Db {
  let call = 0;
  return {
    select: () => {
      call += 1;
      const rows = call === 1 ? todayRows : yesterdayRows;
      return { from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }) };
    },
  } as unknown as Db;
}

const slot = (datetime: string, price: number): RawRow => ({
  datetime,
  priceNoTax: String(price),
  priceWithTax: String(price * 1.255),
});

type Slot = { datetime: string; priceNoTax: number; priceWithTax: number };

async function nowResponse(nowIso: string, todayRows: RawRow[], yesterdayRows: RawRow[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(nowIso));
  const app = createApp(twoQueryDb(todayRows, yesterdayRows));
  const res = await app.request('/api/prices/now');
  return { status: res.status, body: (await res.json()) as { slot: Slot; percentile: number; yesterdaySlot: Slot | null } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /now yesterday-slot wall-clock matching (audit #3124)', () => {
  it('normal winter day: matches yesterday at the same Helsinki wall-clock time', async () => {
    // now = 2026-01-15T12:15Z = 14:15 Helsinki (EET, +2).
    const today = [
      slot('2026-01-15T12:00:00.000Z', 5), // 14:00
      slot('2026-01-15T12:15:00.000Z', 6), // 14:15 <- current
      slot('2026-01-15T12:30:00.000Z', 7), // 14:30
    ];
    const yesterday = [
      slot('2026-01-14T12:00:00.000Z', 10), // 14:00
      slot('2026-01-14T12:15:00.000Z', 11), // 14:15 <- expected match
      slot('2026-01-14T12:30:00.000Z', 12), // 14:30
    ];
    const { status, body } = await nowResponse('2026-01-15T12:15:00.000Z', today, yesterday);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
    expect(body.yesterdaySlot?.datetime).toBe('2026-01-14T12:15:00.000Z');
    expect(body.yesterdaySlot?.priceNoTax).toBe(11);
  });

  it('spring-forward: a current wall-clock time that never existed yesterday yields null (not the 24h-ago slot)', async () => {
    // now = 2026-03-30T00:30Z = 03:30 Helsinki (EEST, +3), the day after
    // spring-forward. Yesterday (2026-03-29) skipped local 03:00->04:00, so it
    // has NO 03:30 slot. Wall-clock semantics -> null. A UTC-24h match would
    // instead surface yesterday's 02:30 (UTC 2026-03-29T00:30Z) -> this asserts
    // we do NOT do that.
    const today = [
      slot('2026-03-30T00:15:00.000Z', 5), // 03:15
      slot('2026-03-30T00:30:00.000Z', 6), // 03:30 <- current
      slot('2026-03-30T00:45:00.000Z', 7), // 03:45
    ];
    const yesterday = [
      slot('2026-03-29T00:00:00.000Z', 10), // 02:00 EET
      slot('2026-03-29T00:15:00.000Z', 11), // 02:15 EET
      slot('2026-03-29T00:30:00.000Z', 12), // 02:30 EET  (24h-ago instant — must NOT match)
      slot('2026-03-29T01:00:00.000Z', 13), // 04:00 EEST (post-jump)
    ];
    const { status, body } = await nowResponse('2026-03-30T00:30:00.000Z', today, yesterday);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-03-30T00:30:00.000Z');
    expect(body.yesterdaySlot).toBeNull();
  });

  it('fall-back: when yesterday repeats the wall-clock hour, matches the first (earliest) occurrence', async () => {
    // now = 2026-10-26T01:30Z = 03:30 Helsinki (EET, +2), the day after
    // fall-back. Yesterday (2026-10-25) repeated local 03:00->04:00, so it has
    // TWO 03:30 slots: EEST (UTC 00:30) then EET (UTC 01:30). The match resolves
    // the tie deterministically to the earliest instant.
    const today = [
      slot('2026-10-26T01:15:00.000Z', 5), // 03:15
      slot('2026-10-26T01:30:00.000Z', 6), // 03:30 <- current
      slot('2026-10-26T01:45:00.000Z', 7), // 03:45
    ];
    const yesterday = [
      slot('2026-10-25T00:30:00.000Z', 10), // 03:30 EEST (first occurrence) <- expected
      slot('2026-10-25T01:30:00.000Z', 20), // 03:30 EET  (second occurrence)
    ];
    const { status, body } = await nowResponse('2026-10-26T01:30:00.000Z', today, yesterday);
    expect(status).toBe(200);
    expect(body.yesterdaySlot?.datetime).toBe('2026-10-25T00:30:00.000Z');
    expect(body.yesterdaySlot?.priceNoTax).toBe(10);
  });
});
