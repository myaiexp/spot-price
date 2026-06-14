// Route tests for the GET /api/prices/range request contract.
//
// audit #1610 — calendar-date validation: a plain YYYY-MM-DD regex accepts
// impossible dates (2026-02-30, 2026-13-01); JS then silently shifts the queried
// range or throws on the invalid Date. Pin that well-formed-but-impossible dates
// are rejected with 400 while real edge dates (leap-day, year boundaries) still
// return 200.
//
// audit #3131 — full request contract: missing, unparseable, and reversed
// (from > to) ranges must 400 with a clear error rather than masking the client
// mistake behind an empty 200. The from === to boundary is deliberately a valid
// single-day query (to is inclusive), so it returns that day's slots — not an
// error and not an empty array.
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

// Db whose select-chain resolves to the given raw rows (string numerics, as
// node-postgres returns NUMERIC). Lets a request prove it returns real data.
function seededDb(rows: Array<{ datetime: string; priceNoTax: string; priceWithTax: string }>): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
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

describe('GET /range request contract (audit #3131)', () => {
  async function rangeBody(query: string): Promise<{ status: number; body: { error?: string; slots?: unknown[]; from?: string; to?: string } }> {
    const app = createApp(fakeDb());
    const res = await app.request(`/api/prices/range${query}`);
    return { status: res.status, body: await res.json() };
  }

  // --- Missing params: a client mistake, not "no data". ---
  it('400 when "from" is missing', async () => {
    const { status } = await rangeBody('?to=2026-03-10');
    expect(status).toBe(400);
  });
  it('400 when "to" is missing', async () => {
    const { status } = await rangeBody('?from=2026-03-01');
    expect(status).toBe(400);
  });
  it('400 when both params are missing', async () => {
    const { status, body } = await rangeBody('');
    expect(status).toBe(400);
    expect(body.error).toMatch(/required/i);
  });

  // --- Unparseable: not YYYY-MM-DD at all. ---
  it('400 for non-date garbage', async () => {
    expect(await rangeStatus('not-a-date', '2026-03-10')).toBe(400);
  });
  it('400 for DD-MM-YYYY (wrong field order/format)', async () => {
    expect(await rangeStatus('10-03-2026', '15-03-2026')).toBe(400);
  });
  it('400 for an empty-string param', async () => {
    const { status } = await rangeBody('?from=&to=2026-03-10');
    expect(status).toBe(400);
  });

  // --- Reversed: from strictly after to. ---
  it('400 when from is after to, with an "on or before" message', async () => {
    const { status, body } = await rangeBody('?from=2026-03-10&to=2026-03-05');
    expect(status).toBe(400);
    expect(body.error).toMatch(/on or before/i);
  });

  // --- 90-day cap still enforced for an otherwise-valid forward range. ---
  it('400 when the range exceeds 90 days', async () => {
    const { status, body } = await rangeBody('?from=2026-01-01&to=2026-06-01');
    expect(status).toBe(400);
    expect(body.error).toMatch(/90 days/i);
  });

  // --- The #3131 boundary: from === to is a valid single-day query that
  //     returns that day's slots — NOT a 400 and NOT an empty array. ---
  it('200 with the single day\'s slots when from === to', async () => {
    const row = { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: '5', priceWithTax: '6.275' };
    const app = createApp(seededDb([row]));
    const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: unknown[]; from: string; to: string };
    expect(body.slots).toHaveLength(1);
    expect(body.from).toBe('2026-03-10');
    expect(body.to).toBe('2026-03-10');
  });

  // --- A valid forward range likewise returns its data. ---
  it('200 with slots for a valid multi-day forward range', async () => {
    const rows = [
      { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: '5', priceWithTax: '6.275' },
      { datetime: '2026-03-11T08:00:00.000Z', priceNoTax: '7', priceWithTax: '8.785' },
    ];
    const app = createApp(seededDb(rows));
    const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-11');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: unknown[] };
    expect(body.slots).toHaveLength(2);
  });
});
