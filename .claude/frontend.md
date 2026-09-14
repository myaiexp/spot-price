# Frontend

No-build ES-module app: `frontend/index.html` (markup) + `frontend/styles.css` + `frontend/js/*.js` loaded via `<script type="module" src="./js/main.js">` (no inline boot — CSP `script-src` omits `'unsafe-inline'`). Chart.js from CDN. Design system is mase.fi's (near-black, golden-amber accent, Bricolage Grotesque + DM Sans). The `/porssi` nginx location sets the CSP; committed snippet is `deploy/nginx-porssi.conf`.

## Module split

Pure math is side-effect-free and DOM-free. Render modules own the DOM. `main.js` auto-calls `init()` as the page entry; importing it under Vitest has no side effects.

**Pure**

| File | Role |
| --- | --- |
| `js/calc.js` | Window sums, cheapest/next/peak blocks, EMA, wall-clock ghost alignment |
| `js/estimator-calc.js` | Deadline minutes parse + resolution, slot assembly, optimal-window search, forward-slot filtering |
| `js/slot-time.js` | Helsinki wall-clock + datetime→slot indexing (`toDate` coercion) |
| `js/format.js` | Cents + Helsinki labels: `formatTime` is fi-FI prose (`14.30`); colon `slotLabel`/`hourLabel`/`slotBoundaryLabel`/`slotSpanLabel` for axes and window spans |
| `js/hero-calc.js` | Cheap-rank → band/tint/copy |
| `js/insights-calc.js` | Now-index per tab + the three card texts |
| `js/tab-state.js` | Huomenna enable/fallback to Tänään when tomorrow data is gone |
| `js/heatmap-calc.js` | Green→amber→red price-to-color scale |
| `js/chart-series.js` | `chartSeries(state, nowMs)`: resolution/EMA, colon labels, wall-clock ghost, now index (null on empty primary) |
| `js/chart-config.js` | `buildChartConfig(series, reducedMotion)`: static styling constants + datasets, tick stride, `Nyt` annotation; fresh option objects per call |

**Render / glue**

| File | Role |
| --- | --- |
| `js/chart.js` | DOM seam: placeholder, `chartSeries` → `buildChartConfig`, destroy previous Chart.js instance then construct (optional `{ document, nowMs, Chart, matchMedia }` for tests) |
| `js/insights.js` | Cheapest 2h / next cheap / peak cards (optional `{ document, nowMs }` for tests) |
| `js/heatmap.js` | Weekly heatmap (optional `{ document }` for tests) |
| `js/estimator.js` | Cost estimator ("Ajoitusavustin"; optional `{ document, nowMs }` for tests) |
| `js/hero.js` | Current-price headline (optional `{ document }` for tests) |
| `js/tabs.js` | `renderTomorrowTab`: applies `tab-state.js` to the Huomenna button (disabled + title, fallback to Tänään via `setActive`; optional `{ document }` for tests). Runs first in the renderer list so chart/insights read the fallen-back tab |
| `js/main.js` | `init()`: wires controls (every toggle reaches `renderChart` / `renderInsights` through the same `hooks` seam) and hands `buildLoaderDeps()` (incl. `hasCachedData` / `noteStale` / the `tomorrowTab` renderer) into `createLoader`; `SLOT_REFRESH_MS` is 60s. Auto-calls `init()` unless Vitest imported the module (`process.env.VITEST`) so index.html needs no inline script |
| `js/api.js` | Same-origin `/porssi/api` fetches |
| `js/load.js` | Abort-supersede load orchestration, isolated renders, last-known-good on refresh blip |
| `js/state.js` | Shared mutable UI state (`today`/`yesterday`/`tomorrow`/`now`, active tab, heatmap, chart type/resolution, Chart.js instance, `refreshFailed`) |
| `js/ui.js` | Exclusive toggle groups: `setActive(buttons, predicate)` is the one `.active` rewrite; `wireToggleGroup` (click moves `.active` via `setActive`, then `onSelect`; disabled buttons no-op, checked at click time) |

## Slot indices

All slot indices and labels derive from each slot's `datetime` — never fixed `h*4` arithmetic — so 23h/25h DST days stay aligned. EMA (α=0.3) for hourly aggregation is bucketed the same way: a 23h day yields 23 buckets, a 25h day 25.

Window-span labels go through `slotSpanLabel` (colon form). `formatTime` is the fi-FI prose form (`14.30`) for copy like the hero's "klo" note — don't mix the two; estimator and insight cards share the colon helper so they cannot drift.

Estimator deadlines are minutes-since-Helsinki-midnight (`parseDeadlineMinutes` on the `<input type="time">` value), matching `helsinkiMinutesOfDay` — not a fractional hour. `findDeadlineSlotIndex` is the first slot starting at/after the deadline *instant*: a same-day deadline past the day's last start (23:59) bounds the search at tomorrow's first slot, so loaded tomorrow prices never leak into a "today" window.

## Fetch abort / supersede

`js/api.js` puts `AbortSignal.timeout(FETCH_TIMEOUT_MS)` (15 s, mirroring the collector) on every request. `js/load.js` holds one `AbortController` per load so the quarter-hour refresh cancels a still-running previous load instead of stacking. A rejection whose own controller was aborted is a supersede, not a failure — it must not paint an error over the newer load, and a superseded resolve must not write state.

Fetch failures stay in the fetch catch: `showError` only when there is no cached data; otherwise keep last-known-good and note staleness on the hero (`state.refreshFailed`). Each renderer runs in its own try so a missing Chart.js global cannot skip insights/estimator or masquerade as a network error. Heatmap failures follow the same last-known-good rule: with a cached grid (`hasCachedHeatmap` — any prior successful response) a refresh failure only logs and leaves the grid; with nothing cached it calls `showHeatmapError()` rather than being swallowed (its placeholder text is distinct from the empty-data "Ei riittävästi tietoja"). A deploy restart's brief 502 is the routine trigger. `/prices/yesterday` and `/prices/tomorrow` degrade network/timeout failures to null (yesterday is the chart's optional ghost series; tomorrow is unpublished until ~14:00), but a caller abort still rejects so a stale load cannot resolve-over-the-newer-one.

When Huomenna is disabled (no tomorrow slots) while it is the active tab — midnight rollover until ~14:00 — fall back to Tänään so the dashboard does not sit on empty cards.

Window-bound and cheap-rank polarity rules: `.claude/windows.md`. Tests: `.claude/testing.md`.
