// Hero card: the current price headline with cheap-rank tint and freshness note.
import { state } from './state.js';
import { formatCents, formatTime } from './format.js';
import { heroSignal } from './hero-calc.js';

export function showError(msg, deps) {
  const doc = deps?.document ?? globalThis.document;
  doc.getElementById('heroPrice').innerHTML = `<div class="error-msg">${msg}</div>`;
}

export function renderHero(deps) {
  const doc = deps?.document ?? globalThis.document;
  const container = doc.getElementById('heroPrice');
  const tint = doc.getElementById('heroTint');

  if (!state.now || !state.now.slot) {
    container.innerHTML = '<div class="hero-card__loading">Ei hintatietoja saatavilla</div>';
    return;
  }

  const priceCents = formatCents(state.now.slot.priceWithTax);

  // Tint + caption from the cheap-rank. Polarity and thresholds live in
  // hero-calc so they stay pinned by unit tests (see heroBand).
  const signal = heroSignal(state.now.cheaperThanPercent);
  tint.style.background = signal.tint;

  let html = `<div class="hero-card__price">${priceCents}<span>c/kWh</span></div>`;
  if (signal.context) {
    html += `<div class="hero-card__context">${signal.context}</div>`;
  }

  if (state.now.yesterdaySlot) {
    const yPrice = formatCents(state.now.yesterdaySlot.priceWithTax);
    html += `<div class="hero-card__yesterday">Eilen samaan aikaan: ${yPrice} c/kWh</div>`;
  }

  // Collection lag: backend served the most recent available slot, not the live
  // one. Flag the freshness so the headline price isn't read as "now".
  // Interpolated values are our own API's number/ISO-time, not user input.
  if (state.now.stale) {
    html += `<div class="hero-card__stale">Viimeisin saatavilla oleva hinta (klo ${formatTime(state.now.slot.datetime)})</div>`;
  }

  // Quarter-hour refresh failed but we still hold a price — keep it on screen
  // with a note rather than painting "Tietojen lataus epäonnistui" over it
  // (finding #7102). The next successful load clears refreshFailed.
  if (state.refreshFailed) {
    html += '<div class="hero-card__stale">Päivitys epäonnistui — näytetään viimeisin hinta</div>';
  }

  container.innerHTML = html;
}
