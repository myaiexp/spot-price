// Route test: GET endpoints must not emit NaN when a NUMERIC column comes back
// non-numeric or NULL (audit #3125), nor 500 when a datetime is unparseable
// (finding #7134). node-postgres returns NUMERIC as a string; a NULL or
// malformed value makes parseFloat return NaN, which JSON-serialises to null
// and silently corrupts the response. An unparseable timestamp makes
// toISOString throw RangeError and would fail the whole /today, /range, or
// /now request. rowToPriceSlot drops both so the response carries only
// well-formed slots; valid rows pass through unchanged.
import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { makeSelectDb } from '../test-support/fake-db.js';
import type { Slot } from '../test-support/rows.js';

// Raw row as node-postgres yields it: NUMERIC columns are strings, but a NULL or
// malformed cell can surface as null/garbage — modelled here as `unknown`. This
// deliberately widens the shared RawRow (string prices / ISO datetime) to
// exercise both guards.
type MalformedRow = { datetime: unknown; priceNoTax: unknown; priceWithTax: unknown };

async function rangeSlots(rows: MalformedRow[]): Promise<Slot[]> {
  const app = createApp(makeSelectDb(rows));
  const res = await app.request('/api/prices/range?from=2026-03-10&to=2026-03-10');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { slots: Slot[] };
  return body.slots;
}

describe('toSlot numeric guard (audit #3125)', () => {
  const good: MalformedRow = { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: '5', priceWithTax: '6.275' };

  it('passes well-formed rows through unchanged', async () => {
    const slots = await rangeSlots([good]);
    expect(slots).toEqual([
      { datetime: '2026-03-10T08:00:00.000Z', priceNoTax: 5, priceWithTax: 6.275 },
    ]);
  });

  it('drops a row whose NUMERIC column is NULL rather than emitting NaN -> null', async () => {
    const bad: MalformedRow = { datetime: '2026-03-10T09:00:00.000Z', priceNoTax: null, priceWithTax: '6.275' };
    const slots = await rangeSlots([good, bad]);
    expect(slots).toHaveLength(1);
    expect(slots[0].datetime).toBe('2026-03-10T08:00:00.000Z');
  });

  it('drops a row whose NUMERIC column is a non-numeric string', async () => {
    const bad: MalformedRow = { datetime: '2026-03-10T10:00:00.000Z', priceNoTax: '5', priceWithTax: 'not-a-number' };
    const slots = await rangeSlots([good, bad]);
    expect(slots).toHaveLength(1);
    expect(slots[0].datetime).toBe('2026-03-10T08:00:00.000Z');
  });

  it('never emits NaN or null in price fields across a mixed batch', async () => {
    const rows: MalformedRow[] = [
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

  it('drops a row whose datetime is not a finite instant rather than 500ing the batch (finding #7134)', async () => {
    const rows: MalformedRow[] = [
      good,
      { datetime: 'not-a-timestamp', priceNoTax: '5', priceWithTax: '6.275' },
      { datetime: '', priceNoTax: '5', priceWithTax: '6.275' },
      { datetime: '2026-03-10T09:00:00.000Z', priceNoTax: null, priceWithTax: '6.275' },
      { datetime: '2026-03-10T11:00:00.000Z', priceNoTax: '7', priceWithTax: '8.785' },
    ];
    const slots = await rangeSlots(rows);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.datetime)).toEqual([
      '2026-03-10T08:00:00.000Z',
      '2026-03-10T11:00:00.000Z',
    ]);
  });
});
