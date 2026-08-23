// Pins the hero renderer's user-visible recovery copy (finding #7618).
// load.js only asserts that noteStale fires; the Finnish strings live in
// hero.js. A document-like deps object lets us call renderHero without jsdom.

import { describe, it, expect, afterEach } from 'vitest';
import { renderHero } from '../../frontend/js/hero.js';
import { state } from '../../frontend/js/state.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';

const SLOT_ISO = '2026-07-18T11:30:00.000Z'; // 14:30 EEST

function resetState() {
  state.now = null;
  state.refreshFailed = false;
}

afterEach(resetState);

function heroDoc() {
  const els = {
    heroPrice: fakeEl(),
    heroTint: fakeEl(),
  };
  return { doc: fakeDocument(els), els };
}

function withPrice(extra = {}) {
  state.now = {
    slot: { datetime: SLOT_ISO, priceWithTax: 0.05, priceNoTax: 0.04 },
    cheaperThanPercent: 50,
    ...extra,
  };
}

describe('renderHero recovery copy (finding #7618)', () => {
  it('notes a failed refresh without wiping the last-known price', () => {
    withPrice();
    state.refreshFailed = true;
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('Päivitys epäonnistui — näytetään viimeisin hinta');
    expect(els.heroPrice.innerHTML).toContain('5.00');
    expect(els.heroPrice.innerHTML).not.toContain('Tietojen lataus epäonnistui');
  });

  it('flags a stale slot with the fi-FI "klo" prose form, not a colon axis label', () => {
    withPrice({ stale: true });
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain(
      'Viimeisin saatavilla oleva hinta (klo 14.30)',
    );
    expect(els.heroPrice.innerHTML).not.toContain('klo 14:30');
    expect(els.heroPrice.innerHTML).not.toContain(
      'Päivitys epäonnistui — näytetään viimeisin hinta',
    );
  });

  it('shows both the stale "klo" note and the refresh-failed note when both apply', () => {
    withPrice({ stale: true });
    state.refreshFailed = true;
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('klo 14.30');
    expect(els.heroPrice.innerHTML).toContain(
      'Päivitys epäonnistui — näytetään viimeisin hinta',
    );
  });

  it('omits both recovery notes on a live successful price', () => {
    withPrice({ stale: false });
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('5.00');
    expect(els.heroPrice.innerHTML).not.toContain('klo 14.30');
    expect(els.heroPrice.innerHTML).not.toContain('Päivitys epäonnistui');
  });
});
