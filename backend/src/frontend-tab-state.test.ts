// Tests for tomorrow-tab enable/fallback (../../frontend/js/tab-state.js).
// A dashboard left on Huomenna overnight used to keep that tab active after
// midnight rollover, when /tomorrow 404s until ~14:00 — empty chart + cards
// until the user clicked Tänään (finding #7099).

import { describe, it, expect } from 'vitest';
import { tomorrowTabDecision } from '../../frontend/js/tab-state.js';

const withSlots = { slots: [{ datetime: '2026-07-19T00:00:00.000Z' }] };

describe('tomorrowTabDecision', () => {
  it('enables the tab and keeps today active when tomorrow has slots', () => {
    expect(tomorrowTabDecision(withSlots, 'today')).toEqual({
      enabled: true,
      activeTab: 'today',
    });
  });

  it('keeps tomorrow active when it is selected and data is present', () => {
    expect(tomorrowTabDecision(withSlots, 'tomorrow')).toEqual({
      enabled: true,
      activeTab: 'tomorrow',
    });
  });

  it('disables the tab and stays on today when tomorrow is missing', () => {
    expect(tomorrowTabDecision(null, 'today')).toEqual({
      enabled: false,
      activeTab: 'today',
    });
  });

  it('disables the tab for empty slots the same as for a missing payload', () => {
    expect(tomorrowTabDecision({ slots: [] }, 'today')).toEqual({
      enabled: false,
      activeTab: 'today',
    });
  });

  it('falls back to today when tomorrow is active but its data is gone', () => {
    expect(tomorrowTabDecision(null, 'tomorrow')).toEqual({
      enabled: false,
      activeTab: 'today',
    });
    expect(tomorrowTabDecision({ slots: [] }, 'tomorrow')).toEqual({
      enabled: false,
      activeTab: 'today',
    });
  });
});
