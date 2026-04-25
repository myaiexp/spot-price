# Phase 1: Core Build

> Backend API with price history + redesigned frontend with area charts, comparison overlays, and smart insights.

## Goals

- Stand up Hono backend with PostgreSQL storing 15-minute spot prices
- Automated price collection from spot-hinta.fi every 15 minutes
- Redesigned frontend matching mase.fi's visual theme
- Yesterday/tomorrow comparison overlays on area chart
- Actionable "best windows" insights replacing the basic price list
- Auto-refresh at quarter-hour boundaries

## Requirements

_Done when:_
- Backend is deployed on VPS, collecting prices on a timer
- Frontend queries own API (not spot-hinta.fi directly)
- Area chart shows today with yesterday ghost line and "now" marker
- Tomorrow tab shows tomorrow with today as ghost line
- Hero card is color-coded by price context
- Insights section shows cheapest block, next cheap window, peak to avoid
- Page auto-refreshes data at quarter boundaries without full reload

## Architecture / Design Notes

See `docs/plans/2026-03-06-spot-price-design.md` for the full design.

### Backend

- Hono + Drizzle, following diet-app patterns
- Single `prices` table: `datetime (timestamptz PK)`, `price_no_tax (numeric)`, `price_with_tax (numeric)`
- Collector: fetches `/TodayAndDayForward` from spot-hinta.fi, upserts all slots
- API: `/api/prices/today`, `/yesterday`, `/tomorrow`, `/now`, `/range?from=&to=`
- Port 3500, nginx proxy at `/porssi/api/`

### Frontend

- mase.fi theme: `#09090b` bg, `#18181c` cards, `#e8a308` accent, Bricolage Grotesque + DM Sans
- Chart.js area chart with gradient fill (green→amber→red)
- Yesterday comparison as faint dashed line dataset
- Vertical "now" annotation line (chartjs-plugin-annotation or manual)
- Three insight cards: cheapest block, next cheap window, peak to avoid
- Auto-refresh: check every 60s if quarter boundary crossed

## Notes

_Progress updates, blockers, open questions._
