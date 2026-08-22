// Cost estimator ("Ajoitusavustin"): device chips + power/duration/deadline
// inputs → cheapest / most expensive charging window and the saving between them.
import { state } from './state.js';
import {
  collectEstimatorSlots,
  findOptimalWindow,
  isDeadlineDayUnavailable,
  parseDeadlineMinutes,
} from './estimator-calc.js';
import { slotSpanLabel } from './format.js';

const DEVICES = [
  { name: 'Kiuas', icon: '🔥', power: 6, duration: 2 },
  { name: 'Sähköauto', icon: '🚗', power: 11, duration: 4 },
  { name: 'Pyykinpesukone', icon: '👕', power: 2, duration: 2 },
  { name: 'Astianpesukone', icon: '🍽', power: 1.8, duration: 1.5 },
  { name: 'Kuivausrumpu', icon: '💨', power: 2.5, duration: 1.5 },
  { name: 'Muu', icon: '⚙', power: null, duration: null },
];

let selectedDeviceIndex = -1;
let estimatorDebounceTimer = null;

function initDeviceChips() {
  const container = document.getElementById('deviceChips');
  DEVICES.forEach((device, idx) => {
    const chip = document.createElement('button');
    chip.className = 'device-chip';
    chip.textContent = `${device.icon} ${device.name}`;
    chip.addEventListener('click', () => {
      // Toggle selection
      if (selectedDeviceIndex === idx) {
        selectedDeviceIndex = -1;
        chip.classList.remove('active');
      } else {
        container.querySelectorAll('.device-chip').forEach((c) => c.classList.remove('active'));
        selectedDeviceIndex = idx;
        chip.classList.add('active');

        // Auto-populate inputs
        const powerInput = document.getElementById('inputPower');
        const durationInput = document.getElementById('inputDuration');
        powerInput.value = device.power !== null ? device.power : '';
        durationInput.value = device.duration !== null ? device.duration : '';
      }
      scheduleEstimatorUpdate();
    });
    container.appendChild(chip);
  });
}

function scheduleEstimatorUpdate() {
  clearTimeout(estimatorDebounceTimer);
  estimatorDebounceTimer = setTimeout(updateEstimator, 300);
}

// Today + tomorrow slots, minus any whose window has already ended, so the search
// only ever recommends windows that start now or later.
function getEstimatorSlots() {
  return collectEstimatorSlots(state.today, state.tomorrow, Date.now());
}

// Format a window {startIndex, endExclusive, cost} against the slots array.
// slotSpanLabel uses the same colon-form exclusive-end helper as the insight
// cards, so the two spans on this page cannot drift in separator or bound.
function windowLabel(slots, win) {
  return slotSpanLabel(slots, win.startIndex, win.endExclusive);
}

export function updateEstimator() {
  const container = document.getElementById('estimatorResults');
  const power = parseFloat(document.getElementById('inputPower').value);
  const duration = parseFloat(document.getElementById('inputDuration').value);
  const deadlineStr = document.getElementById('inputDeadline').value;

  if (!power || !duration || power <= 0 || duration <= 0) {
    container.innerHTML = '<div class="estimator-no-data">Valitse laite tai syötä teho ja kesto</div>';
    return;
  }

  const slots = getEstimatorSlots();
  if (slots.length === 0) {
    container.innerHTML = '<div class="estimator-no-data">Ei hintatietoja laskentaan</div>';
    return;
  }

  const deadlineMin = parseDeadlineMinutes(deadlineStr);

  const result = findOptimalWindow(slots, duration, power, deadlineMin);
  if (!result) {
    // Deadline rolled to a day we have no slots for (usually tomorrow not yet
    // published) — say so instead of the generic "no windows" miss.
    const msg = isDeadlineDayUnavailable(slots, deadlineMin)
      ? 'Huomisen hintoja ei vielä saatavilla'
      : 'Ei sopivia aikaikkunoita löytynyt';
    container.innerHTML = `<div class="estimator-no-data">${msg}</div>`;
    return;
  }

  // All interpolated values are our own API numbers / formatted times, not input.
  container.innerHTML = `
    <div class="estimator-results">
      <div class="estimator-result-card estimator-result-card--best card">
        <div class="estimator-result-card__label">Halvin aika</div>
        <div class="estimator-result-card__value">${result.best.cost.toFixed(2)} €</div>
        <div class="estimator-result-card__detail">${windowLabel(slots, result.best)}</div>
      </div>
      <div class="estimator-result-card estimator-result-card--worst card">
        <div class="estimator-result-card__label">Kallein aika</div>
        <div class="estimator-result-card__value">${result.worst.cost.toFixed(2)} €</div>
        <div class="estimator-result-card__detail">${windowLabel(slots, result.worst)}</div>
      </div>
      <div class="estimator-result-card estimator-result-card--savings card">
        <div class="estimator-result-card__label">Säästö</div>
        <div class="estimator-result-card__value">${result.savings.toFixed(2)} €</div>
        <div class="estimator-result-card__detail">oikealla ajoituksella</div>
      </div>
    </div>
  `;
}

// Wire device chips and input listeners; called once on init.
export function initEstimator() {
  initDeviceChips();
  document.getElementById('inputPower').addEventListener('input', scheduleEstimatorUpdate);
  document.getElementById('inputDuration').addEventListener('input', scheduleEstimatorUpdate);
  document.getElementById('inputDeadline').addEventListener('input', scheduleEstimatorUpdate);
}
