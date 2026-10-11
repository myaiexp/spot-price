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

function timerFns(deps) {
  return {
    clearTimeout: deps?.clearTimeout ?? ((id) => globalThis.clearTimeout(id)),
    setTimeout: deps?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
  };
}

function initDeviceChips(deps) {
  const doc = deps?.document ?? globalThis.document;
  const container = doc.getElementById('deviceChips');
  DEVICES.forEach((device, idx) => {
    const chip = doc.createElement('button');
    chip.className = 'device-chip';
    chip.textContent = `${device.icon} ${device.name}`;
    chip.addEventListener('click', () => {
      if (selectedDeviceIndex === idx) {
        selectedDeviceIndex = -1;
        chip.classList.remove('active');
      } else {
        container.querySelectorAll('.device-chip').forEach((c) => c.classList.remove('active'));
        selectedDeviceIndex = idx;
        chip.classList.add('active');

        // <input>.value is text. Assign the string so this does not depend on
        // the browser coercing a number when the property is set.
        const powerInput = doc.getElementById('inputPower');
        const durationInput = doc.getElementById('inputDuration');
        powerInput.value = device.power !== null ? String(device.power) : '';
        durationInput.value = device.duration !== null ? String(device.duration) : '';
      }
      scheduleEstimatorUpdate(deps);
    });
    container.appendChild(chip);
  });
}

function scheduleEstimatorUpdate(deps) {
  const { clearTimeout: clearTimeoutFn, setTimeout: setTimeoutFn } = timerFns(deps);
  clearTimeoutFn(estimatorDebounceTimer);
  estimatorDebounceTimer = setTimeoutFn(() => updateEstimator(deps), 300);
}

export function updateEstimator(deps) {
  const doc = deps?.document ?? globalThis.document;
  const nowMs = deps?.nowMs ?? Date.now();
  const container = doc.getElementById('estimatorResults');
  const power = parseFloat(doc.getElementById('inputPower').value);
  const duration = parseFloat(doc.getElementById('inputDuration').value);
  const deadlineStr = doc.getElementById('inputDeadline').value;

  if (!power || !duration || power <= 0 || duration <= 0) {
    container.innerHTML = '<div class="estimator-no-data">Valitse laite tai syötä teho ja kesto</div>';
    return;
  }

  const slots = collectEstimatorSlots(state.today, state.tomorrow, nowMs);
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
        <div class="estimator-result-card__detail">${slotSpanLabel(slots, result.best.startIndex, result.best.endExclusive)}</div>
      </div>
      <div class="estimator-result-card estimator-result-card--worst card">
        <div class="estimator-result-card__label">Kallein aika</div>
        <div class="estimator-result-card__value">${result.worst.cost.toFixed(2)} €</div>
        <div class="estimator-result-card__detail">${slotSpanLabel(slots, result.worst.startIndex, result.worst.endExclusive)}</div>
      </div>
      <div class="estimator-result-card estimator-result-card--savings card">
        <div class="estimator-result-card__label">Säästö</div>
        <div class="estimator-result-card__value">${result.savings.toFixed(2)} €</div>
        <div class="estimator-result-card__detail">oikealla ajoituksella</div>
      </div>
    </div>
  `;
}

// Wire device chips and input listeners. Optional deps match the other renderers
// so tests can pass a fake document and fake timers. Called once on page init;
// calling it again starts from a cleared selection and a cleared debounce.
export function initEstimator(deps) {
  const doc = deps?.document ?? globalThis.document;
  const { clearTimeout: clearTimeoutFn } = timerFns(deps);
  clearTimeoutFn(estimatorDebounceTimer);
  estimatorDebounceTimer = null;
  // A fresh chip row has nothing selected. Leftover module state would make
  // the first click on that index toggle off instead of applying the preset.
  selectedDeviceIndex = -1;
  initDeviceChips(deps);
  const schedule = () => scheduleEstimatorUpdate(deps);
  doc.getElementById('inputPower').addEventListener('input', schedule);
  doc.getElementById('inputDuration').addEventListener('input', schedule);
  doc.getElementById('inputDeadline').addEventListener('input', schedule);
}
