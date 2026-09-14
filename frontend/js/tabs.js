// Tomorrow-tab renderer: disables Huomenna when unpublished, falls back to Tänään.
import { state } from './state.js';
import { tomorrowTabDecision } from './tab-state.js';
import { setActive } from './ui.js';

// Applies tomorrowTabDecision (tab-state.js) to the DOM. Runs first in the
// loader's renderer list so a fallback to Tänään is in state before the chart
// and insight renderers read state.activeTab.
export function renderTomorrowTab(deps) {
  const doc = deps?.document ?? globalThis.document;
  const decision = tomorrowTabDecision(state.tomorrow, state.activeTab);
  const btn = doc.getElementById('tabTomorrow');
  if (!btn) return;
  btn.disabled = !decision.enabled;
  btn.title = decision.enabled ? '' : 'Huomisen hintoja ei vielä saatavilla';
  if (decision.activeTab !== state.activeTab) {
    state.activeTab = decision.activeTab;
    setActive(doc.querySelectorAll('.tab-btn'), (b) => b.dataset.tab === decision.activeTab);
  }
}
