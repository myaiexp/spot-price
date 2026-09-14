// Pins estimator renderer copy (finding #7618, finding #7899). estimator-calc
// pins findOptimalWindow / slotSpanLabel; these assert updateEstimator paints
// the Halvin/Kallein/Säästö cards, euro toFixed(2), colon-form spans, and the
// empty-input / no-slot placeholders — so a renderer that used fi-FI formatTime
// or swapped best/worst cannot leave the calc tests green.

import { describe, it, expect, afterEach } from 'vitest';
import { updateEstimator } from '../../frontend/js/estimator.js';
import { state } from '../../frontend/js/state.js';
import { stepSlots } from './test-support/rows.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';

// 16 quarter-hour slots from 20:00 EEST (4h of evening). A 5h job cannot fit.
const EVENING = stepSlots('2026-07-17T17:00:00.000Z', Array(16).fill(10));
const NOW_MS = Date.parse(EVENING[0].datetime);

// Cheap hour then dear hour from 20:00 EEST. 1 kW × 1 h → 0.10 € vs 0.40 €.
const TWO_HOURS = stepSlots('2026-07-17T17:00:00.000Z', [
  0.1, 0.1, 0.1, 0.1, 0.4, 0.4, 0.4, 0.4,
]);
const NOW_MS_FIT = Date.parse(TWO_HOURS[0].datetime);

function resetState() {
  state.today = null;
  state.tomorrow = null;
}

afterEach(resetState);

function estimatorDoc({ power = '1', duration = '5', deadline = '' } = {}) {
  const els = {
    estimatorResults: fakeEl(),
    inputPower: fakeEl({ value: power }),
    inputDuration: fakeEl({ value: duration }),
    inputDeadline: fakeEl({ value: deadline }),
  };
  return { doc: fakeDocument(els), els };
}

describe('updateEstimator miss copy (finding #7618)', () => {
  it('says tomorrow is unpublished when a rolled deadline has no next-day slots', () => {
    state.today = { slots: EVENING };
    state.tomorrow = null;
    const { doc, els } = estimatorDoc({ deadline: '07:00' });

    updateEstimator({ document: doc, nowMs: NOW_MS });

    expect(els.estimatorResults.innerHTML).toContain(
      'Huomisen hintoja ei vielä saatavilla',
    );
    expect(els.estimatorResults.innerHTML).not.toContain(
      'Ei sopivia aikaikkunoita löytynyt',
    );
  });

  it('says no fitting windows when the miss is not an unpublished tomorrow', () => {
    state.today = { slots: EVENING };
    state.tomorrow = null;
    const { doc, els } = estimatorDoc({ deadline: '' });

    updateEstimator({ document: doc, nowMs: NOW_MS });

    expect(els.estimatorResults.innerHTML).toContain(
      'Ei sopivia aikaikkunoita löytynyt',
    );
    expect(els.estimatorResults.innerHTML).not.toContain(
      'Huomisen hintoja ei vielä saatavilla',
    );
  });
});

describe('updateEstimator success path and placeholders (finding #7899)', () => {
  it('paints Halvin/Kallein/Säästö cards with euro costs and colon spans', () => {
    state.today = { slots: TWO_HOURS };
    state.tomorrow = null;
    const { doc, els } = estimatorDoc({ power: '1', duration: '1', deadline: '' });

    updateEstimator({ document: doc, nowMs: NOW_MS_FIT });

    const html = els.estimatorResults.innerHTML;
    expect(html).toContain('Halvin aika');
    expect(html).toContain('Kallein aika');
    expect(html).toContain('Säästö');
    expect(html).toContain('0.10 €');
    expect(html).toContain('0.40 €');
    expect(html).toContain('0.30 €');
    expect(html).toContain('20:00–21:00');
    expect(html).toContain('21:00–22:00');
    expect(html).toContain('oikealla ajoituksella');
    // slotSpanLabel is colon-form; formatTime would have painted 20.00.
    expect(html).not.toContain('20.00');
    expect(html).not.toContain('21.00');
    expect(html).not.toContain('22.00');
    // Cheapest window is the first hour, dearest the second — not swapped.
    const cheapestAt = html.indexOf('0.10 €');
    const dearestAt = html.indexOf('0.40 €');
    const cheapestSpan = html.indexOf('20:00–21:00');
    const dearestSpan = html.indexOf('21:00–22:00');
    expect(cheapestAt).toBeGreaterThan(-1);
    expect(dearestAt).toBeGreaterThan(cheapestAt);
    expect(cheapestSpan).toBeGreaterThan(-1);
    expect(dearestSpan).toBeGreaterThan(cheapestSpan);
  });

  it('never starts Halvin on a slot that ended exactly at now (finding #9933)', () => {
    // now = end of 20:45–21:00 (the last cheap slot). Keeping it would make
    // Halvin 20:45–21:45; the only live 1h window is 21:00–22:00.
    state.today = { slots: TWO_HOURS };
    state.tomorrow = null;
    const { doc, els } = estimatorDoc({ power: '1', duration: '1', deadline: '' });

    updateEstimator({ document: doc, nowMs: Date.parse(TWO_HOURS[4].datetime) });

    const html = els.estimatorResults.innerHTML;
    expect(html).toContain('21:00–22:00');
    expect(html).not.toContain('20:45');
  });

  it('keeps a 23:59 Halvin inside today when tomorrow is cheaper (finding #9574)', () => {
    // Today 20:00–23:45: dear until 23:00, cheap last hour. Tomorrow cheaper still.
    state.today = {
      slots: stepSlots('2026-07-17T17:00:00.000Z', [...Array(12).fill(0.4), 0.1, 0.1, 0.1, 0.1]),
    };
    state.tomorrow = { slots: stepSlots('2026-07-17T21:00:00.000Z', Array(8).fill(0.01)) };
    const { doc, els } = estimatorDoc({ power: '1', duration: '1', deadline: '23:59' });

    updateEstimator({ document: doc, nowMs: Date.parse('2026-07-17T17:00:00.000Z') });

    const html = els.estimatorResults.innerHTML;
    expect(html).toContain('23:00–00:00');
    expect(html).toContain('0.10 €');
    expect(html).not.toContain('00:00–01:00');
  });

  it('asks for power and duration when the inputs are empty', () => {
    state.today = { slots: TWO_HOURS };
    const { doc, els } = estimatorDoc({ power: '', duration: '', deadline: '' });

    updateEstimator({ document: doc, nowMs: NOW_MS_FIT });

    expect(els.estimatorResults.innerHTML).toContain(
      'Valitse laite tai syötä teho ja kesto',
    );
    expect(els.estimatorResults.innerHTML).not.toContain('Halvin aika');
  });

  it('says there is no slot data when today and tomorrow are empty', () => {
    state.today = null;
    state.tomorrow = null;
    const { doc, els } = estimatorDoc({ power: '1', duration: '1', deadline: '' });

    updateEstimator({ document: doc, nowMs: NOW_MS_FIT });

    expect(els.estimatorResults.innerHTML).toContain('Ei hintatietoja laskentaan');
    expect(els.estimatorResults.innerHTML).not.toContain('Halvin aika');
    expect(els.estimatorResults.innerHTML).not.toContain(
      'Valitse laite tai syötä teho ja kesto',
    );
  });
});
