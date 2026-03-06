# Spot Price Implementation Plan

**Goal:** Build a Hono + PostgreSQL backend that collects Finnish electricity spot prices, and a redesigned frontend with area charts, comparison overlays, and smart insights — all themed to match mase.fi.

**Architecture:** Backend service on VPS port 3500 (Hono + Drizzle + PostgreSQL) with a systemd timer collecting prices every 15 minutes from spot-hinta.fi. Single-file frontend served statically at mase.fi/porssi/. Frontend calls our own API instead of spot-hinta.fi directly.

**Tech Stack:** Hono, @hono/node-server, Drizzle ORM, PostgreSQL 16, Chart.js (+ annotation plugin), vanilla JS/CSS

---

### Task 1: Backend Scaffolding [Mode: Direct]

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/drizzle.config.ts`
- Create: `backend/src/index.ts`
- Create: `backend/src/app.ts`

**Contracts:**

`package.json`: type: module, scripts: build (tsc), dev (tsx watch), start (node dist/index.js), collect (tsx src/collector.ts), db:generate, db:migrate. Dependencies: hono, @hono/node-server, drizzle-orm, pg, dotenv, zod. Dev: typescript, tsx, drizzle-kit, @types/pg.

`tsconfig.json`: extends nothing (flat project, not monorepo). target ES2022, module ESNext, moduleResolution bundler, strict, outDir dist, rootDir src.

`index.ts` — entry point:
```typescript
// Load dotenv, create DB from DATABASE_URL, create app, serve on API_PORT (default 3500)
export function main(): void
```

`app.ts` — Hono factory:
```typescript
import type { Db } from './db/connection.js';
export function createApp(db: Db): Hono
// Mounts: cors('*'), GET /api/health, route('/api/prices', pricesRoutes(db))
// Also mounts: POST /api/collect (triggers collector manually)
```

`drizzle.config.ts`: schema at ./src/db/schema.ts, out ./drizzle, dialect postgresql, dbCredentials from DATABASE_URL env.

**Verification:**
```bash
cd backend && npm install && npm run build
```
Expected: compiles without errors (routes/collector not yet implemented — create stub files that export empty functions).

**Commit after passing.**

---

### Task 2: Database Schema & Connection [Mode: Direct]

**Files:**
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/connection.ts`

**Contracts:**

`schema.ts`:
```typescript
export const prices = pgTable('prices', {
  datetime: timestamp('datetime', { withTimezone: true, mode: 'string' }).primaryKey(),
  priceNoTax:  numeric('price_no_tax',  { precision: 10, scale: 5 }).notNull(),
  priceWithTax: numeric('price_with_tax', { precision: 10, scale: 5 }).notNull(),
});
```

`connection.ts`:
```typescript
export function createDb(connectionString: string): Db
export type Db = ReturnType<typeof createDb>
// Uses pg.Pool + drizzle(pool, { schema })
```

**Test Cases:**
```typescript
// Verify schema exports the prices table with correct columns
test('prices table has datetime, priceNoTax, priceWithTax columns')
test('createDb returns a drizzle instance')
```

**Verification:**
```bash
cd backend && npx tsx node_modules/.bin/drizzle-kit generate
```
Expected: migration SQL created in `drizzle/` with CREATE TABLE prices.

**Commit after passing.**

---

### Task 3: Price Collector [Mode: Delegated]

**Files:**
- Create: `backend/src/collector.ts`

**Contracts:**

```typescript
// Fetches from spot-hinta.fi /TodayAndDayForward, upserts all slots into DB
export async function collectPrices(db: Db): Promise<{ inserted: number; updated: number }>

// spot-hinta.fi response shape
interface SpotHintaSlot {
  Rank: number;
  DateTime: string;  // ISO 8601 with timezone
  PriceNoTax: number;  // EUR/kWh
  PriceWithTax: number;  // EUR/kWh
}
```

Key behaviors:
- Fetches `https://api.spot-hinta.fi/TodayAndDayForward`
- Transforms each slot: DateTime → TIMESTAMPTZ, prices stored as-is (EUR/kWh, NOT cents)
- Upserts via `ON CONFLICT (datetime) DO UPDATE SET price_no_tax = EXCLUDED.price_no_tax, price_with_tax = EXCLUDED.price_with_tax`
- Must handle: API down (throw with message), empty response (return { inserted: 0, updated: 0 })
- When run as CLI (`tsx src/collector.ts`): loads dotenv, creates db, calls collectPrices, logs result, exits

**Test Cases:**
```typescript
test('transforms SpotHinta response into DB rows with correct datetime and prices')
test('handles empty API response gracefully')
test('handles API error (non-200) with descriptive error')
```

**Constraints:**
- Store prices in EUR/kWh (same as API returns). Frontend converts to cents.
- The collector must work both as an import (for POST /api/collect) and as a standalone script (for systemd timer).

**Verification:**
```bash
# After DB is set up on VPS:
cd backend && npm run collect
```
Expected: prints count of inserted/updated rows, data visible in DB.

**Commit after passing.**

---

### Task 4: API Routes [Mode: Delegated]

**Files:**
- Create: `backend/src/routes/prices.ts`

**Contracts:**

```typescript
export function pricesRoutes(db: Db): Hono
```

Endpoints:

| Route | Logic | Response |
|-------|-------|----------|
| `GET /today` | Query prices WHERE datetime >= today 00:00 Helsinki AND < tomorrow 00:00 Helsinki | `{ slots: PriceSlot[], date: string }` |
| `GET /yesterday` | Same logic for yesterday | `{ slots: PriceSlot[], date: string }` |
| `GET /tomorrow` | Same logic for tomorrow. 404 if no rows. | `{ slots: PriceSlot[], date: string }` or 404 |
| `GET /now` | Find slot matching current 15-min window in Helsinki time | `{ slot: PriceSlot, percentile: number, yesterdaySlot: PriceSlot \| null }` |
| `GET /range` | Query params `from`, `to` (YYYY-MM-DD). Max 90 days. | `{ slots: PriceSlot[], from: string, to: string }` |

```typescript
interface PriceSlot {
  datetime: string;      // ISO 8601
  priceNoTax: number;    // EUR/kWh
  priceWithTax: number;  // EUR/kWh
}
```

The `/now` endpoint also returns:
- `percentile`: what percentage of today's slots are cheaper (for "Cheaper than X% of today")
- `yesterdaySlot`: yesterday's price at the same time-of-day (for comparison line in hero)

**Critical: Timezone handling.**
"Today" means midnight-to-midnight in `Europe/Helsinki`. Use:
```typescript
const now = new Date();
const helsinkiDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' }); // YYYY-MM-DD
// Then query: datetime >= '${helsinkiDate}T00:00:00+XX:XX' (construct with proper offset)
```
Or simpler: use `AT TIME ZONE 'Europe/Helsinki'` in SQL.

**Test Cases:**
```typescript
test('/today returns 96 slots for current Finnish date')
test('/yesterday returns 96 slots for previous Finnish date')
test('/tomorrow returns 404 when no data available')
test('/tomorrow returns 96 slots when data exists')
test('/now returns current slot with percentile and yesterday comparison')
test('/now percentile is 0-100 range')
test('/range validates from/to params, rejects range > 90 days')
test('/range returns correct slots for date range')
```

**Verification:**
```bash
# After deployment:
curl https://mase.fi/porssi/api/prices/today | jq '.slots | length'
curl https://mase.fi/porssi/api/prices/now | jq
```
Expected: today returns 96 slots, now returns current slot with percentile.

**Commit after passing.**

---

### Task 5: VPS Deployment [Mode: Direct]

**Actions (not code files — infrastructure setup):**

1. Create database on VPS:
   ```bash
   ssh vps "sudo -u postgres psql -c \"CREATE DATABASE porssi; CREATE USER porssi WITH PASSWORD 'GENERATED'; ALTER DATABASE porssi OWNER TO porssi;\""
   ```

2. Run setup-deployment from the spot-price repo:
   ```bash
   cd ~/Projects/spot-price
   setup-deployment --service --port 3500 --runtime node --entry backend/dist/index.js
   ```

3. Create .env on VPS:
   ```bash
   ssh vps "cat > /opt/spot-price/.env << 'EOF'
   DATABASE_URL=postgresql://porssi:PASSWORD@localhost:5432/porssi
   API_PORT=3500
   NODE_ENV=production
   EOF"
   ```

4. Run Drizzle migration on VPS (after first push):
   ```bash
   ssh vps "cd /opt/spot-price/backend && npx drizzle-kit migrate"
   ```

5. Create systemd timer for collector:
   - `spot-price-collector.service`: ExecStart runs `node backend/dist/collector.js` with EnvironmentFile
   - `spot-price-collector.timer`: OnCalendar=*:0/15, Persistent=true

6. Set up nginx:
   - `/porssi/api/` → proxy to 127.0.0.1:3500/api/
   - `/porssi` → /var/www/html/porssi/ (static)

7. Deploy frontend: post-receive hook copies `frontend/index.html` to `/var/www/html/porssi/index.html`

8. Remove porssi.html from singlepagers repo (it's been superseded)

**Verification:**
```bash
ssh vps "systemctl status spot-price-api"
ssh vps "systemctl status spot-price-collector.timer"
curl https://mase.fi/porssi/api/health
curl https://mase.fi/porssi/
```

**Commit after passing.**

---

### Task 6: Frontend — Theme & Layout Shell [Mode: Delegated]

**Files:**
- Create: `frontend/index.html`

**Contracts:**

The entire app is a single HTML file with embedded CSS and JS. Structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Fonts: Bricolage Grotesque + DM Sans -->
  <!-- Chart.js + chartjs-plugin-annotation via CDN -->
  <style>
    /* mase.fi CSS custom properties (--bg, --bg-card, --accent, etc.) */
    /* Reset, ambient gradient background */
    /* Component styles: hero-card, chart-container, insight-card, tab-btn, footer */
    /* Responsive: single column on mobile (<640px) */
    /* prefers-reduced-motion support */
  </style>
</head>
<body>
  <!-- Header: "Pörssisähkö" title + back link -->
  <!-- Hero card: current price, context, yesterday comparison -->
  <!-- Tabs: Today / Tomorrow -->
  <!-- Chart container: canvas element -->
  <!-- Insights: 3 cards (cheapest block, next cheap, peak to avoid) -->
  <!-- Footer: data source credit -->
  <script>
    // All JS here
  </script>
</body>
</html>
```

**CSS contracts** — must use mase.fi custom properties:
- `--bg: #09090b`, `--bg-card: #18181c`, `--bg-card-hover: #1f1f24`
- `--accent: #e8a308`, `--accent-glow: rgba(232, 163, 8, 0.12)`
- `--text: #fafafa`, `--text-secondary: #a1a1aa`, `--text-muted: #52525b`
- `--border: #27272a`, `--border-hover: #3f3f46`
- `--font-display: 'Bricolage Grotesque'`, `--font-body: 'DM Sans'`
- `--card-radius: 12px`
- Ambient gradient mesh on body::before (amber, cyan, violet radial gradients)

**Hero card contracts:**
- Shows current price from `/api/prices/now`
- Background tint: green (`rgba(34, 197, 94, 0.08)`) / amber (`rgba(232, 163, 8, 0.08)`) / red (`rgba(239, 68, 68, 0.08)`) based on percentile
- Text: "{price} c/kWh" (convert EUR to cents × 100)
- Subtext: "Cheaper than {percentile}% of today"
- Smaller line: "Yesterday at this time: {price} c/kWh"

**Chart contracts:**
- Chart.js line chart with `fill: true` (area chart)
- Today dataset: filled area with canvas gradient (green bottom → amber middle → red top, mapped to price thresholds)
- Yesterday dataset: `borderDash: [5, 5]`, `borderColor: 'rgba(161, 161, 170, 0.3)'`, `fill: false`, `pointRadius: 0`
- "Now" marker: vertical dashed line at current quarter index using chartjs-plugin-annotation
- X-axis: labels every hour (callback shows only :00 labels), 96 data points
- Y-axis: c/kWh, beginAtZero
- Tooltip: shows exact time + price formatted to 2 decimals
- Tomorrow tab: tomorrow is the filled area, today becomes the ghost line, no "now" marker

**Insights contracts:**
```javascript
function findCheapestBlock(prices, blockSize = 8)
// Sliding window: returns { startIndex, endIndex, avgPrice }
// blockSize 8 = 2 hours of 15-min slots

function findNextCheapWindow(prices, currentIndex)
// From currentIndex forward, find next slot in cheapest third
// Returns { startIndex, startsIn: minutes, price }
// If currently in cheap window: { inCheapNow: true, endsAt: index }

function findPeakBlock(prices)
// Find contiguous block where all slots are in expensive third
// Returns { startIndex, endIndex, avgPrice }
```

Each insight rendered as a card with:
- Icon/accent color (green, amber, red)
- Time range (formatted from slot indices)
- Average price
- For "next cheap": "Starts in Xh Ym" or "You're in a cheap window now"

**Auto-refresh contracts:**
```javascript
let lastQuarterIndex = getCurrentQuarterIndex();
setInterval(() => {
  const now = getCurrentQuarterIndex();
  if (now !== lastQuarterIndex) {
    lastQuarterIndex = now;
    refreshData(); // re-fetch all, update chart + hero + insights
  }
}, 60000);
```

**API base URL:** `/porssi/api` (relative path, works because frontend is served from same origin).

**Verification:**
```bash
# After deployment:
curl https://mase.fi/porssi/ | head -5
# Open in browser, verify:
# - Hero shows current price with color
# - Chart shows area with yesterday ghost line
# - Now marker visible
# - Insights show 3 cards
# - Tomorrow tab works after 14:00
```

**Commit after passing.**

---

## Execution
**Skill:** superpowers:subagent-driven-development
- Mode A tasks (1, 2, 5): Opus implements directly
- Mode B tasks (3, 4, 6): Dispatched to subagents
