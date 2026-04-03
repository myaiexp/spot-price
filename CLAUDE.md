# Spot Price

> Finnish electricity spot price tracker with historical data and comparison views.

## Stack

- **Frontend**: Single HTML file with vanilla JS, Chart.js, custom CSS (mase.fi theme)
- **Backend**: Hono + Drizzle ORM + @hono/node-server (TypeScript)
- **Database**: PostgreSQL 16 (on VPS, `porssi` database)

## Project Structure

```
frontend/
  index.html           # The spot price app (single page)
backend/
  src/
    index.ts            # Entry point (dotenv, serve)
    app.ts              # Hono app factory (CORS, routes)
    routes/
      prices.ts         # Price API endpoints
    db/
      connection.ts     # Drizzle + pg pool
      schema.ts         # prices table definition
    collector.ts        # Fetches from spot-hinta.fi, upserts to DB
  drizzle/              # Migrations
  package.json
  tsconfig.json
```

## Key Patterns

- Backend follows the diet-app Hono pattern: `createApp(db)` factory, route modules, Drizzle ORM
- Frontend uses mase.fi's design system: near-black backgrounds, golden-amber accent, Bricolage Grotesque + DM Sans fonts
- Data collection: systemd timer runs collector every 15 minutes, upserts spot-hinta.fi data
- Historical backfill: sahkotin.fi API, hourly data from Dec 2012, run via `npm run backfill`
- API sources: spot-hinta.fi (live 15-min), sahkotin.fi (historical hourly backfill, EUR/MWh → EUR/kWh × 1.255 VAT)
- EMA (α=0.3) used for hourly chart aggregation
- Heatmap shows current week's actual hourly prices (SQL-aggregated), greyed cells for missing data

## Deployment

- **Remote**: `production` → `vps:/var/repo/spot-price.git`
- **Live URL**: https://mase.fi/porssi (frontend), https://mase.fi/porssi/api/ (backend proxy)
- **Deploy**: `git deployboth`
- **VPS path**: `/opt/spot-price` (env file: `/opt/spot-price/.env`)
- **Type**: service (port 3600) + static frontend
- **Service**: `spot-price.service` (systemd)
- **Timer**: `spot-price-collector.timer` (every 15 min)
- **Backfill**: `ssh vps "cd /opt/spot-price && export $(cat .env | xargs) && cd backend && node dist/collector.js --backfill"`

---

## Current Phase

**Between phases** — Phase 2 complete. Next: historical data views / dedicated history tab.

Details: `.claude/phases/current.md`

### Decisions from previous phases

- Backend follows diet-app Hono pattern: `createApp(db)` factory, route modules, Drizzle ORM
- Frontend is a single HTML file with vanilla JS, Chart.js, mase.fi theme
- Data source: spot-hinta.fi REST API, collected every 15 min via systemd timer
- All times handled in Helsinki timezone with DST-aware UTC conversion
- Service name: `spot-price.service` (not `spot-price-api`)
- Heatmap = current week's actual prices, not historical EMA (historical should get its own tab)
- Cost estimator is pure client-side using today+tomorrow slots
- Chart controls: area/bar toggle, 15min/hourly resolution with EMA aggregation
- Peak detection: 60th percentile threshold with 30min gap bridging

---

## Doc Management

This project splits documentation to minimize context usage. Follow these rules:

### File layout

| File                         | Purpose                                                        | When to read                              |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `CLAUDE.md` (this file)      | Project identity, structure, patterns, current phase pointer   | Auto-loaded every session                 |
| `.claude/phases/current.md`  | Symlink → active phase file                                    | Read when starting phase work             |
| `.claude/phases/NNN-name.md` | Phase files (active via symlink, completed ones local-only)    | Only if you need historical context       |
| `.claude/ideas.md`           | Future feature ideas, tech debt, and enhancements              | When planning next phase or brainstorming |
| `.claude/plans/`             | Design docs and implementation plans from brainstorming        | When implementing or reviewing designs    |
| `.claude/references/`        | Domain reference material (specs, external docs, data sources) | When you need domain knowledge            |
| `.claude/[freeform].md`      | Project-specific context docs (architecture, deployment, etc.) | As referenced from this file              |

### Phase transitions

When a phase is completed:

1. **Condense** — extract lasting decisions from the active phase file and add to "Decisions from previous phases". Keep each to 1-2 lines.
2. **Archive** — remove the `current.md` symlink. The completed phase file stays but is no longer committed.
3. **Start fresh** — create a new numbered phase file from `~/.claude/phase-template.md`, then symlink `current.md` → it.
4. **Update this file** — update the "Current Phase" section above.
5. **Prune** — remove anything from this file that was phase-specific and no longer applies.

### What goes where

- **This file**: project-wide truths (stack, structure, patterns, conventions)
- **Phase doc**: goals, requirements, architecture decisions, implementation notes
- **Process rules**: delegation and modularization standards live in `~/.claude/process.md`
