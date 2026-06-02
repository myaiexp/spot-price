// Route tests for GET /api/prices/range calendar-date validation (audit #1610).
// A plain YYYY-MM-DD regex accepts impossible dates (2026-02-30, 2026-13-01);
// JS then silently shifts the queried range or throws on the invalid Date.
// These pin that well-formed-but-impossible dates are rejected with 400 while
// real edge dates (leap-day, year boundaries) still return 200.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';

// Minimal Db whose select-chain resolves to an empty result set. Valid-date
// requests reach the query and get 200 with []; invalid-date requests are
// rejected before the chain is ever awaited.
function fakeDb(): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve([] as unknown[]),
  };
  return { select: () => chain } as unknown as Db;
}

async function rangeStatus(from: string, to: string): Promise<number> {
  const app = createApp(fakeDb());
  const res = await app.request(`/api/prices/range?from=${from}&to=${to}`);
  return res.status;
}

describe('GET /range calendar-date validation (audit #1610)', () => {
  const invalid: Array<[string, string]> = [
    ['2026-02-30', 'Feb 30 (JS silently normalises to Mar 2)'],
    ['2026-13-01', 'month 13'],
    ['2026-00-01', 'month 00'],
    ['2026-01-00', 'day 00'],
    ['2025-02-29', 'Feb 29 on a non-leap year'],
  ];

  for (const [date, why] of invalid) {
    it(`rejects ${date} — ${why} — with 400 (as from)`, async () => {
      expect(await rangeStatus(date, '2026-03-10')).toBe(400);
    });
    it(`rejects ${date} — ${why} — with 400 (as to)`, async () => {
      expect(await rangeStatus('2026-03-01', date)).toBe(400);
    });
  }

  it('returns a clear "valid calendar dates" error message', async () => {
    const app = createApp(fakeDb());
    const res = await app.request('/api/prices/range?from=2026-02-30&to=2026-03-10');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid calendar date/i);
  });

  const valid: Array<[string, string]> = [
    ['2024-02-29', 'Feb 29 on a leap year'],
    ['2026-12-31', 'year end'],
    ['2026-01-01', 'year start'],
  ];

  for (const [date, why] of valid) {
    it(`accepts ${date} — ${why} — with 200`, async () => {
      // from==to keeps the single-day range well under the 90-day cap.
      expect(await rangeStatus(date, date)).toBe(200);
    });
  }
});
