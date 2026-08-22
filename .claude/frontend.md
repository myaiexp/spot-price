# Frontend

No-build ES-module app: `frontend/index.html` (markup) + `frontend/styles.css` + `frontend/js/*.js` loaded via `<script type="module">`. Chart.js from CDN. Design system is mase.fi's (near-black, golden-amber accent, Bricolage Grotesque + DM Sans).

## Module split

Pure math is side-effect-free and DOM-free. Render modules own the DOM. `main.js` orchestrates.

**Pure**

| File | Role |
| --- | --- |
| `js/calc.js` | Window sums, cheapest/next/peak blocks, EMA, wall-clock ghost alignment |
| `js/estimator-calc.js` | Deadline resolution, optimal-window search, forward-slot filtering |
| `js/slot-time.js` | Helsinki wall-clock + datetime→slot indexing |
| `js/format.js` | Numeric cent conversion vs. cent *strings* |
| `js/hero-calc.js` | Cheap-rank → band/tint/copy |
| `js/insights-calc.js` | Now-index per tab + the three card texts |

**Render / glue**

| File | Role |
| --- | --- |
| `js/chart.js` | Area/bar × 15min/hourly Chart.js |
| `js/insights.js` | Cheapest 2h / next cheap / peak cards |
| `js/heatmap.js` | Weekly heatmap |
| `js/estimator.js` | Cost estimator ("Ajoitusavustin") |
| `js/hero.js` | Current-price headline |
| `js/main.js` | Controls, data load, quarter-hour refresh |
| `js/api.js` | Same-origin `/porssi/api` fetches |
| `js/state.js` | Shared mutable UI state (`today`/`yesterday`/`tomorrow`/`now`, active tab, heatmap, chart type/resolution, Chart.js instance) |
| `js/ui.js` | Generic exclusive toggle-group wiring (click moves `.active`, then `onSelect`) |

## Slot indices

All slot indices and labels derive from each slot's `datetime` — never fixed `h*4` arithmetic — so 23h/25h DST days stay aligned. EMA (α=0.3) for hourly aggregation is bucketed the same way: a 23h day yields 23 buckets, a 25h day 25.

## Fetch abort / supersede

`js/api.js` puts `AbortSignal.timeout(FETCH_TIMEOUT_MS)` (15 s, mirroring the collector) on every request. `main.js` holds one `AbortController` per load so the quarter-hour refresh cancels a still-running previous load instead of stacking. A rejection whose own controller was aborted is a supersede, not a failure — it must not paint an error over the newer load. Heatmap failures call `showHeatmapError()` rather than being swallowed (its placeholder text is distinct from the empty-data "Ei riittävästi tietoja").

Window-bound and cheap-rank polarity rules: `.claude/windows.md`. Tests: `.claude/testing.md`.
