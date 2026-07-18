// Route test: GET /now matches yesterday's slot at the same Helsinki WALL-CLOCK
// time (audit #3124). The match is intentionally wall-clock-based, not 24h-ago
// (UTC instant): for electricity prices the meaningful "yesterday at this time"
// is the same local hour (peaks are wall-clock-anchored), and the whole codebase
// keys days by Helsinki local time. These tests pin that semantic across DST so a
// future switch to UTC-instant matching (which would change which slot users see)
// trips here and forces a conscious decision.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { getHelsinkiToday, getHelsinkiDateRange, shiftDate } from '../utils/helsinki-time.js';
import { taxedRow as slot, type RawRow, type Slot } from '../test-support/rows.js';
import { makeWindowKeyedDb } from '../test-support/window-db.js';

// Fake Db for /now. The handler issues two day-scoped SELECTs — today's slots and
// yesterday's — each filtering prices.datetime to that day's UTC range with
// `gte(start) AND lt(end)`. makeWindowKeyedDb matches each query to its fixture
// by the day it actually requests (its gte lower bound == start-of-day key),
// throwing on an unmapped day — so reordering or adding a query can't silently
// return the wrong day's rows. Rows are pre-scoped per day and seeded ascending,
// matching the handler's orderBy(asc(datetime)).

async function nowResponse(nowIso: string, todayRows: RawRow[], yesterdayRows: RawRow[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(nowIso));
  // Key each fixture by the UTC start-of-day the handler will request, derived
  // from the faked clock with the SAME helsinki-time helpers the handler uses, so
  // the mapping stays in lockstep with the handler's day arithmetic across DST.
  const today = getHelsinkiToday();
  const yesterday = shiftDate(today, -1);
  const byDayStart = new Map<string, RawRow[]>([
    [getHelsinkiDateRange(today).start.toISOString(), todayRows],
    [getHelsinkiDateRange(yesterday).start.toISOString(), yesterdayRows],
  ]);
  const app = createApp(makeWindowKeyedDb(byDayStart));
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
