// Pins the hero renderer's user-visible copy (finding #7618, finding #7900).
// load.js only asserts that noteStale fires; cheap-rank polarity lives in
// hero-calc. These assert renderHero actually paints the tint, caption,
// yesterday line, empty placeholder, and recovery notes — so an inverted
// comparison inlined in the renderer cannot leave calc/route tests green.

import { describe, it, expect, afterEach } from 'vitest';
import { renderHero } from '../../frontend/js/hero.js';
import { HERO_TINTS } from '../../frontend/js/hero-calc.js';
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

describe('renderHero cheap-rank caption, tint, empty (finding #7900)', () => {
  it('paints a cheap rank green and captions Halvempi kuin 80% tänään', () => {
    withPrice({ cheaperThanPercent: 80 });
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroTint.style.background).toBe(HERO_TINTS.cheap);
    expect(els.heroTint.style.background).not.toBe(HERO_TINTS.expensive);
    expect(els.heroPrice.innerHTML).toContain('Halvempi kuin 80% tänään');
  });

  it('paints a peak rank (0) red, never green', () => {
    withPrice({ cheaperThanPercent: 0 });
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroTint.style.background).toBe(HERO_TINTS.expensive);
    expect(els.heroTint.style.background).not.toBe(HERO_TINTS.cheap);
    expect(els.heroPrice.innerHTML).toContain('Halvempi kuin 0% tänään');
  });

  it('shows the yesterday-same-time line when yesterdaySlot is present', () => {
    withPrice({
      yesterdaySlot: { datetime: SLOT_ISO, priceWithTax: 0.08, priceNoTax: 0.06 },
    });
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('Eilen samaan aikaan');
    expect(els.heroPrice.innerHTML).toContain('8.00');
  });

  it('swaps the loading placeholder for Ei hintatietoja when now is missing', () => {
    state.now = null;
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('Ei hintatietoja saatavilla');
    expect(els.heroPrice.innerHTML).not.toContain('Halvempi kuin');
    expect(els.heroTint.style.background).toBeUndefined();
  });

  it('treats a now payload without a slot the same as missing now', () => {
    state.now = { cheaperThanPercent: 80 };
    const { doc, els } = heroDoc();

    renderHero({ document: doc });

    expect(els.heroPrice.innerHTML).toContain('Ei hintatietoja saatavilla');
    expect(els.heroPrice.innerHTML).not.toContain('Halvempi kuin');
    expect(els.heroTint.style.background).toBeUndefined();
  });
});
