// Pins the insight-card renderer (finding #7898). insights-calc pins
// placeholders so a tab switch cannot leave yesterday's window; these assert
// renderInsights actually writes all six DOM fields, including when cheap/peak
// are placeholders. A { document, nowMs } deps bag lets us copy-test without jsdom.

import { describe, it, expect, afterEach } from 'vitest';
import { renderInsights } from '../../frontend/js/insights.js';
import { state } from '../../frontend/js/state.js';
import { stepSlots } from './test-support/rows.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';

const SHORT = stepSlots('2026-01-15T12:00:00.000Z', [0.3, 0.3, 0.3]);
const NOW_MS = Date.parse('2026-01-15T12:05:00.000Z');

function resetState() {
  state.today = null;
  state.tomorrow = null;
  state.activeTab = 'today';
}

afterEach(resetState);

function insightsDoc() {
  const els = {
    insightCheapValue: fakeEl({ textContent: 'STALE' }),
    insightCheapDetail: fakeEl({ textContent: 'STALE' }),
    insightNextValue: fakeEl({ textContent: 'STALE' }),
    insightNextDetail: fakeEl({ textContent: 'STALE' }),
    insightPeakValue: fakeEl({ textContent: 'STALE' }),
    insightPeakDetail: fakeEl({ textContent: 'STALE' }),
  };
  return { doc: fakeDocument(els), els };
}

describe('renderInsights six-field write (finding #7898)', () => {
  it('overwrites all six fields with placeholders when the tab has no slots', () => {
    // The stale-card bug: a tab switch used to skip cheap/peak when absent,
    // leaving yesterday's window on screen (audit #5552).
    state.activeTab = 'tomorrow';
    state.tomorrow = null;
    const { doc, els } = insightsDoc();

    renderInsights({ document: doc, nowMs: NOW_MS });

    expect(els.insightCheapValue.textContent).toBe('—');
    expect(els.insightCheapDetail.textContent).toBe('Ei tietoja');
    expect(els.insightNextValue.textContent).toBe('—');
    expect(els.insightNextDetail.textContent).toBe('Ei tietoja');
    expect(els.insightPeakValue.textContent).toBe('—');
    expect(els.insightPeakDetail.textContent).toBe('Ei tietoja');
  });

  it('writes cheap and peak placeholders even when next has copy', () => {
    // 3 slots: too few for the 8-slot cheapest block and a 4-slot peak run.
    // Cheap/peak must still be written so they cannot keep STALE text.
    state.activeTab = 'today';
    state.today = { slots: SHORT };
    const { doc, els } = insightsDoc();

    renderInsights({ document: doc, nowMs: NOW_MS });

    expect(els.insightCheapValue.textContent).toBe('—');
    expect(els.insightCheapDetail.textContent).toBe('Ei tietoja');
    expect(els.insightPeakValue.textContent).toBe('—');
    expect(els.insightPeakDetail.textContent).toBe('Ei tietoja');
    expect(els.insightNextValue.textContent).not.toBe('STALE');
    expect(els.insightNextDetail.textContent).not.toBe('STALE');
  });
});
