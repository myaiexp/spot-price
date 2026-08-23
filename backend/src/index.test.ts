// Server-entry shutdown contract (finding #7905).
//
// closeDb is unit-tested in isolation, but nothing drove main()'s SIGTERM path:
// stop accepting → drain in-flight (server.close callback) → end the pool →
// process.exit(0), plus the 10s unref timeout when close never settles, plus
// DATABASE_URL missing throwing before listen. Deploy restarts the unit with
// SIGTERM; a hang, a closeDb-first swap, or a dropped process.exit would only
// show up as stuck systemd stops. serve/createDb/closeDb are mocked so this
// file never binds a port or opens a pool. isMainModule keeps the import from
// auto-starting under vitest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { closeDb, createDb } from './db/connection.js';
import { main } from './index.js';

vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));

vi.mock('./db/connection.js', () => ({
  createDb: vi.fn(),
  closeDb: vi.fn(),
}));

const mockServe = vi.mocked(serve);
const mockCreateDb = vi.mocked(createDb);
const mockCloseDb = vi.mocked(closeDb);

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const SHUTDOWN_TIMEOUT_MS = 10_000;

type SignalHandler = () => void;

function captureSignals(): Map<NodeJS.Signals, SignalHandler> {
  const handlers = new Map<NodeJS.Signals, SignalHandler>();
  vi.spyOn(process, 'once').mockImplementation(((
    event: string | symbol,
    listener: (...args: unknown[]) => void,
  ) => {
    if (event === 'SIGTERM' || event === 'SIGINT') {
      handlers.set(event, listener as SignalHandler);
    }
    return process;
  }) as typeof process.once);
  return handlers;
}

function hangingServer() {
  let closeCb: (() => void) | undefined;
  const server = {
    close: vi.fn((cb?: (err?: Error) => void) => {
      closeCb = cb;
    }),
  };
  mockServe.mockReturnValue(server as unknown as ReturnType<typeof serve>);
  return {
    server,
    settleClose: () => {
      closeCb?.();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockServe.mockReset();
  mockCreateDb.mockReset();
  mockCloseDb.mockReset();
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockCloseDb.mockResolvedValue(undefined);
});

describe('main() startup', () => {
  it('importing the module does not listen (isMainModule guards vitest)', () => {
    expect(mockServe).not.toHaveBeenCalled();
    expect(mockCreateDb).not.toHaveBeenCalled();
  });

  it('missing DATABASE_URL throws before createDb or listen', () => {
    delete process.env.DATABASE_URL;
    expect(() => main()).toThrow('DATABASE_URL environment variable is required');
    expect(mockCreateDb).not.toHaveBeenCalled();
    expect(mockServe).not.toHaveBeenCalled();
  });
});

describe('main() graceful shutdown', () => {
  it('SIGTERM awaits server.close, then closeDb, then process.exit(0)', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
    const { server, settleClose } = hangingServer();
    const fakeDb = { tag: 'shutdown-db' };
    mockCreateDb.mockReturnValue(fakeDb as never);

    let finishCloseDb!: () => void;
    let sawCloseDb!: () => void;
    const closeDbStarted = new Promise<void>((resolve) => {
      sawCloseDb = resolve;
    });
    mockCloseDb.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          sawCloseDb();
          finishCloseDb = resolve;
        }),
    );

    process.env.DATABASE_URL = 'postgres://spot-price-shutdown-test';
    const handlers = captureSignals();
    main();

    expect(mockCreateDb).toHaveBeenCalledWith('postgres://spot-price-shutdown-test');
    expect(mockServe).toHaveBeenCalledTimes(1);
    expect(handlers.has('SIGTERM')).toBe(true);
    expect(handlers.has('SIGINT')).toBe(true);

    handlers.get('SIGTERM')!();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(mockCloseDb).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    settleClose();
    await closeDbStarted;
    expect(mockCloseDb).toHaveBeenCalledWith(fakeDb);
    expect(exit).not.toHaveBeenCalled();

    finishCloseDb();
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  it('if server.close never settles, the 10s guard still closeDb then exit', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
    const server = { close: vi.fn() };
    mockServe.mockReturnValue(server as unknown as ReturnType<typeof serve>);
    mockCreateDb.mockReturnValue({ tag: 'timeout-db' } as never);
    mockCloseDb.mockResolvedValue(undefined);

    process.env.DATABASE_URL = 'postgres://spot-price-shutdown-test';
    const handlers = captureSignals();
    main();

    // SIGINT shares shutdown() with SIGTERM; fire it here so both signals
    // actually drive the path, not just get registered.
    handlers.get('SIGINT')!();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(mockCloseDb).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
    expect(mockCloseDb).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockCloseDb).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(console.warn).toHaveBeenCalledWith(
      `Shutdown: server.close did not settle within ${SHUTDOWN_TIMEOUT_MS}ms, draining anyway`,
    );
  });
});
