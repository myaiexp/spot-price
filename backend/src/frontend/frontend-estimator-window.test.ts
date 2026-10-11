// Pins findOptimalWindow against a missing quarter-hour (finding #12151).
// A 1h window must be 60 minutes of clock time, not four array steps.

import { describe, it, expect } from 'vitest';
import { findOptimalWindow } from '../../../frontend/js/estimator-calc.js';
import { slotSpanLabel } from '../../../frontend/js/format.js';
import { SLOT_MS } from '../../../frontend/js/slot-time.js';
import { stepSlots } from '../test-support/rows.js';

// Wall-clock length of a returned window. Uses the exclusive-end slot's own
// start when that slot exists, so a window that jumped a hole measures long.
function windowSpanMs(
  slots: { datetime: string }[],
  win: { startIndex: number; endExclusive: number },
) {
  const endMs =
    win.endExclusive < slots.length
      ? Date.parse(slots[win.endExclusive].datetime)
      : Date.parse(slots[win.endExclusive - 1].datetime) + SLOT_MS;
  return endMs - Date.parse(slots[win.startIndex].datetime);
}

describe('findOptimalWindow across a missing quarter-hour (finding #12151)', () => {
  it('keeps a 1h window on the clock when a quarter-hour is missing', () => {
    // 14:00, 14:15, [14:30 missing], then 14:45 onward. The cheapest index
    // window of 4 sums the three 1s plus a 5 and labels 14:00–15:15 (75 min).
    const slots = stepSlots('2026-01-15T12:00:00.000Z', [1, 1, 1, 1, 5, 5, 5, 5]).filter(
      (_, i) => i !== 2,
    );
    const r = findOptimalWindow(slots, 1, 1, null)!;
    expect(windowSpanMs(slots, r.best)).toBe(60 * 60 * 1000);
    expect(windowSpanMs(slots, r.worst)).toBe(60 * 60 * 1000);
    expect(slotSpanLabel(slots, r.best.startIndex, r.best.endExclusive)).toBe('14:45–15:45');
  });

  it('returns null when every 1h candidate crosses the hole', () => {
    const slots = stepSlots('2026-01-15T12:00:00.000Z', [1, 1, 1, 1, 1]).filter((_, i) => i !== 2);
    expect(slots).toHaveLength(4);
    expect(findOptimalWindow(slots, 1, 1, null)).toBeNull();
  });
});
