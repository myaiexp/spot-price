// Tests for the dashboard load orchestrator (../../frontend/js/load.js).
// Abort-supersede must not paint an error over a newer load, a superseded
// resolve must not overwrite state, render exceptions stay isolated from fetch
// failures, a cold heatmap rejection calls showHeatmapError, a day-data fetch
// failure still starts the heatmap, and a refresh blip keeps last-known-good
// data instead of wiping the hero or the heatmap grid (findings #7136, #7109,
// #7108, #7102, #7101, #7621, #9580, #9930).

import { describe, it, expect } from 'vitest';
import { createLoader, createSlotRefresh } from '../../frontend/js/load.js';

const TODAY = { slots: [{ datetime: '2026-07-18T00:00:00.000Z' }] };
const NOW = { slot: { priceWithTax: 0.05 } };
const HEATMAP = { matrix: [[]], minPrice: 0, maxPrice: 1 };
const SLOT_MS = 15 * 60 * 1000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function makeHarness({ chartThrows = false, ...overrides } = {}) {
  const calls = {
    showError: [],
    showHeatmapError: [],
    renderers: [],
    apply: [],
    applyHeatmap: [],
    renderHeatmap: 0,
    fetchHeatmap: 0,
    noteStale: 0,
    logError: [],
  };
  let cached = null;
  let cachedHeatmap = null;
  const deps = {
    fetchPriceBundle: async () => ({ today: TODAY, yesterday: null, tomorrow: null, now: NOW }),
    fetchHeatmap: async () => HEATMAP,
    applyPriceBundle: (bundle) => {
      calls.apply.push(bundle);
      cached = bundle.today;
    },
    applyHeatmap: (heatmap) => {
      calls.applyHeatmap.push(heatmap);
      cachedHeatmap = heatmap;
    },
    renderers: [
      { name: 'hero', run: () => calls.renderers.push('hero') },
      {
        name: 'chart',
        run: () => {
          calls.renderers.push('chart');
          if (chartThrows) throw new ReferenceError('Chart is not defined');
        },
      },
      { name: 'insights', run: () => calls.renderers.push('insights') },
      { name: 'estimator', run: () => calls.renderers.push('estimator') },
    ],
    renderHeatmap: () => {
      calls.renderHeatmap += 1;
    },
    showError: (msg) => calls.showError.push(msg),
    showHeatmapError: () => calls.showHeatmapError.push(true),
    hasCachedData: () => !!cached,
    hasCachedHeatmap: () => cachedHeatmap != null,
    noteStale: () => {
      calls.noteStale += 1;
    },
    logError: (...args) => calls.logError.push(args),
    ...overrides,
  };
  const innerFetchHeatmap = deps.fetchHeatmap;
  deps.fetchHeatmap = (signal) => {
    calls.fetchHeatmap += 1;
    return innerFetchHeatmap(signal);
  };
  return { loader: createLoader(deps), deps, calls };
}

describe('createLoader abort-supersede', () => {
  it('aborts the previous in-flight controller when a new load starts', () => {
    const signals = [];
    const { loader } = makeHarness({
      fetchPriceBundle: (signal) => {
        signals.push(signal);
        return new Promise(() => {});
      },
    });
    loader.load();
    expect(signals[0].aborted).toBe(false);
    loader.load();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('does not call showError when an aborted load rejects', async () => {
    const first = deferred();
    let n = 0;
    const { loader, calls } = makeHarness({
      fetchPriceBundle: (signal) => {
        n += 1;
        if (n === 1) {
          signal.addEventListener('abort', () => first.reject(abortError()));
          return first.promise;
        }
        return Promise.resolve({ today: TODAY, yesterday: null, tomorrow: null, now: NOW });
      },
    });
    const p1 = loader.load();
    const p2 = loader.load();
    await p1;
    await p2;
    expect(calls.showError).toEqual([]);
  });

  it('does not apply or render a superseded load that resolves after a newer one', async () => {
    const first = deferred();
    let n = 0;
    const newer = { slots: [{ datetime: 'newer' }] };
    const { loader, calls } = makeHarness({
      fetchPriceBundle: () => {
        n += 1;
        if (n === 1) return first.promise;
        return Promise.resolve({ today: newer, yesterday: null, tomorrow: { slots: [1] }, now: NOW });
      },
    });
    const p1 = loader.load();
    const p2 = loader.load();
    await p2;
    expect(calls.apply[0].today).toBe(newer);
    expect(calls.renderers).toEqual(['hero', 'chart', 'insights', 'estimator']);
    first.resolve({ today: TODAY, yesterday: null, tomorrow: null, now: NOW });
    await p1;
    expect(calls.apply).toHaveLength(1);
    expect(calls.apply[0].today).toBe(newer);
    expect(calls.renderers).toEqual(['hero', 'chart', 'insights', 'estimator']);
  });
});

describe('createLoader fetch vs render isolation', () => {
  it('calls showError on a non-abort fetch rejection with no cached data', async () => {
    const { loader, calls } = makeHarness({
      fetchPriceBundle: async () => {
        throw new Error('network down');
      },
    });
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showError).toHaveLength(1);
    expect(calls.showError[0]).toMatch(/Tietojen lataus epäonnistui/);
    expect(calls.noteStale).toBe(0);
    expect(calls.apply).toEqual([]);
    expect(calls.renderers).toEqual([]);
    expect(calls.fetchHeatmap).toBe(1);
    expect(calls.applyHeatmap).toEqual([HEATMAP]);
    expect(calls.showHeatmapError).toEqual([]);
    expect(calls.renderHeatmap).toBe(1);
  });

  it('keeps last-known-good data on a refresh failure instead of showError', async () => {
    const { loader, deps, calls } = makeHarness();
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.apply).toHaveLength(1);
    expect(calls.fetchHeatmap).toBe(1);
    deps.fetchPriceBundle = async () => {
      throw new Error('blip');
    };
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showError).toEqual([]);
    expect(calls.noteStale).toBe(1);
    expect(calls.apply).toHaveLength(1);
    expect(calls.fetchHeatmap).toBe(2);
    expect(calls.applyHeatmap).toEqual([HEATMAP, HEATMAP]);
    expect(calls.showHeatmapError).toEqual([]);
  });

  it('still runs later renderers when one throws, and does not showError', async () => {
    const { loader, calls } = makeHarness({ chartThrows: true });
    await loader.load();
    expect(calls.renderers).toEqual(['hero', 'chart', 'insights', 'estimator']);
    expect(calls.showError).toEqual([]);
    expect(calls.logError.some((args) => String(args[0]).includes('chart'))).toBe(true);
  });
});

describe('createLoader heatmap failure', () => {
  it('calls showHeatmapError when heatmap throws after a day-data fetch failure', async () => {
    const { loader, calls } = makeHarness({
      fetchPriceBundle: async () => {
        throw new Error('network down');
      },
      fetchHeatmap: async () => {
        throw new Error('heatmap down');
      },
    });
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showError).toHaveLength(1);
    expect(calls.fetchHeatmap).toBe(1);
    expect(calls.showHeatmapError).toEqual([true]);
    expect(calls.renderHeatmap).toBe(0);
    expect(calls.applyHeatmap).toEqual([null]);
  });

  it('calls showHeatmapError on a cold heatmap rejection, not renderHeatmap', async () => {
    const { loader, calls } = makeHarness({
      fetchHeatmap: async () => {
        throw new Error('heatmap down');
      },
    });
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showHeatmapError).toEqual([true]);
    expect(calls.renderHeatmap).toBe(0);
    expect(calls.applyHeatmap).toEqual([null]);
    // Nothing was cached, so a second cold failure still shows the error.
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showHeatmapError).toEqual([true, true]);
  });

  it('keeps the last-known-good grid on a warm heatmap refresh failure', async () => {
    const { loader, deps, calls } = makeHarness();
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.renderHeatmap).toBe(1);
    deps.fetchHeatmap = async () => {
      throw new Error('502 Bad Gateway');
    };
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.applyHeatmap).toEqual([HEATMAP]);
    expect(calls.showHeatmapError).toEqual([]);
    expect(calls.renderHeatmap).toBe(1);
    expect(calls.logError.some((args) => String(args[0]).includes('heatmap'))).toBe(true);
  });

  it('keeps both hero and grid when a deploy restart fails the whole refresh', async () => {
    const { loader, deps, calls } = makeHarness();
    await loader.load();
    await loader.heatmapPromise;
    deps.fetchPriceBundle = async () => {
      throw new Error('502 Bad Gateway');
    };
    deps.fetchHeatmap = async () => {
      throw new Error('502 Bad Gateway');
    };
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showError).toEqual([]);
    expect(calls.noteStale).toBe(1);
    expect(calls.applyHeatmap).toEqual([HEATMAP]);
    expect(calls.showHeatmapError).toEqual([]);
  });

  it('does not treat a renderHeatmap throw as a heatmap load failure', async () => {
    const { loader, calls } = makeHarness({
      renderHeatmap: () => {
        throw new Error('DOM missing');
      },
    });
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.showHeatmapError).toEqual([]);
    expect(calls.applyHeatmap).toEqual([HEATMAP]);
    expect(calls.logError.some((args) => String(args[0]).includes('heatmap'))).toBe(true);
  });

  it('does not showHeatmapError when a superseded heatmap rejects', async () => {
    const heat = deferred();
    let n = 0;
    const { loader, calls } = makeHarness({
      fetchHeatmap: (signal) => {
        n += 1;
        if (n === 1) {
          signal.addEventListener('abort', () => heat.reject(abortError()));
          return heat.promise;
        }
        return Promise.resolve(HEATMAP);
      },
    });
    const p1 = loader.load();
    await p1;
    const p2 = loader.load();
    await p2;
    await loader.heatmapPromise;
    expect(calls.showHeatmapError).toEqual([]);
    expect(calls.renderHeatmap).toBe(1);
    expect(calls.applyHeatmap).toEqual([HEATMAP]);
  });

  it('does not apply or render a superseded heatmap that resolves after a newer one', async () => {
    // A slow first heatmap that ignores abort and resolves late must not
    // overwrite the newer grid (mirrors the day-data superseded-resolve test).
    const heatA = deferred();
    const HEATMAP_A = { matrix: [[1]], minPrice: 1, maxPrice: 1 };
    const HEATMAP_B = { matrix: [[2]], minPrice: 2, maxPrice: 2 };
    let n = 0;
    const { loader, calls } = makeHarness({
      fetchHeatmap: () => {
        n += 1;
        return n === 1 ? heatA.promise : Promise.resolve(HEATMAP_B);
      },
    });
    await loader.load();
    const heatmapA = loader.heatmapPromise;
    await loader.load();
    await loader.heatmapPromise;
    expect(calls.applyHeatmap).toEqual([HEATMAP_B]);
    heatA.resolve(HEATMAP_A);
    await heatmapA;
    expect(calls.applyHeatmap).toEqual([HEATMAP_B]);
    expect(calls.renderHeatmap).toBe(1);
  });
});

describe('createSlotRefresh', () => {
  it('does not load while the quarter-hour bucket is unchanged', () => {
    let now = SLOT_MS * 10 + 1000;
    const loads = [];
    const refresh = createSlotRefresh({
      slotMs: SLOT_MS,
      now: () => now,
      load: () => loads.push(now),
    });
    expect(refresh.poll()).toBe(false);
    now += 1000;
    expect(refresh.poll()).toBe(false);
    expect(loads).toHaveLength(0);
  });

  it('loads once when the quarter-hour bucket advances', () => {
    let now = SLOT_MS * 10;
    const loads = [];
    const refresh = createSlotRefresh({
      slotMs: SLOT_MS,
      now: () => now,
      load: () => loads.push(now),
    });
    now = SLOT_MS * 11;
    expect(refresh.poll()).toBe(true);
    expect(loads).toEqual([SLOT_MS * 11]);
    expect(refresh.poll()).toBe(false);
  });
});
