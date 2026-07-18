// Shared mutable UI state for the price dashboard.
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
};
