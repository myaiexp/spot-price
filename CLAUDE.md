# Spot Price

> Finnish electricity spot price tracker with historical data and comparison views.

## Key Patterns

- Backend follows the diet-app Hono pattern: `createApp(db)` factory, route modules, Drizzle ORM
- Frontend uses mase.fi's design system: near-black backgrounds, golden-amber accent, Bricolage Grotesque + DM Sans fonts
- Frontend is a no-build ES-module app: `frontend/index.html` (markup) + `frontend/styles.css` + `frontend/js/*.js` loaded via `<script type="module">` (Chart.js from CDN). Pure math lives in side-effect-free, DOM-free modules — `js/calc.js` (window sums, cheapest/next/peak blocks, EMA), `js/estimator-calc.js` (deadline resolution, optimal-window search, forward-slot filtering), `js/slot-time.js` (Helsinki wall-clock + datetime→slot indexing), `js/format.js`, `js/hero-calc.js` (cheap-rank → band/tint/copy), `js/insights-calc.js` (now-index per tab + the three card texts) — kept apart from the render modules (`js/chart.js`, `js/insights.js`, `js/heatmap.js`, `js/estimator.js`, `js/hero.js`) and the `js/main.js` orchestrator. All slot indices/labels derive from each slot's `datetime` (never fixed `h*4` arithmetic) so 23h/25h DST days stay aligned.
- Frontend pure logic is unit-tested by the backend vitest runner: `backend/src/frontend-*.test.ts` import `../../frontend/js/*.js` (kept out of `dist`/`tsc` by the `*.test.ts` exclude). Covers DST 92/100-slot days, deadline next-day rollover, past-window filtering, the unclamped window-end boundary, the hero's cheap-rank bands, and the insight cards' per-tab now-index. `frontend-api.test.ts` covers the fetch layer (abort signal on every request, 404 → null, tomorrow degrading to null) against the shared fetch stubs. `routes/now-cheaper-than.test.ts` also imports `js/hero-calc.js` so the API value and the tint that reads it are asserted together.
- Window bounds are exclusive everywhere and say so in the name: `findCheapestBlock` / `findPeakBlock` / `findNextCheapWindow` (calc.js) and `findOptimalWindow` (estimator-calc.js) all return `endExclusive` — one past the last included slot, which feeds `slotBoundaryMs` / `slotBoundaryLabel` directly with no `+1` at the call site. `endIndex` used to mean *inclusive* in calc.js and *exclusive* in estimator-calc.js; don't reintroduce a bound whose name doesn't state its side.
- Browser API calls are bounded and cancellable: `js/api.js` puts `AbortSignal.timeout(FETCH_TIMEOUT_MS)` (15 s, mirroring the collector) on every request, and `main.js` holds one `AbortController` per load so the quarter-hour refresh cancels a still-running previous load instead of stacking. A rejection whose own controller was aborted is a supersede, not a failure — it must not paint an error over the newer load. Heatmap failures call `showHeatmapError()` rather than being swallowed (its placeholder text is distinct from the empty-data "Ei riittävästi tietoja").
- `GET /now` reports `cheaperThanPercent` — the share of today's slots that cost **more** than the current one, so **high = cheap**. The hero tints ≥70 green / ≥30 amber / else red and captions "Halvempi kuin X% tänään" straight from it. It was once a bottom-up `percentile` (share *cheaper* than now), which the hero read as a cheap signal and painted peak prices green; keep both ends of the wire on this polarity.
- Data collection: systemd timer runs `dist/collector.js` every 15 min, upserts spot-hinta.fi data. `src/collector.ts` is a thin CLI entry only — the collect/backfill logic lives in side-effect-free library modules (`src/collectors/spot-hinta.ts` live, `src/collectors/sahkotin.ts` backfill, `src/collectors/upsert.ts` shared upsert), conversion + HTTP helpers in `src/utils/`
- Historical backfill: sahkotin.fi API, hourly data from Dec 2012, run via `npm run backfill`; resume from a date (walk backwards from an explicit UTC upper bound) with `npm run collect -- --backfill=2024-01-01`
- API sources: spot-hinta.fi (live 15-min), sahkotin.fi (historical hourly backfill, EUR/MWh → EUR/kWh × 1.255 VAT)
- EMA (α=0.3) for hourly chart aggregation, bucketed by each slot's Helsinki wall-clock hour (DST-correct: a 23h day yields 23 buckets, a 25h day 25 — not a fixed 4-slot slice)
- Heatmap shows current week's actual hourly prices (SQL-aggregated), greyed cells for missing data
- Dependency hygiene: `backend/package.json` `overrides` aliases the deprecated `@esbuild-kit/esm-loader` + `@esbuild-kit/core-utils` (declared by drizzle-kit but never imported — it uses tsx) to `get-tsconfig`, a tiny zero-esbuild package already in the tree. This drops the deprecated packages and a stale `esbuild@0.18.20` copy from the lock file. Don't remove the override — it reintroduces the deprecated chain.
- Test doubles are shared, not re-rolled: `backend/src/test-support/` holds the fake-Db builders (`makeSelectDb`/`makeCountingSelectDb`, `makeInsertDb`/`makeCountingInsertDb`/`makeCapturingInsertDb`), fetch stubs (`okJson`/`failedResponse`/`stubFetch`/`stubFailedFetch`), and row fixtures (`RawRow`/`Slot` types, `row()`/`taxedRow()` factories). New route/collector tests import from there rather than hand-casting `as unknown as Db`. The module is test-only — tsconfig `exclude`s `src/test-support/**` so it stays out of `dist/` and the `tsc --noEmit` graph (like `*.test.ts`); it's verified by vitest at runtime.

## Deploy

- Port 3600 · `spot-price.service` · `spot-price-collector.timer` (every 15 min)
- `deploy` — pushes to forgejo + restarts `spot-price.service` (the collector is timer-driven and picks up new code on its next fire). The forgejo post-receive hook rebuilds the backend and **rsyncs the whole `frontend/` tree** (index.html + styles.css + js/) to `/var/www/html/porssi/` — `frontend/` holds only browser assets, so publishing it wholesale is safe. (Adding a frontend file requires no hook change; adding a non-asset file to `frontend/` would publish it, so keep tests/config in `backend/`.)

## Decisions from previous phases

- All times handled in Helsinki timezone with DST-aware UTC conversion
- Heatmap = current week's actual prices, not historical EMA (historical should get its own tab)
- Cost estimator is pure client-side using today+tomorrow slots
- Chart controls: area/bar toggle, 15min/hourly resolution with EMA aggregation
- Peak detection: 60th percentile threshold with 30min gap bridging

## History

Historical phase plans (design + implementation) live in `docs/plans/`:

- [Phase 1 design](docs/plans/2026-03-06-spot-price-design.md) · [Phase 1 implementation](docs/plans/2026-03-06-spot-price-implementation.md)
- [Phase 2 design](docs/plans/2026-03-07-phase2-design.md) · [Phase 2 implementation](docs/plans/2026-03-07-phase2-implementation.md)
