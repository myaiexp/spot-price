# Phase 2: History, Heatmap & Cost Estimator

> Historical data backfill, EMA-weighted weekly heatmap, smart cost estimator, and chart view controls.

## Goals

- Backfill historical spot price data from spot-hinta.fi
- Weekly heatmap showing EMA-weighted price patterns (7×24 grid)
- Cost estimator with Finnish device presets and optional deadline scheduling
- Area/bar toggle on all charts, 15min/hourly toggle on daily charts
- EMA aggregation for all hourly views (α = 0.3)

## Requirements

_Done when:_
- Collector has `--backfill` mode that pulls all available history
- Heatmap endpoint returns 7×24 EMA-weighted matrix
- Heatmap renders with green→amber→red color scale, hover tooltips
- Cost estimator shows best/worst windows and savings for selected device
- Deadline constraint works (e.g., "EV charged by 07:00")
- All charts support area/bar toggle
- Today/tomorrow charts support 15min/hourly toggle
- Hourly aggregation uses EMA, not simple mean

## Architecture / Design Notes

Full design: `docs/plans/2026-03-07-phase2-design.md`

### Key decisions
- EMA α = 0.3 everywhere (half-life ~2 weeks for weekly heatmap)
- Heatmap computed server-side, cached with short TTL
- Cost estimator is pure client-side (uses already-fetched slot data)
- Backfill is a one-time manual run, same upsert logic as regular collector

### New API endpoint
- `GET /api/prices/heatmap` — 7×24 EMA matrix with min/max bounds

## Notes

**Phase 2 complete (2026-03-07).**

All requirements met:
- Backfill from sahkotin.fi: 115,664 historical rows (Dec 2012 → present)
- Heatmap API: two-level EMA, 15-min cache, 7×24 matrix
- Heatmap UI: CSS grid, HSL color interpolation, hover tooltips
- Cost estimator: 6 device presets, sliding-window optimization, deadline support
- Chart controls: area/bar toggle, 15min/hourly resolution with EMA aggregation
- Data source: sahkotin.fi (EUR/MWh → EUR/kWh + 25.5% VAT)
- VPS deployment path: `/opt/spot-price` (not `/var/www/spot-price`)
