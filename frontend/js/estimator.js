// Cost estimator ("Ajoitusavustin"): device chips + power/duration/deadline
// inputs → cheapest / most expensive charging window and the saving between them.
import { state } from './state.js';
import { futureSlots, findOptimalWindow } from './estimator-calc.js';
import { formatTime } from './format.js';
import { slotBoundaryMs } from './slot-time.js';

const DEVICES = [
  { name: 'Kiuas', icon: '🔥', power: 6, duration: 2 },
  { name: 'Sähköauto', icon: '🚗', power: 11, duration: 4 },
  { name: 'Pyykinpesukone', icon: '👕', power: 2, duration: 2 },
  { name: 'Astianpesukone', icon: '🍽', power: 1.8, duration: 1.5 },
  { name: 'Kuivausrumpu', icon: '💨', power: 2.5, duration: 1.5 },
  { name: 'Muu', icon: '⚙', power: null, duration: null },
];

let selectedDevice = -1;
let estimatorDebounceTimer = null;

function initDeviceChips() {
  const container = document.getElementById('deviceChips');
  DEVICES.forEach((device, idx) => {
    const chip = document.createElement('button');
    chip.className = 'device-chip';
    chip.textContent = `${device.icon} ${device.name}`;
    chip.addEventListener('click', () => {
      // Toggle selection
      if (selectedDevice === idx) {
        selectedDevice = -1;
        chip.classList.remove('active');
      } else {
        container.querySelectorAll('.device-chip').forEach((c) => c.classList.remove('active'));
        selectedDevice = idx;
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
  let slots = [];
  if (state.today && state.today.slots) slots = slots.concat(state.today.slots);
  if (state.tomorrow && state.tomorrow.slots && state.tomorrow.slots.length > 0) {
    slots = slots.concat(state.tomorrow.slots);
  }
  return futureSlots(slots, Date.now());
}

// Format a window {startIndex, endIndex, cost} against the slots array. endIndex
// is the exclusive window-end slot index; slotBoundaryMs resolves it unclamped so
// a window abutting the data end shows its true end time (not 15 min early).
function windowLabel(slots, win) {
  return `${formatTime(slots[win.startIndex].datetime)}–${formatTime(slotBoundaryMs(slots, win.endIndex))}`;
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

  let deadlineHour = null;
  if (deadlineStr) {
    const parts = deadlineStr.split(':');
    deadlineHour = parseInt(parts[0]) + parseInt(parts[1] || 0) / 60;
  }

  const result = findOptimalWindow(slots, duration, power, deadlineHour);
  if (!result) {
    container.innerHTML = '<div class="estimator-no-data">Ei sopivia aikaikkunoita löytynyt</div>';
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
