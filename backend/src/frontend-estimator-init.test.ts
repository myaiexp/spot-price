// Pins estimator device-chip presets and the 300ms input debounce.
// Clicking a chip is the main way into the estimator. These drive initEstimator
// through a fake document (finding #12152): Sähköauto fills power/duration and
// .active, a second click clears .active, Muu empties both inputs, and an input
// event schedules exactly one updateEstimator after 300 ms.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { initEstimator } from '../../frontend/js/estimator.js';
import { fakeDocument, fakeEl, type FakeEl } from './test-support/fake-dom.js';

type ClassList = {
  add: (token: string) => void;
  remove: (token: string) => void;
  contains: (token: string) => boolean;
};

type ChipEl = FakeEl & { classList: ClassList };

// classList on top of fakeEl's className. The chip handler toggles .active;
// fakeEl records listeners but has no classList of its own.
function classListFor(el: FakeEl): ClassList {
  const tokens = () => new Set(el.className.split(/\s+/).filter(Boolean));
  const write = (set: Set<string>) => {
    el.className = [...set].join(' ');
  };
  return {
    add(token) {
      const set = tokens();
      set.add(token);
      write(set);
    },
    remove(token) {
      const set = tokens();
      set.delete(token);
      write(set);
    },
    contains(token) {
      return tokens().has(token);
    },
  };
}

function chipByName(container: FakeEl, name: string): ChipEl {
  const chip = container.children.find((child) => child.textContent.includes(name));
  if (!chip) throw new Error(`missing device chip ${name}`);
  return chip as ChipEl;
}

function estimatorInitDoc() {
  const deviceChips = fakeEl() as FakeEl & {
    querySelectorAll: (selector: string) => ChipEl[];
  };
  deviceChips.querySelectorAll = (selector: string) => {
    const want = selector.startsWith('.') ? selector.slice(1) : selector;
    return deviceChips.children.filter((child) =>
      child.className.split(/\s+/).includes(want),
    ) as ChipEl[];
  };
  const inputPower = fakeEl();
  const inputDuration = fakeEl();
  const inputDeadline = fakeEl();
  const estimatorResults = fakeEl();
  const elements: Record<string, FakeEl> = {
    deviceChips,
    inputPower,
    inputDuration,
    inputDeadline,
    estimatorResults,
  };
  const base = fakeDocument(elements);
  return {
    doc: {
      getElementById: (id: string) => base.getElementById(id),
      createElement: (tag: string) => {
        const el = base.createElement(tag) as ChipEl;
        el.classList = classListFor(el);
        return el;
      },
    },
    deviceChips,
    inputPower,
    inputDuration,
    inputDeadline,
    estimatorResults,
  };
}

type TimerDeps = {
  setTimeout: (fn: () => void, ms?: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout> | null) => void;
  schedules: () => number;
};

// Fake timers plus a setTimeout wrapper, so a test can tell the injected timer
// was the one that fired (a fallback to the global would leave schedules at 0).
function timerDeps(): TimerDeps {
  vi.useFakeTimers();
  let schedules = 0;
  return {
    setTimeout: (fn, ms) => {
      schedules += 1;
      return setTimeout(fn, ms);
    },
    clearTimeout: (id) => {
      clearTimeout(id ?? undefined);
    },
    schedules: () => schedules,
  };
}

function startEstimator() {
  const ui = estimatorInitDoc();
  const timers = timerDeps();
  initEstimator({
    document: ui.doc,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  return { ...ui, schedules: timers.schedules };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('initEstimator device chips (finding #12152)', () => {
  it('fills 11 kW and 4 h from Sähköauto and marks that chip active', () => {
    const { deviceChips, inputPower, inputDuration } = startEstimator();
    const chip = chipByName(deviceChips, 'Sähköauto');

    chip.dispatch('click');

    expect(inputPower.value).toBe('11');
    expect(inputDuration.value).toBe('4');
    expect(chip.classList.contains('active')).toBe(true);
  });

  it('clears .active when the selected Sähköauto chip is clicked again', () => {
    const { deviceChips } = startEstimator();
    const chip = chipByName(deviceChips, 'Sähköauto');

    chip.dispatch('click');
    chip.dispatch('click');

    expect(chip.classList.contains('active')).toBe(false);
  });

  it('empties power and duration when Muu is selected after another preset', () => {
    const { deviceChips, inputPower, inputDuration } = startEstimator();
    chipByName(deviceChips, 'Sähköauto').dispatch('click');
    const muu = chipByName(deviceChips, 'Muu');

    muu.dispatch('click');

    expect(inputPower.value).toBe('');
    expect(inputDuration.value).toBe('');
    expect(muu.classList.contains('active')).toBe(true);
    expect(chipByName(deviceChips, 'Sähköauto').classList.contains('active')).toBe(false);
  });
});

describe('initEstimator input debounce (finding #12152)', () => {
  it('debounces through the global timers when none are injected', () => {
    // Page init calls initEstimator() with no deps. The injected-timer cases
    // above never take the global setTimeout/clearTimeout fallbacks.
    vi.useFakeTimers();
    const ui = estimatorInitDoc();
    initEstimator({ document: ui.doc });
    let writes = 0;
    let html = '';
    Object.defineProperty(ui.estimatorResults, 'innerHTML', {
      configurable: true,
      get: () => html,
      set: (value: string) => {
        writes += 1;
        html = value;
      },
    });

    ui.inputPower.dispatch('input');
    ui.inputPower.dispatch('input');

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(299);
    expect(writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(writes).toBe(1);
    expect(html).toContain('Valitse laite tai syötä teho ja kesto');
  });

  it.each(['inputPower', 'inputDuration', 'inputDeadline'] as const)(
    'schedules exactly one updateEstimator 300 ms after %s',
    (inputId) => {
      const ui = startEstimator();
      let writes = 0;
      let html = '';
      Object.defineProperty(ui.estimatorResults, 'innerHTML', {
        configurable: true,
        get: () => html,
        set: (value: string) => {
          writes += 1;
          html = value;
        },
      });

      ui[inputId].dispatch('input');
      ui[inputId].dispatch('input');

      // Two events, one pending timer: the second cleared the first.
      expect(ui.schedules()).toBe(2);
      expect(vi.getTimerCount()).toBe(1);
      expect(writes).toBe(0);

      vi.advanceTimersByTime(299);
      expect(writes).toBe(0);

      vi.advanceTimersByTime(1);
      expect(writes).toBe(1);
      expect(html).toContain('Valitse laite tai syötä teho ja kesto');

      vi.advanceTimersByTime(300);
      expect(writes).toBe(1);
    },
  );
});
