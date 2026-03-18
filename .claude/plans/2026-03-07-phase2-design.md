# Phase 2 Design: History, Heatmap & Cost Estimator

**Date:** 2026-03-07
**Status:** Approved

## Overview

Three new capabilities plus chart enhancements:

1. Historical backfill — populate DB with past data
2. Weekly heatmap — EMA-weighted 7×24 grid of price patterns
3. Cost estimator with smart scheduling — find cheapest windows for devices
4. Chart controls — area/bar toggle on all charts, 15min/hourly toggle on daily charts

## 1. Historical Backfill

### Collector Enhancement

Add a `--backfill` mode to the existing collector.

- `node backend/dist/collector.js --backfill`
- Fetches day by day going backwards from yesterday until spot-hinta.fi returns empty
- Same upsert logic (ON CONFLICT DO UPDATE) — safe to re-run
- Runs once manually after deployment, then the existing 15-min timer keeps data current

### API Source

spot-hinta.fi supports date-specific queries. Fetch each day individually, insert, move to the previous day. Stop when the API returns no data.

## 2. Weekly Heatmap

### Visualization

A 7-day × 24-hour grid (168 cells) showing EMA-weighted average price by color.

- **Rows:** Days of the week (Ma–Su)
- **Columns:** Hours (0–23)
- **Colors:** Green (cheap) → amber → red (expensive), matching the existing chart gradient palette
- **Interaction:** Hover/tap shows the exact average price for that cell (tooltip)
- **Chart type toggle:** Area (default) / Bar — same as daily charts

### EMA Aggregation

Exponential Moving Average with α = 0.3 (half-life ~2 weeks, primarily reflects last ~month).

For each (weekday, hour) cell:

1. Collect all matching hourly values, ordered oldest to newest
2. Each hourly value is itself an EMA of its 4 quarter-slots (α = 0.3, weighting later quarters more)
3. Apply weekly EMA: `EMA_new = α × value + (1 - α) × EMA_prev`

Result: recent weeks dominate, spikes show up clearly, old patterns fade.

### API

`GET /api/prices/heatmap` — returns a 7×24 matrix of EMA-weighted average prices. Computed server-side. Can be cached with short TTL since data only changes every 15 min.

Response shape:

```json
{
  "matrix": [
    { "day": 0, "label": "Ma", "hours": [1.23, 2.45, ...] },
    ...
  ],
  "minPrice": 0.5,
  "maxPrice": 15.2
}
```

## 3. Cost Estimator — "Ajoitusavustin"

### Device Presets

| Device          | Power  | Default duration |
| --------------- | ------ | ---------------- |
| Sauna (kiuas)   | 6 kW   | 2h               |
| EV charger      | 11 kW  | 4h               |
| Washing machine | 2 kW   | 2h               |
| Dishwasher      | 1.8 kW | 1.5h             |
| Dryer           | 2.5 kW | 1.5h             |
| Custom          | —      | —                |

### UI

Card-based section below the heatmap.

**Inputs:**

- Device selector (chips/buttons for presets + custom option)
- Power in kW (pre-filled from preset, editable)
- Duration in hours (pre-filled, editable)
- Optional: "Must finish by" time picker (deadline constraint)

**Output (calculated live as inputs change):**

- **Best window:** "Start at 02:15, finish by 04:15 — estimated cost 0.14 €"
- **Worst window:** "At 17:00–19:00 it would cost 1.47 €"
- **Savings:** "Save 1.33 € by timing it right"

### Calculation

All client-side using today's/tomorrow's slot data (already fetched). No new API needed.

- Convert duration to number of 15-min slots
- Slide window across available slots, sum `priceWithTax × power × 0.25h` for each window
- With deadline: constrain start times so `start + duration ≤ deadline`
- Report cheapest and most expensive windows

## 4. Chart Controls

### View Toggle (all charts)

Every chart (today, tomorrow, heatmap) gets an area/bar toggle. Area is the default.

- Area: current line-with-fill rendering
- Bar: vertical bars, same color scheme

### Resolution Toggle (today/tomorrow only)

Toggle between 15-minute (96 points, default) and hourly (24 points) resolution.

**Hourly aggregation uses EMA** (α = 0.3) across the 4 quarter-slots within each hour. The 4th quarter (XX:45) gets weighted more than the 1st (XX:00), highlighting end-of-hour price movement rather than flattening to a simple mean.

### EMA Summary

| Context                    | What's aggregated                 | EMA purpose                 |
| -------------------------- | --------------------------------- | --------------------------- |
| Today/tomorrow hourly view | 4 quarter-slots → 1 hour          | Weights later quarters more |
| Heatmap cells              | Same (weekday, hour) across weeks | Weights recent weeks more   |

Both use α = 0.3.

## Frontend Layout (top to bottom)

1. Header (existing)
2. Hero card (existing)
3. Tabs: Tänään / Huomenna (existing)
4. **Chart controls** (new) — view toggle + resolution toggle
5. Chart (existing, enhanced with controls)
6. Insights (existing)
7. **Heatmap — "Viikkokuvio"** (new)
8. **Cost estimator — "Ajoitusavustin"** (new)
9. Footer (existing)

## What's NOT in this phase

- Zoom-out analysis / monthly summary dashboard (Phase 3)
- Dark/light mode toggle
- PWA / push notifications
