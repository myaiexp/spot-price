# Phase 2 Implementation Plan

**Goal:** Add historical backfill, EMA-weighted weekly heatmap, cost estimator with smart scheduling, and chart view controls.

**Architecture:** Backend gets a backfill collector (sahkotin.fi, hourly data) and a heatmap endpoint with two-level EMA computation. Frontend gets chart toggles (area/bar, 15min/hourly), a CSS grid heatmap, and a sliding-window cost estimator. All EMA uses α=0.3.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, Chart.js, vanilla JS

---

### Task 1: Historical Backfill [Mode: Delegated]

**Files:**
- Modify: `backend/src/collector.ts`
- Modify: `backend/package.json` (add `backfill` script)

**Contracts:**

```typescript
interface SahkotinSlot {
  date: string;    // ISO 8601
  value: number;   // EUR/MWh, no tax
}

// Fetch a date range from sahkotin.fi
async function fetchSahkotinPrices(start: string, end: string): Promise<SahkotinSlot[]>
// GET https://sahkotin.fi/prices?start={ISO}&end={ISO}
// Follow redirects (API returns 302)
// Returns { prices: SahkotinSlot[] }

// Backfill all available history
async function backfillPrices(db: Db): Promise<{ totalUpserted: number }>
// Fetches 30-day chunks backwards from yesterday until API returns empty
// Converts EUR/MWh → EUR/kWh: value / 1000
// Applies VAT: priceWithTax = priceNoTax * 1.255 (Finnish electricity VAT 25.5%)
// Upserts using same onConflictDoUpdate pattern as collectPrices
// 1-second delay between chunk requests
// Logs progress per chunk
```

**CLI integration:** Check `process.argv.includes('--backfill')` at existing CLI entry point. If present, call `backfillPrices(db)` instead of `collectPrices(db)`.

**Package.json:** Add `"backfill": "tsx src/collector.ts --backfill"`

**Test Cases:**

```typescript
// Conversion tests (unit-testable pure functions)
test('converts EUR/MWh to EUR/kWh correctly', () => {
  expect(mwhToKwh(20.008)).toBeCloseTo(0.020008, 6);
});

test('applies Finnish electricity VAT (25.5%)', () => {
  expect(applyVat(0.020008)).toBeCloseTo(0.025110, 5);
});

// Integration: verify after backfill that DB has data for past dates
test('backfill populates historical data', async () => {
  // After running backfill, query a known past date
  const slots = await getSlotsForDate(db, '2025-06-15');
  expect(slots.length).toBe(24); // hourly data
});
```

**Constraints:**
- sahkotin.fi returns hourly data only — store on :00 marks
- Must follow redirects (API returns 302)
- VAT constant: `ELECTRICITY_VAT = 0.255`
- Don't overwrite existing 15-min data (ON CONFLICT DO UPDATE is fine — if a :00 slot already exists from spot-hinta.fi with 15-min precision, the sahkotin.fi hourly value overwrites it, which is acceptable since the hourly rate is the official Nordpool price)

**Verification:**
```bash
cd backend && npm run build && npm run backfill
# Then verify:
ssh vps "sudo -u postgres psql -d porssi -c \"SELECT COUNT(*), MIN(datetime), MAX(datetime) FROM prices;\""
```

**Commit after passing.**

---

### Task 2: Heatmap API Endpoint [Mode: Delegated]

**Files:**
- Modify: `backend/src/routes/prices.ts` (add `/heatmap` route to existing router)

**Contracts:**

```typescript
// Pure function — two-level EMA computation
function computeEma(values: number[], alpha: number): number
// values: ordered oldest→newest
// EMA_0 = values[0]
// EMA_i = alpha * values[i] + (1 - alpha) * EMA_{i-1}
// Returns final EMA value

// Route handler added to pricesRoutes
router.get('/heatmap', async (c) => { ... })
```

**Algorithm:**
1. Query all prices from DB, ordered by datetime ASC
2. For each row, determine Helsinki weekday (0=Mon) and hour (0-23)
3. Group rows by (weekday, hour, week-identifier)
4. Within each hour-occurrence: if multiple quarter-slots exist (15-min data), EMA them (α=0.3) into one hourly value. If single slot (backfill hourly data), use as-is.
5. For each (weekday, hour) cell: collect all weekly hourly values chronologically, compute EMA (α=0.3)
6. Convert final values to c/kWh (× 100)
7. Build response with min/max bounds

**Response:**
```json
{
  "matrix": [
    { "day": 0, "label": "Ma", "hours": [2.45, 1.89, ...(24 values)] },
    { "day": 1, "label": "Ti", "hours": [...] },
    ...
    { "day": 6, "label": "Su", "hours": [...] }
  ],
  "minPrice": 0.5,
  "maxPrice": 15.2
}
```

**Caching:** In-memory cache with 15-min TTL. Store `{ data, timestamp }`. Return cached if `Date.now() - timestamp < 15 * 60 * 1000`.

**Test Cases:**

```typescript
test('computeEma with single value returns that value', () => {
  expect(computeEma([5.0], 0.3)).toBe(5.0);
});

test('computeEma weights recent values more', () => {
  const result = computeEma([1.0, 1.0, 1.0, 10.0], 0.3);
  // Last value should pull EMA significantly toward 10
  expect(result).toBeGreaterThan(3.0);
  expect(result).toBeLessThan(10.0);
});

test('heatmap returns 7 days × 24 hours', async () => {
  const res = await app.request('/api/prices/heatmap');
  const body = await res.json();
  expect(body.matrix).toHaveLength(7);
  body.matrix.forEach(row => expect(row.hours).toHaveLength(24));
});

test('heatmap day labels are Finnish', async () => {
  const res = await app.request('/api/prices/heatmap');
  const body = await res.json();
  expect(body.matrix.map(r => r.label)).toEqual(['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su']);
});
```

**Constraints:**
- Helsinki timezone for weekday/hour determination
- α = 0.3 for both EMA levels
- Must handle mixed resolution (hourly backfill + 15-min recent)
- Prices in c/kWh (with tax) in response

**Verification:**
```bash
cd backend && npm run build
curl -s http://localhost:3500/api/prices/heatmap | jq '.matrix | length'
# Should return 7
curl -s http://localhost:3500/api/prices/heatmap | jq '.matrix[0].hours | length'
# Should return 24
```

**Commit after passing.**

---

### Task 3: Chart Controls — Area/Bar + Resolution Toggles [Mode: Direct]

**Files:**
- Modify: `frontend/index.html`

**Contracts:**

State additions:
```javascript
state.chartType = 'area';     // 'area' | 'bar'
state.resolution = '15min';   // '15min' | 'hourly'
```

New function:
```javascript
function emaAggregate(slots, alpha = 0.3)
// Input: array of 96 slots (15-min data)
// Groups into 24 hours (4 slots each)
// For each hour: EMA across its 4 quarters (chronological, so :45 weighted most)
// Returns: array of 24 { datetime, priceNoTax, priceWithTax } objects
// datetime is the :00 slot's datetime
```

**HTML:** Add controls bar between tabs and chart:
```html
<div class="chart-controls">
  <div class="toggle-group" id="chartTypeToggle">
    <button class="toggle-btn active" data-value="area">Area</button>
    <button class="toggle-btn" data-value="bar">Bar</button>
  </div>
  <div class="toggle-group" id="resolutionToggle">
    <button class="toggle-btn active" data-value="15min">15 min</button>
    <button class="toggle-btn" data-value="hourly">Tunnit</button>
  </div>
</div>
```

**CSS:** Toggle groups as pill-shaped button groups. Muted bg, accent color when active. Compact height (~32px buttons).

**Chart rendering changes in `renderChart()`:**
- Read `state.chartType` and `state.resolution`
- If `resolution === 'hourly'`: pass data through `emaAggregate()`, use 24 labels
- If `chartType === 'bar'`: set Chart.js `type: 'bar'`, keep gradient fill on bars via `backgroundColor` callback
- If `chartType === 'area'`: current line+fill behavior

**Constraints:**
- Toggling re-renders chart (call `renderChart()`)
- Area default, 15min default
- Resolution toggle only relevant for today/tomorrow (hide or ignore for heatmap)
- Ghost line (yesterday/today comparison) also aggregated when in hourly mode

**Verification:**
Deploy and visually verify in browser:
- Toggle area↔bar on today tab
- Toggle 15min↔hourly on today tab
- Switch to tomorrow tab, verify toggles work
- Verify bar chart uses gradient colors

**Commit after passing.**

---

### Task 4: Heatmap UI + Cost Estimator [Mode: Delegated]

**Files:**
- Modify: `frontend/index.html`

#### Part A: Heatmap — "Viikkokuvio"

**Data:** Fetch from `/prices/heatmap`, store in `state.heatmap`

**HTML:** Section with heading, area/bar toggle, and container div.

**Default view (CSS grid):**
- Grid: `grid-template-columns: auto repeat(24, 1fr)`
- Row labels: Ma–Su (first column)
- Column headers: 0–23
- Cell background: interpolate green→amber→red based on `(value - minPrice) / (maxPrice - minPrice)`
- Cell size: responsive, ~24-28px desktop
- Hover tooltip: floating div showing "Ma 14:00 — 3.45 c/kWh"

**Chart view (area/bar toggle):**
When toggled to area or bar, render a Chart.js chart with 7 datasets (one per weekday), 24 data points each. Same color scheme. Chart replaces the grid.

**Color interpolation:**
```javascript
function priceToColor(value, min, max)
// Returns CSS color string
// 0% → #22c55e (green)
// 50% → #e8a308 (amber)
// 100% → #ef4444 (red)
// Use HSL interpolation for smooth gradients
```

#### Part B: Cost Estimator — "Ajoitusavustin"

**Device presets:**
```javascript
const DEVICES = [
  { name: 'Kiuas', icon: '🔥', power: 6, duration: 2 },
  { name: 'Sähköauto', icon: '🚗', power: 11, duration: 4 },
  { name: 'Pyykinpesukone', icon: '👕', power: 2, duration: 2 },
  { name: 'Astianpesukone', icon: '🍽', power: 1.8, duration: 1.5 },
  { name: 'Kuivausrumpu', icon: '💨', power: 2.5, duration: 1.5 },
  { name: 'Muu', icon: '⚙', power: null, duration: null },
];
```

**Core function:**
```javascript
function findOptimalWindow(slots, durationHours, powerKw, deadlineHour = null)
// slots: array of { datetime, priceWithTax } (from today + tomorrow if available)
// durationHours: how long the device runs
// powerKw: device power consumption
// deadlineHour: optional, e.g. 7 means must finish by 07:00
//
// Returns: {
//   best: { startTime, endTime, cost },   // cheapest window
//   worst: { startTime, endTime, cost },  // most expensive window
//   savings: number                        // worst.cost - best.cost
// }
//
// Convert duration to quarter-slots: Math.ceil(durationHours * 4)
// Slide window across slots, sum: priceWithTax * powerKw * 0.25 for each slot
// With deadline: only consider windows where endIndex < deadlineSlotIndex
```

**UI:** Chip buttons for device selection, number inputs for power/duration, time input for deadline. Results as three mini-cards (best/worst/savings). Updates on any input change (debounced 300ms).

**Data source:** Combines `state.today.slots` and `state.tomorrow.slots` (if available) into one continuous array.

**Test Cases:**

```javascript
test('findOptimalWindow finds cheapest contiguous block', () => {
  const slots = [
    { priceWithTax: 0.10 }, { priceWithTax: 0.05 },
    { priceWithTax: 0.03 }, { priceWithTax: 0.02 },
    { priceWithTax: 0.08 }, { priceWithTax: 0.12 },
  ];
  const result = findOptimalWindow(slots, 0.5, 1.0); // 2 slots, 1kW
  // Cheapest 2 contiguous: slots 2+3 (0.03+0.02)
  expect(result.best.cost).toBeCloseTo((0.03 + 0.02) * 1.0 * 0.25, 4);
});

test('deadline constraint limits search window', () => {
  // With deadline at slot 3, can only start at 0 or 1 (for 2-slot duration)
  const result = findOptimalWindow(slots, 0.5, 1.0, deadlineSlotIndex=3);
  expect(result.best.startSlot).toBeLessThanOrEqual(1);
});
```

**Constraints:**
- All calculation client-side, no API calls
- Costs displayed in EUR (€), formatted to 2 decimal places
- Finnish labels throughout
- Responsive: chips wrap, inputs stack on mobile

**Verification:**
Deploy and visually verify:
- Heatmap renders with color-coded grid
- Hover shows tooltip with price
- Area/bar toggle switches heatmap visualization
- Select "Kiuas" → inputs populate 6kW/2h → results show best/worst window
- Set deadline → results change accordingly
- Custom device → inputs editable

**Commit after passing.**

---

### Task 5: Integration & Deploy [Mode: Direct]

**Files:**
- Modify: `backend/src/app.ts` (verify heatmap route accessible)
- Modify: `CLAUDE.md` (update if needed)
- Modify: `.claude/phases/current.md` (mark progress)

**Steps:**
1. Build backend: `cd backend && npm run build`
2. Push to VPS: `git deployboth`
3. Run backfill on VPS: `ssh vps "cd /var/www/spot-price/backend && node dist/collector.js --backfill"`
4. Verify heatmap endpoint: `curl -s https://mase.fi/porssi/api/prices/heatmap | jq '.matrix | length'`
5. Visual QA of all new features via browser
6. Update phase doc with completion notes

**Verification:**
```bash
# Backend health
curl -s https://mase.fi/porssi/api/health

# Heatmap populated
curl -s https://mase.fi/porssi/api/prices/heatmap | jq '{days: (.matrix | length), hours: (.matrix[0].hours | length)}'

# DB has historical data
ssh vps "sudo -u postgres psql -d porssi -c 'SELECT COUNT(*) FROM prices;'"
```

**Commit after passing.**

---

## Task Dependencies

```
Task 1 (Backfill) ──┐
                     ├── Task 5 (Integration & Deploy)
Task 2 (Heatmap API)─┤
                     │
Task 3 (Chart Controls)──┤
                         │
Task 4 (Heatmap UI + Cost Estimator) ← depends on Task 2
```

- Tasks 1, 2, 3 are independent — can run in parallel
- Task 4 needs Task 2 (heatmap API must exist)
- Task 5 needs all others

---

## Execution
**Skill:** superpowers:subagent-driven-development
- Mode A tasks: Opus implements directly (Tasks 3, 5)
- Mode B tasks: Dispatched to subagents (Tasks 1, 2, 4)
