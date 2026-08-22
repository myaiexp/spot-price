# Collector and backfill

`src/collector.ts` is a thin CLI entry only — compiled to `dist/collector.js` and run by the `spot-price-collector` systemd timer every 15 min. Collect/backfill logic lives in side-effect-free library modules; conversion + HTTP helpers in `src/utils/`.

| Module | Role |
| --- | --- |
| `src/collectors/spot-hinta.ts` | Live 15-min collect from spot-hinta.fi (`TodayAndDayForward`) |
| `src/collectors/sahkotin.ts` | Historical hourly backfill (Dec 2012 onward) |
| `src/collectors/upsert.ts` | Shared upsert into Postgres |
| `src/collectors/backfill-arg.ts` | `--backfill` / `--backfill=DATE` CLI parse (`walkBackFrom` exclusive bound) |

Both the API (`backend/src/index.ts`) and this CLI refuse to start without `DATABASE_URL`.

## Live collect

Timer fires `dist/collector.js` with no flags. Upserts today's (and already-published tomorrow's) 15-min slots from spot-hinta.fi. Prices arrive already in EUR/kWh with and without tax.

## Backfill

sahkotin.fi API, hourly data from Dec 2012, EUR/MWh → EUR/kWh × 1.255 VAT.

Malformed slots (empty/unparseable `date`, non-finite `value`) are dropped and the skip count is logged, matching live collect. A non-empty `prices` array that filters to nothing throws — it is not end-of-history (`prices: []`), which would truncate the rest of the walk. Live collect (spot-hinta) skips the same class of DateTime garbage so one bad slot cannot poison the upsert.

```
npm run backfill                          # full history
npm run collect -- --backfill=2024-01-01  # resume
```

The default exclusive upper bound is Helsinki local midnight of the current Helsinki day — live spot-hinta owns Helsinki today. `--backfill=YYYY-MM-DD` maps to `walkBackFrom` at Helsinki midnight of that day (not UTC midnight — that would be 02:00/03:00 Helsinki and walk into the named day's first hours). A full ISO instant is kept as-is. The walk moves *backwards* from that exclusive upper bound.

Deploy (port, units, `.env`): `CLAUDE.md` Deploy.
