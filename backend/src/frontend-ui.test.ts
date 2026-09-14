// Tests for exclusive toggle groups (../../frontend/js/ui.js).
// A disabled Huomenna click must not call onSelect or steal .active — the
// check lives in the click handler (not at wire time) because
// renderTomorrowTab can disable the button after listeners are attached
// (finding #7619). setActive is the shared .active rewrite (finding #9607).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { setActive, wireToggleGroup } from '../../frontend/js/ui.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function classSet(initial: string[] = []) {
  const classes = new Set(initial);
  return {
    add: (c: string) => {
      classes.add(c);
    },
    remove: (c: string) => {
      classes.delete(c);
    },
    contains: (c: string) => classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) force = !classes.has(c);
      if (force) classes.add(c);
      else classes.delete(c);
    },
  };
}

function button({ disabled = false, active = false } = {}) {
  const classList = classSet(active ? ['active'] : []);
  const listeners: Array<() => void> = [];
  return {
    disabled,
    classList,
    addEventListener: (_ev: string, fn: () => void) => {
      listeners.push(fn);
    },
    click() {
      for (const fn of listeners) fn();
    },
  };
}

function stubButtons(buttons: ReturnType<typeof button>[]) {
  vi.stubGlobal('document', {
    querySelectorAll: () => buttons,
  });
  return buttons;
}

describe('setActive', () => {
  it('sets .active on exactly the buttons the predicate accepts', () => {
    const a = button({ active: true });
    const b = button();
    const c = button({ active: true });
    setActive([a, b, c], (btn) => btn === b);
    expect(a.classList.contains('active')).toBe(false);
    expect(b.classList.contains('active')).toBe(true);
    expect(c.classList.contains('active')).toBe(false);
  });

  it('coerces a falsy non-boolean predicate result to "clear", not "flip"', () => {
    // classList.toggle(c, undefined) flips; a predicate returning undefined
    // must still clear .active.
    const a = button({ active: true });
    const b = button();
    setActive([a, b], () => undefined as unknown as boolean);
    expect(a.classList.contains('active')).toBe(false);
    expect(b.classList.contains('active')).toBe(false);
  });
});

describe('wireToggleGroup', () => {
  it('moves .active and calls onSelect on an enabled click', () => {
    const today = button({ active: true });
    const tomorrow = button();
    stubButtons([today, tomorrow]);
    const onSelect = vi.fn();
    wireToggleGroup('.tab-btn', onSelect);

    tomorrow.click();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(tomorrow);
    expect(today.classList.contains('active')).toBe(false);
    expect(tomorrow.classList.contains('active')).toBe(true);
  });

  it('does not call onSelect or move .active when the button is disabled', () => {
    const today = button({ active: true });
    const tomorrow = button({ disabled: true });
    stubButtons([today, tomorrow]);
    const onSelect = vi.fn();
    wireToggleGroup('.tab-btn', onSelect);

    tomorrow.click();

    expect(onSelect).not.toHaveBeenCalled();
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });

  it('honours disabled set after wiring (Huomenna can flip at midnight)', () => {
    const today = button({ active: true });
    const tomorrow = button();
    stubButtons([today, tomorrow]);
    const onSelect = vi.fn();
    wireToggleGroup('.tab-btn', onSelect);

    tomorrow.disabled = true;
    tomorrow.click();

    expect(onSelect).not.toHaveBeenCalled();
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });
});
