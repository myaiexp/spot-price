# Spot Price — Design Document

**Date:** 2026-03-06
**Status:** Approved

## Problem

The existing pörssisähkö page (singlepagers/porssi.html) is a basic bar chart with no historical comparison, no actionable insights, and a generic Tailwind look. Tomorrow prices never worked due to a wrong API endpoint. Every Finnish spot price page looks the same — this redesign aims to stand out.

## Architecture

### Backend (Hono API)

New service on VPS following the established diet-app pattern.

**Stack:** Hono + Drizzle ORM + PostgreSQL + @hono/node-server

**Database:** `porssi` on existing PostgreSQL 16 instance.

**Schema:**

```sql
CREATE TABLE prices (
  datetime TIMESTAMPTZ PRIMARY KEY,
  price_no_tax NUMERIC(10, 5) NOT NULL,
  price_with_tax NUMERIC(10, 5) NOT NULL
);
```

96 rows per day (~35k rows/year). No indexes needed beyond the PK for this scale.

**API endpoints:**

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/prices/today` | Today's 96 slots |
| GET | `/api/prices/yesterday` | Yesterday's 96 slots |
| GET | `/api/prices/tomorrow` | Tomorrow's 96 slots (404 if unavailable) |
| GET | `/api/prices/now` | Current slot only |
| GET | `/api/prices/range?from=YYYY-MM-DD&to=YYYY-MM-DD` | Arbitrary date range |

All responses return arrays of `{ datetime, priceNoTax, priceWithTax }` sorted by datetime.

**Data collector:**

- Runs every 15 minutes via systemd timer
- Fetches spot-hinta.fi `/TodayAndDayForward`
- Upserts all slots (ON CONFLICT DO UPDATE)
- Idempotent — safe to run multiple times

**Deployment:**

- Port 3500, bound to 127.0.0.1
- Nginx proxy: `/porssi/api/` → `http://127.0.0.1:3500/api/`
- Systemd service: `spot-price-api.service`
- Systemd timer: `spot-price-collector.timer` (every 15 min)

### Frontend

Single `index.html` served as a static file at `mase.fi/porssi`.

**Theme:** mase.fi design system (not Tailwind):

- Background: `#09090b` (page), `#18181c` (cards)
- Accent: `#e8a308` (golden-amber)
- Fonts: Bricolage Grotesque (headings), DM Sans (body) via Google Fonts
- Cards: 12px radius, `#27272a` borders, amber glow on hover
- All spacing via CSS custom properties

## Components

### 1. Hero Card — Current Price

Large centered price with contextual color coding:

- **Green background tint** — price is in cheapest third of the day
- **Amber background tint** — middle third
- **Red background tint** — expensive third

Content:

- Price in large text (e.g., "4.52 c/kWh")
- Context line: "Cheaper than 78% of today"
- Comparison line: "Yesterday at this time: 5.10 c/kWh"

### 2. Area Chart

Chart.js area chart (type: 'line' with fill) showing 96 quarter-hour slots.

**Today tab:**

- Filled area: today's prices with gradient fill (green→amber→red based on price thresholds)
- Ghost line: yesterday's prices as a faint dashed line (same x-axis, different dataset)
- Now marker: vertical dashed line at current quarter position

**Tomorrow tab:**

- Filled area: tomorrow's prices with same gradient
- Ghost line: today's prices as the comparison
- No "now" marker

**Axes:**

- X: labels every hour (00:00, 01:00, ..., 23:00), data points every 15 min
- Y: c/kWh, starts at 0

**Tooltip:** Shows exact time (e.g., "14:45") and price ("4.52 c/kWh").

### 3. Insights Section

Three cards replacing the old cheap/normal/expensive list:

**Cheapest block** (green accent):

- Finds the cheapest contiguous 2-hour window
- Shows time range and average price
- e.g., "02:15–04:15 — avg 1.2 c/kWh"

**Next cheap window** (amber accent):

- Looks forward from current time, finds next slot in the cheapest third
- Shows when it starts and how long until then
- e.g., "Starts in 2h 15min at 18:00"
- If already in a cheap window: "You're in a cheap window now — ends at 04:00"

**Peak to avoid** (red accent):

- Finds the most expensive contiguous block
- Shows time range and average price
- e.g., "07:00–08:30 — avg 12.3 c/kWh"

### 4. Auto-Refresh

- `setInterval` every 60 seconds
- Checks if current 15-min slot has changed since last fetch
- If so: re-fetches all data, updates chart and hero with smooth transitions
- No full page reload

## Data Flow

```
spot-hinta.fi ─(every 15m)─→ collector ─(upsert)─→ PostgreSQL
                                                        │
                     frontend ←── Hono API ←────────────┘
                         │
              renders: hero + chart + insights
              auto-refreshes every 60s
```

## What's NOT in this phase

- Dark/light mode toggle (Tier 3)
- Price notifications / PWA (Tier 3)
- Cost estimator (Tier 3)
- Weekly/monthly heatmap (Tier 3)
- Historical trend views (future, enabled by the DB)
