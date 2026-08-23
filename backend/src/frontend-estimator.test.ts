// Pins estimator miss copy: unpublished tomorrow vs no fitting window
// (finding #7618). estimator-calc pins isDeadlineDayUnavailable; the Finnish
// strings live in estimator.js.

import { describe, it, expect, afterEach } from 'vitest';
import { updateEstimator } from '../../frontend/js/estimator.js';
import { state } from '../../frontend/js/state.js';
import { stepSlots } from './test-support/rows.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';

// 16 quarter-hour slots from 20:00 EEST (4h of evening). A 5h job cannot fit.
const EVENING = stepSlots('2026-07-17T17:00:00.000Z', Array(16).fill(10));
const NOW_MS = Date.parse(EVENING[0].datetime);

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
