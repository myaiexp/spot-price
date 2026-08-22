// Tests for the dashboard load orchestrator (../../frontend/js/load.js).
// Abort-supersede must not paint an error over a newer load, a superseded
// resolve must not overwrite state, render exceptions stay isolated from fetch
// failures, heatmap rejections call showHeatmapError, and a refresh blip keeps
// last-known-good data instead of wiping the hero (findings #7136, #7109,
// #7108, #7102, #7101).

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
    noteStale: 0,
    logError: [],
  };
  let cached = null;
  const deps = {
    fetchAllData: async () => [TODAY, null, null, NOW],
    fetchHeatmap: async () => HEATMAP,
    applyPayload: (payload) => {
      calls.apply.push(payload);
      cached = payload[0];
    },
    applyHeatmap: (heatmap) => {
      calls.applyHeatmap.push(heatmap);
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
    noteStale: () => {
      calls.noteStale += 1;
    },
    logError: (...args) => calls.logError.push(args),
    ...overrides,
  };
  return { loader: createLoader(deps), deps, calls };
}

describe('createLoader abort-supersede', () => {
  it('aborts the previous in-flight controller when a new load starts', () => {
    const signals = [];
    const { loader } = makeHarness({
      fetchAllData: (signal) => {
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
      fetchAllData: (signal) => {
        n += 1;
        if (n === 1) {
          signal.addEventListener('abort', () => first.reject(abortError()));
          return first.promise;
        }
        return Promise.resolve([TODAY, null, null, NOW]);
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
      fetchAllData: () => {
        n += 1;
        if (n === 1) return first.promise;
        return Promise.resolve([newer, null, { slots: [1] }, NOW]);
      },
    });
    const p1 = loader.load();
    const p2 = loader.load();
    await p2;
    expect(calls.apply[0][0]).toBe(newer);
    expect(calls.renderers).toEqual(['hero', 'chart', 'insights', 'estimator']);
    first.resolve([TODAY, null, null, NOW]);
    await p1;
    expect(calls.apply).toHaveLength(1);
    expect(calls.apply[0][0]).toBe(newer);
    expect(calls.renderers).toEqual(['hero', 'chart', 'insights', 'estimator']);
  });
});

describe('createLoader fetch vs render isolation', () => {
  it('calls showError on a non-abort fetch rejection with no cached data', async () => {
    const { loader, calls } = makeHarness({
      fetchAllData: async () => {
        throw new Error('network down');
      },
    });
    await loader.load();
    expect(calls.showError).toHaveLength(1);
    expect(calls.showError[0]).toMatch(/Tietojen lataus epäonnistui/);
    expect(calls.noteStale).toBe(0);
    expect(calls.apply).toEqual([]);
    expect(calls.renderers).toEqual([]);
  });

  it('keeps last-known-good data on a refresh failure instead of showError', async () => {
    const { loader, deps, calls } = makeHarness();
    await loader.load();
    expect(calls.apply).toHaveLength(1);
    deps.fetchAllData = async () => {
      throw new Error('blip');
    };
    await loader.load();
    expect(calls.showError).toEqual([]);
    expect(calls.noteStale).toBe(1);
    expect(calls.apply).toHaveLength(1);
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
  it('calls showHeatmapError on heatmap rejection, not renderHeatmap', async () => {
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
