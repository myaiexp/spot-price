// Tomorrow-tab enable/fallback when data is missing.
import { hasSlots } from './slot-time.js';

// Tomorrow-tab enablement plus the active tab to show. When tomorrow's data is
// gone (midnight rollover until ~14:00) and the user is still on Huomenna,
// fall back to Tänään so the dashboard doesn't sit on empty cards (finding #7099).
export function tomorrowTabDecision(tomorrow, activeTab) {
  const enabled = hasSlots(tomorrow);
  if (!enabled && activeTab === 'tomorrow') {
    return { enabled: false, activeTab: 'today' };
  }
  return { enabled, activeTab };
}
