# Window bounds and cheap-rank polarity

Two invariants that look swappable and aren't. Both have painted the wrong thing on screen when inverted.

## Exclusive window bounds

Window bounds are exclusive everywhere and say so in the name. `windowSums`'s third argument, and the `endExclusive` field on every window from `findCheapestBlock` / `findPeakBlock` / `findNextCheapWindow` / `findOptimalWindow`, is one past the last included slot. That feeds `slotBoundaryMs` / `slotBoundaryLabel` / `slotSpanLabel` directly with no `+1` at the call site.

Peak runs stay `{startIndex, endExclusive}` through collect/merge/pick too — gap is `next.startIndex - prev.endExclusive`, length is `endExclusive - startIndex`.

`endIndex` used to mean *inclusive* in `calc.js` and *exclusive* in `estimator-calc.js`. Don't reintroduce a bound whose name doesn't state its side.

## /now slot windows

`GET /now` uses the same exclusive 15-minute window as the frontend's `findSlotContaining`: `[start, start+15min)`, never stretched to the next stored start. A miss is not "always last of day":

- inside a window → that slot, `stale: false`
- past the last window, or in an interior gap → most recent *past* slot, `stale: true`
- before the first slot, or today empty → 404 (`null` from the query; the route owns the status)

## Cheap-rank polarity

`GET /now` reports `cheaperThanPercent` — the share of today's slots that cost **more** than the current one, so **high = cheap**. The hero tints ≥70 green / ≥30 amber / else red and captions "Halvempi kuin X% tänään" straight from it.

It was once a bottom-up `percentile` (share *cheaper* than now), which the hero read as a cheap signal and painted peak prices green. Keep both ends of the wire on this polarity: the field name, `queries/now.ts`, and `js/hero-calc.js`.
