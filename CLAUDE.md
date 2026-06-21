# Spot Price

> Finnish electricity spot price tracker with historical data and comparison views.

## Key Patterns

- Backend follows the diet-app Hono pattern: `createApp(db)` factory, route modules, Drizzle ORM
- Frontend uses mase.fi's design system: near-black backgrounds, golden-amber accent, Bricolage Grotesque + DM Sans fonts
- Data collection: systemd timer runs `dist/collector.js` every 15 min, upserts spot-hinta.fi data. `src/collector.ts` is a thin CLI entry only — the collect/backfill logic lives in side-effect-free library modules (`src/collectors/spot-hinta.ts` live, `src/collectors/sahkotin.ts` backfill, `src/collectors/upsert.ts` shared upsert), conversion + HTTP helpers in `src/utils/`
- Historical backfill: sahkotin.fi API, hourly data from Dec 2012, run via `npm run backfill`; resume from a date (walk backwards from an explicit UTC upper bound) with `npm run collect -- --backfill=2024-01-01`
- API sources: spot-hinta.fi (live 15-min), sahkotin.fi (historical hourly backfill, EUR/MWh → EUR/kWh × 1.255 VAT)
- EMA (α=0.3) used for hourly chart aggregation
- Heatmap shows current week's actual hourly prices (SQL-aggregated), greyed cells for missing data

## Deploy

- Port 3600 · `spot-price.service` · `spot-price-collector.timer` (every 15 min)
- `deploy` — pushes to forgejo + restarts `spot-price.service` (the collector is timer-driven and picks up new code on its next fire)

## Decisions from previous phases

- All times handled in Helsinki timezone with DST-aware UTC conversion
- Heatmap = current week's actual prices, not historical EMA (historical should get its own tab)
- Cost estimator is pure client-side using today+tomorrow slots
- Chart controls: area/bar toggle, 15min/hourly resolution with EMA aggregation
- Peak detection: 60th percentile threshold with 30min gap bridging
