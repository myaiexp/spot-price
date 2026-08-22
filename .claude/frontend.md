# Frontend

No-build ES-module app: `frontend/index.html` (markup) + `frontend/styles.css` + `frontend/js/*.js` loaded via `<script type="module">`. Chart.js from CDN. Design system is mase.fi's (near-black, golden-amber accent, Bricolage Grotesque + DM Sans).

## Module split

Pure math is side-effect-free and DOM-free. Render modules own the DOM. `main.js` is an `init()` call site (index.html calls it; importing the module has no side effects).

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
| `js/load.js` | Abort-supersede load orchestration, isolated renders, last-known-good on refresh blip |

**Render / glue**

| File | Role |
| --- | --- |
| `js/chart.js` | Area/bar × 15min/hourly Chart.js |
| `js/insights.js` | Cheapest 2h / next cheap / peak cards |
| `js/heatmap.js` | Weekly heatmap |
| `js/estimator.js` | Cost estimator ("Ajoitusavustin") |
| `js/hero.js` | Current-price headline |
| `js/main.js` | `init()`: wires controls and hands fetch/render into `createLoader` |
| `js/api.js` | Same-origin `/porssi/api` fetches |
| `js/state.js` | Shared mutable UI state (`today`/`yesterday`/`tomorrow`/`now`, active tab, heatmap, chart type/resolution, Chart.js instance, `refreshFailed`) |
| `js/ui.js` | Generic exclusive toggle-group wiring (click moves `.active`, then `onSelect`) |

## Slot indices

All slot indices and labels derive from each slot's `datetime` — never fixed `h*4` arithmetic — so 23h/25h DST days stay aligned. EMA (α=0.3) for hourly aggregation is bucketed the same way: a 23h day yields 23 buckets, a 25h day 25.

Window-span labels go through `slotSpanLabel` (colon form). `formatTime` is the fi-FI prose form (`14.30`) for copy like the hero's "klo" note — don't mix the two; estimator and insight cards share the colon helper so they cannot drift.

Estimator deadlines are minutes-since-Helsinki-midnight (`parseDeadlineMinutes` on the `<input type="time">` value), matching `helsinkiMinutesOfDay` — not a fractional hour.

## Fetch abort / supersede

`js/api.js` puts `AbortSignal.timeout(FETCH_TIMEOUT_MS)` (15 s, mirroring the collector) on every request. `js/load.js` holds one `AbortController` per load so the quarter-hour refresh cancels a still-running previous load instead of stacking. A rejection whose own controller was aborted is a supersede, not a failure — it must not paint an error over the newer load, and a superseded resolve must not write state.

Fetch failures stay in the fetch catch: `showError` only when there is no cached data; otherwise keep last-known-good and note staleness on the hero (`state.refreshFailed`). Each renderer runs in its own try so a missing Chart.js global cannot skip insights/estimator or masquerade as a network error. Heatmap failures call `showHeatmapError()` rather than being swallowed (its placeholder text is distinct from the empty-data "Ei riittävästi tietoja"). `/prices/yesterday` and `/prices/tomorrow` degrade network/timeout failures to null (yesterday is the chart's optional ghost series; tomorrow is unpublished until ~14:00), but a caller abort still rejects so a stale load cannot resolve-over-the-newer-one.

When Huomenna is disabled (no tomorrow slots) while it is the active tab — midnight rollover until ~14:00 — fall back to Tänään so the dashboard does not sit on empty cards.

Window-bound and cheap-rank polarity rules: `.claude/windows.md`. Tests: `.claude/testing.md`.
