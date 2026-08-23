# Testing

Frontend JS is unit-tested by the backend vitest runner — both the pure calc modules and glue (`load.js` abort-supersede, `api.js` fetch, renderer copy). `backend/src/frontend-*.test.ts` import `../../frontend/js/*.js` (kept out of `dist`/`tsc` by the `*.test.ts` exclude in `backend/tsconfig.json`). From `backend/`: `npx vitest run` (full) or `npx vitest run frontend-insights-calc` (substring path filter). Renderers (`hero.js`, `heatmap.js`, `estimator.js`) take an optional `{ document }` deps bag (estimator also `{ nowMs }`) so copy tests can call them with `test-support/fake-dom.ts` — no jsdom.

## Coverage

DST 92/100-slot days, deadline next-day rollover, `parseDeadlineMinutes` (integer minutes, empty → null), past-window filtering, the unclamped window-end boundary, `slotSpanLabel` colon-form spans, the hero's cheap-rank bands, the insight cards' per-tab now-index (including the `30 min` / `1h 15min` / exact-hour countdown branches), chart ghost-series wall-clock alignment (not index zip), load abort-supersede (aborted rejection does not `showError`, superseded resolve does not overwrite state), isolated renderer throws, heatmap `showHeatmapError` vs empty-data placeholder (Finnish copy pinned on the renderer, not just the callback), last-known-good on refresh failure (hero `refreshFailed` / stale `klo` notes), estimator unpublished-tomorrow vs no-window copy, tomorrow-tab midnight fallback, `priceToColor` endpoints (including a 0 cell on a negative range), zero/negative `collectPrices` and heatmap NUMERIC cells (0 is a real price, not missing), empty-week heatmap min/max = 0, and deadline-string / slot-assembly helpers. `frontend-api.test.ts` covers the fetch layer (abort signal on every request, 404 → null, yesterday and tomorrow degrading to null, caller-abort of either still rejecting, today/now network failures still rejecting so last-known-good is kept, `fetchHeatmap` hitting `/porssi/api/prices/heatmap`) against the shared fetch stubs. `eurToCents` is pinned next to `formatCents` (numeric chart axis vs display string). `findSlotContaining` is called with `HOUR_MS` (hourly 'Nyt' marker) as well as `SLOT_MS`. Chart ghost alignment includes 15-min fall-back vs fall-back (in-order consume of each duplicated HH:MM) and 25h vs 24h (reuse last value per wall-clock key), not only `{ hourly: true }`. `frontend-main.test.ts` pins `init()`'s production `createLoader` deps (`hasCachedData` / `noteStale` / `tomorrowTab` renderer, 60s `createSlotRefresh`). `frontend-ui.test.ts` pins `wireToggleGroup` ignoring disabled clicks (checked at click time, not wire time). `app-error.test.ts` pins `onError` to JSON `{ error: 'Internal Server Error' }` (not the raw exception). `app-cors.test.ts` pins a static `allowHeaders` list (no reflect of `Access-Control-Request-Headers`) and the production origin list (`https://mase.fi` allowed, `http://localhost:5173` denied). `connection-timeouts.test.ts` pins finite pg.Pool connect/statement/query timeouts. `day-endpoints.test.ts` drives `/today` `/yesterday` `/tomorrow` through `makeWindowFilterDb` so a shifted Helsinki `[start, end)` fails, and empty yesterday is `200 { slots: [] }`. `routes/now-cheaper-than.test.ts` also imports `js/hero-calc.js` so the API value and the tint that reads it are asserted together. `collectors/backfill-arg.test.ts` pins `--backfill` / `--backfill=DATE` (date-only → Helsinki midnight, not UTC) / ISO-instant passthrough / invalid dates. `collectors/sahkotin-validation.test.ts` pins mixed-slot drop vs all-invalid abort (empty `prices` is still end-of-history) and the backfill write path (MWh→kWh × VAT then `toFixed(5)`). `collectors/upsert.test.ts` pins `makePriceInsert` 5-decimal canonicalization (negatives, IEEE-754 `0.1+0.2`).

## Test-support doubles

`backend/src/test-support/` holds the shared fakes. New route/collector tests import from there rather than hand-casting `as unknown as Db`. The module is test-only — tsconfig `exclude`s `src/test-support/**` so it stays out of `dist/` and the `tsc --noEmit` graph (like `*.test.ts`); it's verified by vitest at runtime.

**`fake-db.ts`** — WHERE-ignoring / insert-chain / heatmap-execute doubles:

- `makeSelectDb` / `makeCountingSelectDb` — select-chain resolves a fixed result set (counting variant probes cache hits)
- `makeInsertDb` / `makeCountingInsertDb` / `makeCapturingInsertDb` — insert-chain resolves a pg-style `{ rowCount }` (count chunks, or capture the rows written)
- `makeHeatmapExecuteDb` — `getHeatmap`'s two-call `db.execute` protocol (cells, then ISO week-number). Used by heatmap-week-cache, heatmap-precision, heatmap-cache tests

**`window-db.ts`** — WHERE-bound-aware doubles for tests whose contract *is* the query window (`makeSelectDb` ignores WHERE and would hide a shifted bound):

- `makeWindowKeyedDb` — looks up fixtures by the query's `gte` lower bound. Used by `now-yesterday-slot`
- `makeWindowFilterDb` — filters seeded rows by the `[gte, lt)` the handler actually queried, and records that window. Used by `range-window` and `day-endpoints`

**`fetch-stub.ts`** — `okJson` / `failedResponse` / `stubFetch` / `stubFailedFetch`

**`fake-dom.ts`** — `fakeEl` / `fakeDocument` document-like double for renderer copy tests (getElementById + createElement, no jsdom)

**`rows.ts`** — `RawRow` / `Slot` types, `row()` / `taxedRow()` (DB rows) and `slot()` / `stepSlots()` (frontend 15-min slots). Frontend tests import these rather than rebuilding `{datetime, priceWithTax, priceNoTax}` per file.
