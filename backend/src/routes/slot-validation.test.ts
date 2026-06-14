// Route test: GET endpoints must not emit NaN when a NUMERIC column comes back
// non-numeric or NULL (audit #3125). node-postgres returns NUMERIC as a string;
// a NULL or malformed value makes parseFloat return NaN, which JSON-serialises to
// null and silently corrupts the response. toSlot now drops such rows so the
// response carries only well-formed slots; valid rows pass through unchanged.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/connection.js';

// Raw row as node-postgres yields it: NUMERIC columns are strings, but a NULL or
// malformed cell can surface as null/garbage — modelled here as `unknown`.
type RawRow = { datetime: string; priceNoTax: unknown; priceWithTax: unknown };

// Db whose select-chain resolves to the given raw rows (the fake ignores the
// WHERE clause, so seeded rows pass straight through mapSlots regardless of date).
function seededDb(rows: RawRow[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

type Slot = { datetime: string; priceNoTax: number; priceWithTax: number };

async function rangeSlots(rows: RawRow[]): Promise<Slot[]> {
  const app = createApp(seededDb(rows));
  const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-10');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { slots: Slot[] };
  return body.slots;
}

describe('toSlot numeric guard (audit #3125)', () => {
  const good: RawRow = { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: '5', priceWithTax: '6.275' };

  it('passes well-formed rows through unchanged', async () => {
    const slots = await rangeSlots([good]);
    expect(slots).toEqual([
      { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: 5, priceWithTax: 6.275 },
    ]);
  });

  it('drops a row whose NUMERIC column is NULL rather than emitting NaN -> null', async () => {
    const bad: RawRow = { datetime: '2026-03-10T09:00:00.000Z', priceNoTax: null, priceWithTax: '6.275' };
    const slots = await rangeSlots([good, bad]);
    expect(slots).toHaveLength(1);
    expect(slots[0].datetime).toBe('2026-03-10T08:00:00.000Z');
  });

  it('drops a row whose NUMERIC column is a non-numeric string', async () => {
    const bad: RawRow = { datetime: '2026-03-10T10:00:00.000Z', priceNoTax: '5', priceWithTax: 'not-a-number' };
    const slots = await rangeSlots([good, bad]);
    expect(slots).toHaveLength(1);
    expect(slots[0].datetime).toBe('2026-03-10T08:00:00.000Z');
  });

  it('never emits NaN or null in price fields across a mixed batch', async () => {
    const rows: RawRow[] = [
      good,
      { datetime: '2026-03-10T09:00:00.000Z', priceNoTax: null, priceWithTax: null },
      { datetime: '2026-03-10T10:00:00.000Z', priceNoTax: 'x', priceWithTax: '6.275' },
      { datetime: '2026-03-10T11:00:00.000Z', priceNoTax: '7', priceWithTax: '8.785' },
    ];
    const slots = await rangeSlots(rows);
    expect(slots).toHaveLength(2);
    for (const s of slots) {
      expect(Number.isFinite(s.priceNoTax)).toBe(true);
      expect(Number.isFinite(s.priceWithTax)).toBe(true);
    }
  });
});
