// Route test: GET /now reports the correct percentile (audit #3969). The /now
// body carries a `percentile` field — "what % of today's slots are cheaper than
// the current one" — but no test ever asserted its value, so the percentile
// arithmetic (strict `< currentSlot.priceWithTax`, divided by today's slot count,
// rounded) could regress unnoticed. These pin known distributions to known
// percentiles, including the cheapest-slot floor of 0.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';

type RawRow = { datetime: string; priceNoTax: string; priceWithTax: string };

// Db whose select-chain resolves to the given rows regardless of the queried day.
// /now issues two day-scoped SELECTs (today, then yesterday); serving the same
// rows for both is fine here — percentile is computed from today's slots only,
// and the yesterday lookup just resolves to some slot we don't assert on.
function seededDb(rows: RawRow[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

// priceNoTax is irrelevant to the percentile (which keys on priceWithTax); set it
// equal to priceWithTax for brevity.
const row = (datetime: string, priceWithTax: number): RawRow => ({
  datetime,
  priceNoTax: String(priceWithTax),
  priceWithTax: String(priceWithTax),
});

type Slot = { datetime: string; priceNoTax: number; priceWithTax: number };
type NowBody = { slot: Slot; percentile: number; yesterdaySlot: Slot | null };

// Drive /now at a fixed instant so a known slot is "current". now =
// 2026-01-15T12:15:00Z = 14:15 Helsinki (EET, winter — no DST edge), which lands
// inside the 12:15Z slot of the fixtures below.
async function nowPercentile(rows: RawRow[]): Promise<{ status: number; body: NowBody }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-15T12:15:00.000Z'));
  const app = createApp(seededDb(rows));
  const res = await app.request('/api/prices/now');
  return { status: res.status, body: (await res.json()) as NowBody };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /now percentile (audit #3969)', () => {
  it('current slot dearer than 4 of 5 slots -> percentile 80', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 1),
      row('2026-01-15T12:15:00.000Z', 9), // current (14:15) — most expensive
      row('2026-01-15T12:30:00.000Z', 2),
      row('2026-01-15T12:45:00.000Z', 3),
      row('2026-01-15T13:00:00.000Z', 4),
    ];
    const { status, body } = await nowPercentile(rows);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
    // 4 of 5 slots are strictly cheaper -> round(4/5 * 100) = 80.
    expect(body.percentile).toBe(80);
  });

  it('current slot is the cheapest -> percentile 0 (nothing strictly cheaper)', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 9),
      row('2026-01-15T12:15:00.000Z', 1), // current (14:15) — cheapest
      row('2026-01-15T12:30:00.000Z', 8),
      row('2026-01-15T12:45:00.000Z', 7),
      row('2026-01-15T13:00:00.000Z', 6),
    ];
    const { status, body } = await nowPercentile(rows);
    expect(status).toBe(200);
    expect(body.slot.datetime).toBe('2026-01-15T12:15:00.000Z');
    expect(body.percentile).toBe(0);
  });

  it('current slot is the median of 5 -> percentile 40', async () => {
    const rows = [
      row('2026-01-15T12:00:00.000Z', 1),
      row('2026-01-15T12:15:00.000Z', 3), // current (14:15) — 2 cheaper, 2 dearer
      row('2026-01-15T12:30:00.000Z', 2),
      row('2026-01-15T12:45:00.000Z', 4),
      row('2026-01-15T13:00:00.000Z', 5),
    ];
    const { status, body } = await nowPercentile(rows);
    expect(status).toBe(200);
    // 2 of 5 slots are strictly cheaper -> round(2/5 * 100) = 40.
    expect(body.percentile).toBe(40);
  });
});
