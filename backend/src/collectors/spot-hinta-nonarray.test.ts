// Tests collectPrices' non-array upstream guard (audit #3968, finding #11901).
// spot-hinta.fi is expected to return a JSON array of slots. An error envelope,
// null, or a bare scalar is an ingestion outage: collectPrices throws so the
// collector CLI exits 1. Swallowing it as { upserted: 0 } records the systemd
// oneshot as success while today's slots stop updating. The empty-array case
// lives in the accounting test; this file is only bodies that are not arrays.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectPrices } from './spot-hinta.js';
import type { Db } from '../db/connection.js';
import { stubFetch } from '../test-support/fetch-stub.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectPrices non-array upstream guard (audit #3968, finding #11901)', () => {
  // Each entry is a NON-array JSON body. The guard must throw — a 200 with an
  // error object must not look like a successful collect of zero rows — and
  // must not touch the DB or warn as if slots had been filtered.
  const nonArrayBodies: Array<[string, unknown]> = [
    ['an error-envelope object', { error: 'rate limited' }],
    ['an empty object', {}],
    ['null', null],
    ['a bare number', 42],
    ['a bare string', 'unexpected'],
    ['a boolean', true],
  ];

  for (const [label, body] of nonArrayBodies) {
    it(`throws and never touches the DB for ${label}`, async () => {
      stubFetch(body);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const insertSpy = vi.fn();
      const db = { insert: insertSpy } as unknown as Db;

      await expect(collectPrices(db)).rejects.toThrow(
        'spot-hinta.fi returned a non-array payload',
      );
      expect(insertSpy).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  }
});
