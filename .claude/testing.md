# Testing

Frontend pure logic is unit-tested by the backend vitest runner: `backend/src/frontend-*.test.ts` import `../../frontend/js/*.js` (kept out of `dist`/`tsc` by the `*.test.ts` exclude in `backend/tsconfig.json`). From `backend/`: `npx vitest run` (full) or `npx vitest run frontend-insights-calc` (substring path filter).

## Coverage

DST 92/100-slot days, deadline next-day rollover, past-window filtering, the unclamped window-end boundary, the hero's cheap-rank bands, the insight cards' per-tab now-index (including the `30 min` / `1h 15min` / exact-hour countdown branches), and chart ghost-series wall-clock alignment (not index zip). `frontend-api.test.ts` covers the fetch layer (abort signal on every request, 404 → null, tomorrow degrading to null) against the shared fetch stubs. `routes/now-cheaper-than.test.ts` also imports `js/hero-calc.js` so the API value and the tint that reads it are asserted together.

## Test-support doubles

`backend/src/test-support/` holds the shared fakes. New route/collector tests import from there rather than hand-casting `as unknown as Db`. The module is test-only — tsconfig `exclude`s `src/test-support/**` so it stays out of `dist/` and the `tsc --noEmit` graph (like `*.test.ts`); it's verified by vitest at runtime.

**`fake-db.ts`** — WHERE-ignoring / insert-chain / heatmap-execute doubles:

- `makeSelectDb` / `makeCountingSelectDb` — select-chain resolves a fixed result set (counting variant probes cache hits)
- `makeInsertDb` / `makeCountingInsertDb` / `makeCapturingInsertDb` — insert-chain resolves a pg-style `{ rowCount }` (count chunks, or capture the rows written)
- `makeHeatmapExecuteDb` — `getHeatmap`'s two-call `db.execute` protocol (cells, then ISO week-number). Used by heatmap-week-cache, heatmap-precision, heatmap-cache tests

**`window-db.ts`** — WHERE-bound-aware doubles for tests whose contract *is* the query window (`makeSelectDb` ignores WHERE and would hide a shifted bound):

- `makeWindowKeyedDb` — looks up fixtures by the query's `gte` lower bound. Used by `now-yesterday-slot`
- `makeWindowFilterDb` — filters seeded rows by the `[gte, lt)` the handler actually queried, and records that window. Used by `range-window`

**`fetch-stub.ts`** — `okJson` / `failedResponse` / `stubFetch` / `stubFailedFetch`

**`rows.ts`** — `RawRow` / `Slot` types, `row()` / `taxedRow()` factories
