// Dashboard load orchestration: abort-supersede, isolated renders.

export const LOAD_FAILED_MESSAGE =
  'Tietojen lataus epäonnistui. Yritä myöhemmin uudelleen.';

// One in-flight load at a time. A newer load aborts the previous controller;
// that rejection is a supersede, not a failure — it must not paint showError
// over the newer paint, and it must not overwrite state the newer load already
// wrote. Fetch failures stay in the fetch catch; each renderer runs in its own
// try so a missing Chart.js global cannot abort insights/estimator or masquerade
// as a network error. A refresh blip while cached data exists keeps the last
// known-good display instead of wiping the hero — or the heatmap grid — for up
// to 15 minutes (a deploy restart answering 502 is the routine trigger).
export function createLoader(deps) {
  let loadController = null;
  let heatmapPromise = Promise.resolve();

  function startHeatmap(controller) {
    const superseded = () => controller.signal.aborted;
    heatmapPromise = Promise.resolve()
      .then(() => deps.fetchHeatmap(controller.signal))
      .then((heatmap) => {
        if (superseded()) return;
        deps.applyHeatmap(heatmap);
        try {
          deps.renderHeatmap?.();
        } catch (err) {
          deps.logError?.('Render failed (heatmap):', err);
        }
      })
      .catch((err) => {
        if (superseded()) return;
        deps.logError?.('Failed to load heatmap:', err);
        // Warm failure: the grid already on screen is last-known-good — leave it.
        if (deps.hasCachedHeatmap?.()) return;
        deps.applyHeatmap(null);
        deps.showHeatmapError();
      });
  }

  function runRenderers() {
    for (const renderer of deps.renderers ?? []) {
      try {
        renderer.run();
      } catch (err) {
        deps.logError?.(`Render failed (${renderer.name}):`, err);
      }
    }
  }

  async function load() {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const superseded = () => controller.signal.aborted;

    let bundle;
    try {
      bundle = await deps.fetchPriceBundle(controller.signal);
    } catch (err) {
      if (superseded()) return;
      deps.logError?.('Failed to load data:', err);
      if (deps.hasCachedData?.()) deps.noteStale?.();
      else deps.showError(LOAD_FAILED_MESSAGE);
      startHeatmap(controller);
      return;
    }

    // The only supersede window is the await above: applyPriceBundle and the
    // renderers are synchronous and none of them calls load().
    if (superseded()) return;
    deps.applyPriceBundle(bundle);
    runRenderers();
    startHeatmap(controller);
  }

  return {
    load,
    get heatmapPromise() {
      return heatmapPromise;
    },
  };
}

// Quarter-hour bucket watcher. poll() fires load() once when Date.now() crosses
// a 15-min slot boundary — DST-immune (no h*4 arithmetic).
export function createSlotRefresh({ slotMs, now = () => Date.now(), load }) {
  let lastTick = Math.floor(now() / slotMs);
  return {
    poll() {
      const tick = Math.floor(now() / slotMs);
      if (tick === lastTick) return false;
      lastTick = tick;
      load();
      return true;
    },
  };
}
