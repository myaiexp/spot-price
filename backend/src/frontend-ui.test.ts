// Tests for exclusive toggle-group wiring (../../frontend/js/ui.js).
// A disabled Huomenna click must not call onSelect or steal .active — the
// check lives in the click handler (not at wire time) because syncTomorrowTab
// can disable the button after listeners are attached (finding #7619).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { wireToggleGroup } from '../../frontend/js/ui.js';

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
