// Hero card: the current price headline with percentile tint and freshness note.
import { state } from './state.js';
import { formatCents, formatTime } from './format.js';

export function showError(msg) {
  document.getElementById('heroPrice').innerHTML = `<div class="error-msg">${msg}</div>`;
}

export function renderHero() {
  const container = document.getElementById('heroPrice');
  const tint = document.getElementById('heroTint');

  if (!state.now || !state.now.slot) {
    container.innerHTML = '<div class="hero-card__loading">Ei hintatietoja saatavilla</div>';
    return;
  }

  const priceCents = formatCents(state.now.slot.priceWithTax);
  const percentile = state.now.percentile;

  // Color tint based on percentile
  let tintColor;
  if (percentile >= 70) {
    tintColor = 'rgba(34, 197, 94, 0.08)';
  } else if (percentile >= 30) {
    tintColor = 'rgba(232, 163, 8, 0.08)';
  } else {
    tintColor = 'rgba(239, 68, 68, 0.08)';
  }
  tint.style.background = tintColor;

  let html = `
    <div class="hero-card__price">${priceCents}<span>c/kWh</span></div>
    <div class="hero-card__context">Halvempi kuin ${percentile}% tänään</div>
  `;

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

  container.innerHTML = html;
}
