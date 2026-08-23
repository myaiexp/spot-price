# Spot Price

> Finnish electricity spot price tracker with historical data and comparison views.

This file is a **map**, not a manual. Standing architecture lives in `.claude/`. `docs/plans/` are frozen historical snapshots — they still describe a single-file frontend, port 3500, and a tsx-run collector, all contradicted by current code.

## Key Patterns

- **Backend**: Hono `createApp(db)` factory, `routes/` over a `queries/` layer (`day.ts`, `now.ts`, `heatmap.ts`), Drizzle ORM. Diet-app pattern — [`.claude/backend.md`](.claude/backend.md)
- **Frontend**: no-build ES-module app (pure calc vs. render modules, including `state.js` / `ui.js` / `load.js`; DST slot indexing; abort/supersede, last-known-good) — [`.claude/frontend.md`](.claude/frontend.md)
- **Window bounds & cheap-rank polarity**: exclusive `endExclusive` everywhere; `GET /now` `cheaperThanPercent` is high=cheap — [`.claude/windows.md`](.claude/windows.md)
- **Collection**: systemd timer → `dist/collector.js`; sahkotin historical backfill — [`.claude/collector.md`](.claude/collector.md)
- **Testing**: backend vitest runs `frontend-*.test.ts`; shared doubles in `test-support/` (including heatmap-execute and window-db builders) — [`.claude/testing.md`](.claude/testing.md)
- **EMA** (α=0.3) buckets by Helsinki wall-clock hour (DST-correct 23/25h days, not a fixed 4-slot slice)
- **Heatmap** is the current week's actual hourly prices (SQL-aggregated), greyed cells for missing data
- **Dependency hygiene**: `backend/package.json` `overrides` aliases deprecated `@esbuild-kit/esm-loader` (declared by drizzle-kit but never imported — it uses tsx) to `get-tsconfig`; the override also covers transitive `@esbuild-kit/core-utils` so the deprecated chain and `esbuild@0.18.20` cannot come back. Don't remove it.

## Deploy

- Port 3600 · `spot-price.service` · `spot-price-collector.timer` (every 15 min)
- Postgres via `DATABASE_URL` (database `porssi`). Required by the API and collector; loaded from the project `.env` (systemd `EnvironmentFile`).
- `deploy` — pushes to forgejo + restarts `spot-price.service` (the collector is timer-driven and picks up new code on its next fire). The forgejo post-receive hook rebuilds the backend and **rsyncs the whole `frontend/` tree** (index.html + styles.css + js/) to `/var/www/html/porssi/` — `frontend/` holds only browser assets, so publishing it wholesale is safe. (Adding a frontend file requires no hook change; adding a non-asset file to `frontend/` would publish it, so keep tests/config in `backend/`.)

## Decisions from previous phases

- All times handled in Helsinki timezone with DST-aware UTC conversion
- Heatmap = current week's actual prices, not historical EMA (historical should get its own tab)
- Cost estimator is pure client-side using today+tomorrow slots
- Chart controls: area/bar toggle, 15min/hourly resolution with EMA aggregation
- Peak detection: 60th percentile threshold with 30min gap bridging

## History

Historical phase plans (design + implementation) live in `docs/plans/`. They are labelled snapshots of how the project was built, not the current architecture — read `.claude/` and the code for that.

- [Phase 1 design](docs/plans/2026-03-06-spot-price-design.md) · [Phase 1 implementation](docs/plans/2026-03-06-spot-price-implementation.md)
- [Phase 2 design](docs/plans/2026-03-07-phase2-design.md) · [Phase 2 implementation](docs/plans/2026-03-07-phase2-implementation.md)
