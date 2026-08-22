# Collector and backfill

`src/collector.ts` is a thin CLI entry only — compiled to `dist/collector.js` and run by the `spot-price-collector` systemd timer every 15 min. Collect/backfill logic lives in side-effect-free library modules; conversion + HTTP helpers in `src/utils/`.

| Module | Role |
| --- | --- |
| `src/collectors/spot-hinta.ts` | Live 15-min collect from spot-hinta.fi (`TodayAndDayForward`) |
| `src/collectors/sahkotin.ts` | Historical hourly backfill (Dec 2012 onward) |
| `src/collectors/upsert.ts` | Shared upsert into Postgres |

Both the API (`backend/src/index.ts`) and this CLI refuse to start without `DATABASE_URL`.

## Live collect

Timer fires `dist/collector.js` with no flags. Upserts today's (and already-published tomorrow's) 15-min slots from spot-hinta.fi. Prices arrive already in EUR/kWh with and without tax.

## Backfill

sahkotin.fi API, hourly data from Dec 2012, EUR/MWh → EUR/kWh × 1.255 VAT.

```
npm run backfill                          # full history
npm run collect -- --backfill=2024-01-01  # resume
```

The default exclusive upper bound is Helsinki local midnight of the current Helsinki day — live spot-hinta owns Helsinki today. `--backfill=DATE` maps to `walkBackFrom`, an exclusive upper bound: the walk moves *backwards* from that instant.

Deploy (port, units, `.env`): `CLAUDE.md` Deploy.
