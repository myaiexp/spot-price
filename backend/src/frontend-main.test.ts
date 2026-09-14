// Tests for the dashboard entry wiring (../../frontend/js/main.js).
// createLoader's last-known-good path is optional, so load tests that inject
// hasCachedData themselves cannot catch init() omitting it. These pin the
// production deps object, that a disabled Huomenna click does not switch tabs
// (finding #7619), that an enabled click re-renders insights + chart
// (finding #7898), that the chart-type / resolution toggles reach the same
// injected renderChart and only it (finding #9587, finding #9927), and that
// init() boots the estimator (finding #9927). The tomorrowTab renderer's DOM
// behaviour lives in frontend-tabs.test.ts.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { state } from '../../frontend/js/state.js';
import { SLOT_MS } from '../../frontend/js/slot-time.js';
import {
  buildLoaderDeps,
  hasCachedData,
  hasCachedHeatmap,
  init,
  noteStale,
  SLOT_REFRESH_MS,
} from '../../frontend/js/main.js';
import { renderTomorrowTab } from '../../frontend/js/tabs.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.today = null;
  state.yesterday = null;
  state.tomorrow = null;
  state.now = null;
  state.activeTab = 'today';
  state.heatmap = null;
  state.chartType = 'area';
  state.resolution = '15min';
  state.chart = null;
  state.refreshFailed = false;
});

function classSet(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: (c: string) => {
      classes.add(c);
    },
    remove: (c: string) => {
      classes.delete(c);
    },
    contains: (c: string) => classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force) classes.add(c);
      else classes.delete(c);
    },
  };
}

function button({
  disabled = false,
  active = false,
  dataset = {},
  id,
}: {
  disabled?: boolean;
  active?: boolean;
  dataset?: Record<string, string>;
  id?: string;
} = {}) {
  const classList = classSet(active ? ['active'] : []);
  const listeners: Array<() => void> = [];
  return {
    id,
    disabled,
    dataset,
    title: '',
    classList,
    addEventListener: (_ev: string, fn: () => void) => {
      listeners.push(fn);
    },
    click() {
      for (const fn of listeners) fn();
    },
  };
}

function stubDocument({
  tabs = [],
  byId = {},
  groups = {},
}: {
  tabs?: ReturnType<typeof button>[];
  byId?: Record<string, ReturnType<typeof button> | null>;
  // Other toggle groups by selector, e.g. '#chartTypeToggle .toggle-btn'.
  groups?: Record<string, ReturnType<typeof button>[]>;
} = {}) {
  vi.stubGlobal('document', {
    querySelectorAll: (selector: string) =>
      selector === '.tab-btn' ? tabs : (groups[selector] ?? []),
    getElementById: (id: string) => byId[id] ?? null,
  });
}

function initWithCapture(extra: Record<string, unknown> = {}) {
  let deps: ReturnType<typeof buildLoaderDeps> | undefined;
  let refreshArgs: { slotMs: number; load: () => void } | undefined;
  const load = vi.fn();
  const setIntervalFn = vi.fn();
  init({
    createLoader: (passed) => {
      deps = passed;
      return { load, heatmapPromise: Promise.resolve() };
    },
    createSlotRefresh: (args) => {
      refreshArgs = args;
      return { poll: vi.fn() };
    },
    setInterval: setIntervalFn,
    initEstimator: () => {},
    ...extra,
  });
  return { deps, refreshArgs, load, setIntervalFn };
}

describe('buildLoaderDeps (finding #7619)', () => {
  it('passes hasCachedData, noteStale, and a tomorrowTab renderer', () => {
    const deps = buildLoaderDeps();
    expect(deps.hasCachedData).toBe(hasCachedData);
    expect(deps.hasCachedHeatmap).toBe(hasCachedHeatmap);
    expect(deps.noteStale).toBe(noteStale);
    expect(deps.renderers.map((r: { name: string }) => r.name)).toEqual([
      'tomorrowTab',
      'hero',
      'chart',
      'insights',
      'estimator',
    ]);
  });

  it('hasCachedData is true when now.slot or today.slots exist', () => {
    expect(hasCachedData()).toBe(false);
    state.now = { slot: { priceWithTax: 0.05 } };
    expect(hasCachedData()).toBe(true);
    state.now = null;
    state.today = { slots: [{ datetime: '2026-07-18T00:00:00.000Z' }] };
    expect(hasCachedData()).toBe(true);
    state.today = { slots: [] };
    expect(hasCachedData()).toBe(false);
  });

  it('hasCachedHeatmap follows applyHeatmap: any response cached, a failure cleared', () => {
    const deps = buildLoaderDeps();
    expect(hasCachedHeatmap()).toBe(false);
    deps.applyHeatmap({ matrix: [], minPrice: 0, maxPrice: 0, weekNumber: 38 });
    expect(hasCachedHeatmap()).toBe(true);
    deps.applyHeatmap(null);
    expect(hasCachedHeatmap()).toBe(false);
  });

  it('noteStale sets refreshFailed even if renderHero has no DOM', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    noteStale();
    expect(state.refreshFailed).toBe(true);
  });

  it('wires tomorrowTab to tabs.js renderTomorrowTab (finding #9607)', () => {
    const renderer = buildLoaderDeps().renderers.find(
      (r: { name: string }) => r.name === 'tomorrowTab',
    );
    expect(renderer?.run).toBe(renderTomorrowTab);
  });
});

describe('init production wiring (finding #7619)', () => {
  it('hands buildLoaderDeps to createLoader, including last-known-good', () => {
    stubDocument();
    const { deps, load } = initWithCapture();
    expect(deps?.hasCachedData).toBe(hasCachedData);
    expect(deps?.hasCachedHeatmap).toBe(hasCachedHeatmap);
    expect(deps?.noteStale).toBe(noteStale);
    expect(deps?.renderers.map((r: { name: string }) => r.name)).toContain('tomorrowTab');
    expect(load).toHaveBeenCalledOnce();
  });

  it('polls createSlotRefresh every 60s on the 15-min slot clock', () => {
    stubDocument();
    const { refreshArgs, setIntervalFn } = initWithCapture();
    expect(refreshArgs?.slotMs).toBe(SLOT_MS);
    expect(setIntervalFn).toHaveBeenCalledOnce();
    expect(setIntervalFn.mock.calls[0][1]).toBe(SLOT_REFRESH_MS);
    expect(SLOT_REFRESH_MS).toBe(60_000);
  });

  it('does not switch tabs when disabled Huomenna is clicked', () => {
    const today = button({ active: true, dataset: { tab: 'today' } });
    const tomorrow = button({
      disabled: true,
      dataset: { tab: 'tomorrow' },
      id: 'tabTomorrow',
    });
    stubDocument({
      tabs: [today, tomorrow],
      byId: { tabTomorrow: tomorrow },
    });
    initWithCapture();

    tomorrow.click();

    expect(state.activeTab).toBe('today');
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });

  it('re-renders insights and chart when an enabled Huomenna tab is clicked (finding #7898)', () => {
    // A click that set activeTab without renderInsights/renderChart would
    // revive the stale-card bug (audit #5552) and ship. The disabled-click
    // case above cannot catch that — it never reaches the handler.
    const today = button({ active: true, dataset: { tab: 'today' } });
    const tomorrow = button({
      dataset: { tab: 'tomorrow' },
      id: 'tabTomorrow',
    });
    stubDocument({
      tabs: [today, tomorrow],
      byId: { tabTomorrow: tomorrow },
    });
    const renderChart = vi.fn();
    const renderInsights = vi.fn();
    initWithCapture({ renderChart, renderInsights });

    tomorrow.click();

    expect(state.activeTab).toBe('tomorrow');
    expect(tomorrow.classList.contains('active')).toBe(true);
    expect(today.classList.contains('active')).toBe(false);
    expect(renderInsights).toHaveBeenCalledOnce();
    expect(renderChart).toHaveBeenCalledOnce();
  });

  it('chart type and resolution toggles call the injected renderChart (finding #9587)', () => {
    // A handler calling the bare import would reach the real Chart.js path
    // (no #priceChart in the stub) and never touch this spy.
    const bar = button({ dataset: { value: 'bar' } });
    const hourly = button({ dataset: { value: 'hourly' } });
    stubDocument({
      groups: {
        '#chartTypeToggle .toggle-btn': [bar],
        '#resolutionToggle .toggle-btn': [hourly],
      },
    });
    const renderChart = vi.fn();
    const renderInsights = vi.fn();
    initWithCapture({ renderChart, renderInsights });

    bar.click();
    expect(state.chartType).toBe('bar');
    expect(renderChart).toHaveBeenCalledTimes(1);

    hourly.click();
    expect(state.resolution).toBe('hourly');
    expect(renderChart).toHaveBeenCalledTimes(2);
    // Chart controls change only the chart; insights follow the tab, not these.
    expect(renderInsights).not.toHaveBeenCalled();
  });
});

describe('init estimator boot (finding #9927)', () => {
  it('boots the estimator exactly once', () => {
    // initWithCapture defaults initEstimator to a no-op; without this spy,
    // dropping initEstimatorFn() from init() left every test green while the
    // live estimator never wired its device chips or input listeners.
    stubDocument();
    const initEstimator = vi.fn();
    initWithCapture({ initEstimator });
    expect(initEstimator).toHaveBeenCalledOnce();
  });
});
