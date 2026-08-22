// Shared mutable UI state for the price dashboard (incl. refreshFailed).
export const state = {
  today: null,
  yesterday: null,
  tomorrow: null,
  now: null,
  activeTab: 'today',
  heatmap: null,
  chartType: 'area',
  resolution: '15min',
  chart: null,
  // True after a refresh fetch failed while we still hold last-known-good data.
  // Cleared on the next successful apply. Hero shows a note rather than wiping.
  refreshFailed: false,
};
