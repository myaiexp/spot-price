// Pure chart series: resolution, DST-correct labels, ghost alignment, now index.
import { emaAggregate, alignSecondaryByWallClock } from './calc.js';
import { eurToCents, slotLabel, hourLabel } from './format.js';
import { findSlotContaining, SLOT_MS, HOUR_MS } from './slot-time.js';

// Everything data-dependent the price chart draws, derived from UI state and the
// current instant. Returns null when the active tab has no primary slots — the
// caller paints the empty-data placeholder instead of constructing a chart.
export function chartSeries(state, nowMs) {
  const isToday = state.activeTab === 'today';
  const primary = isToday ? state.today : state.tomorrow;
  const secondary = isToday ? state.yesterday : state.today;

  if (!primary || !primary.slots || primary.slots.length === 0) return null;

  const isHourly = state.resolution === 'hourly';
  const isBar = state.chartType === 'bar';

  let primarySlots = primary.slots;
  let secondarySlots = secondary && secondary.slots ? secondary.slots : [];
  if (isHourly) {
    primarySlots = emaAggregate(primarySlots);
    if (secondarySlots.length > 0) secondarySlots = emaAggregate(secondarySlots);
  }

  // Labels derived from each slot's own datetime — DST-correct (no h*4 drift),
  // colon form (formatTime's fi-FI dots are prose, not axis labels).
  const labels = primarySlots.map((s) =>
    isHourly ? hourLabel(s.datetime) : slotLabel(s.datetime),
  );
  const primaryData = primarySlots.map((s) => eurToCents(s.priceWithTax));
  // Ghost series: match secondary to primary by Helsinki wall-clock, not index
  // (DST length mismatch + hourly-backfill vs 15-min primary; audit #6332).
  // Empty secondary → [] so the config builder skips the ghost dataset.
  const secondaryData = alignSecondaryByWallClock(primarySlots, secondarySlots, {
    hourly: isHourly,
  }).map((p) => (p == null ? null : eurToCents(p)));

  // "Now" x-position: the slot/hour bucket whose window contains the current
  // instant (−1 when outside the shown data, e.g. after midnight rollover, and
  // always −1 off the today tab). Bucket width must match the resolution.
  const nowIndex = isToday
    ? findSlotContaining(primarySlots, nowMs, isHourly ? HOUR_MS : SLOT_MS)
    : -1;

  return {
    labels,
    primaryData,
    secondaryData,
    primaryLabel: isToday ? 'Tänään' : 'Huomenna',
    secondaryLabel: isToday ? 'Eilen' : 'Tänään',
    nowIndex,
    isHourly,
    isBar,
  };
}
