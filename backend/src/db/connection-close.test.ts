// closeDb must end the underlying pg.Pool so connections are released on
// shutdown and tests don't leak sockets (audit #3914).
import { describe, it, expect, vi } from 'vitest';
import { closeDb } from './connection.js';
import type { Db } from './connection.js';

describe('closeDb (audit #3914)', () => {
  it('ends the underlying pool exactly once', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const db = { $client: { end } } as unknown as Db;

    await closeDb(db);

    expect(end).toHaveBeenCalledTimes(1);
  });

  it('awaits the pool drain (propagates the end() promise)', async () => {
    let drained = false;
    const end = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            drained = true;
            resolve();
          }, 5),
        ),
    );
    const db = { $client: { end } } as unknown as Db;

    await closeDb(db);

    expect(drained).toBe(true);
  });
});
