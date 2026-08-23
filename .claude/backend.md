# Backend

Hono `createApp(db)` factory (diet-app pattern): `secureHeaders`, CORS, `onError`, `GET /api/health`, then `pricesRoutes(db)` at `/api/prices`. Query layer is `queries/` (`day.ts`, `now.ts`, `heatmap.ts`) over Drizzle. Collect is not an HTTP verb — the timer-driven CLI owns writes (`.claude/collector.md`).

## Routes

| Method | Path | Envelope | Empty / miss |
| --- | --- | --- | --- |
| GET | `/api/health` | `{ status: 'ok' }` | always 200, no DB |
| GET | `/api/prices/today` | `{ slots, date }` | empty `slots` is 200 |
| GET | `/api/prices/yesterday` | `{ slots, date }` | empty `slots` is 200 |
| GET | `/api/prices/tomorrow` | `{ slots, date }` | 404 `{ error }` until published ~14:00 |
| GET | `/api/prices/now` | `{ slot, cheaperThanPercent, yesterdaySlot, stale }` | 404 if no current slot (empty today / before first slot). Interior gap or past last window → most recent past slot with `stale: true` |
| GET | `/api/prices/range?from&to` | `{ slots, from, to }` | `to` inclusive, max 90 days, valid calendar dates, `from` on or before `to` (`from === to` is one day) |
| GET | `/api/prices/heatmap` | `{ matrix, minPrice, maxPrice, weekNumber }` | 7×24 Mon-first; missing cells `null` |

A slot is `{ datetime, priceNoTax, priceWithTax }` (ISO instant, EUR/kWh). Each heatmap `matrix` item is `{ day, hours }` (`day` 0=Mon … 6=Sun, `hours` length 24, cells cents/kWh or `null`; no `label` — frontend maps `day` via `DAY_LABELS` in `heatmap.js`). Window bounds and `/now` cheap-rank polarity: `.claude/windows.md`.

There is no `POST /api/collect` and day endpoints do not return a raw slot array.

## Query caches

Per `createApp` instance — `pricesRoutes` calls `createNowQuery` / `createHeatmap` so tests and successive apps never share a cache. Both use `createTimeKeyedCache` (one entry, key-equality AND TTL).

- `/now`: Helsinki 15-min slot key, 60s TTL (null miss is a cached value, not a hole)
- `/heatmap`: Helsinki week-start key, 15 min TTL
- day/range: uncached; unparseable NUMERIC or datetime rows are dropped

## Bind, CORS, errors

- Listen `127.0.0.1` (`API_PORT` default 3600); nginx fronts `/porssi/api`. `DATABASE_URL` required.
- CORS origin `https://mase.fi` in production (+ `http://localhost:5173` otherwise). `allowHeaders` is the static list `['Content-Type']` — never reflect `Access-Control-Request-Headers` (hono ReDoS).
- `onError` always JSON `{ error: 'Internal Server Error' }` 500, never the raw exception.
- pg pool connect 5s / query 10s so a stalled DB 500s before the frontend's 15s fetch timeout.

Deploy / port / systemd: `CLAUDE.md` Deploy. Tests: `.claude/testing.md`.
