// Tests for exclusive toggle groups (../../../frontend/js/ui.js).
// A disabled Huomenna click must not call onSelect or steal .active — the
// check lives in the click handler (not at wire time) because
// renderTomorrowTab can disable the button after listeners are attached
// (finding #7619). setActive is the shared .active rewrite (finding #9607).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { setActive, wireToggleGroup } from '../../../frontend/js/ui.js';
import { fakeButton } from '../test-support/fake-dom.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubButtons(buttons: ReturnType<typeof fakeButton>[]) {
  vi.stubGlobal('document', {
    querySelectorAll: () => buttons,
  });
  return buttons;
}

describe('setActive', () => {
  it('sets .active on exactly the buttons the predicate accepts', () => {
    const a = fakeButton({ active: true });
    const b = fakeButton();
    const c = fakeButton({ active: true });
    setActive([a, b, c], (btn) => btn === b);
    expect(a.classList.contains('active')).toBe(false);
    expect(b.classList.contains('active')).toBe(true);
    expect(c.classList.contains('active')).toBe(false);
  });

  it('coerces a falsy non-boolean predicate result to "clear", not "flip"', () => {
    // classList.toggle(c, undefined) flips; a predicate returning undefined
    // must still clear .active.
    const a = fakeButton({ active: true });
    const b = fakeButton();
    setActive([a, b], () => undefined as unknown as boolean);
    expect(a.classList.contains('active')).toBe(false);
    expect(b.classList.contains('active')).toBe(false);
  });
});

describe('wireToggleGroup', () => {
  it('moves .active and calls onSelect on an enabled click', () => {
    const today = fakeButton({ active: true });
    const tomorrow = fakeButton();
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
    const today = fakeButton({ active: true });
    const tomorrow = fakeButton({ disabled: true });
    stubButtons([today, tomorrow]);
    const onSelect = vi.fn();
    wireToggleGroup('.tab-btn', onSelect);

    tomorrow.click();

    expect(onSelect).not.toHaveBeenCalled();
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });

  it('honours disabled set after wiring (Huomenna can flip at midnight)', () => {
    const today = fakeButton({ active: true });
    const tomorrow = fakeButton();
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
