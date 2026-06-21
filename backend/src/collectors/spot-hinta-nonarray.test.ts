// Tests collectPrices' non-array upstream guard (audit #3968). spot-hinta.fi is
// expected to return a JSON array of slots; the guard `!Array.isArray(slots)`
// defends against an upstream that returns something else entirely — an error
// envelope object, null, or a bare scalar — by treating it as "nothing to do"
// (upserted: 0) instead of crashing on `.filter`/`.length`. The existing
// accounting test covers the empty-array branch (length 0); this covers the
// other half of the guard: a body that is not an array at all.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import type { Db } from '../db/connection.js';

function stubFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => body })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('collectPrices non-array upstream guard (audit #3968)', () => {
  // Each entry is a NON-array JSON body the guard must reject — without throwing
  // and without touching the DB.
  const nonArrayBodies: Array<[string, unknown]> = [
    ['an error-envelope object', { error: 'rate limited' }],
    ['an empty object', {}],
    ['null', null],
    ['a bare number', 42],
    ['a bare string', 'unexpected'],
    ['a boolean', true],
  ];

  for (const [label, body] of nonArrayBodies) {
    it(`returns upserted 0 and never touches the DB for ${label}`, async () => {
      stubFetch(body);
      const insertSpy = vi.fn();
      const db = { insert: insertSpy } as unknown as Db;

      const result = await collectPrices(db);

      expect(result.upserted).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
    });
  }
});
