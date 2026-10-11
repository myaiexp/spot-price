// Pins DOMTokenList.toggle on the shared classList double (finding #11912).
// An omitted force flips. A boolean force adds or removes. The old per-file
// doubles treated a missing force as remove, so they disagreed with the browser
// and with each other.
import { describe, it, expect } from 'vitest';
import { fakeButton, fakeClassList, fakeEl } from './fake-dom.js';

describe('fakeClassList.toggle', () => {
  it('flips when force is omitted and returns whether the token is now present', () => {
    const list = fakeClassList(['active']);
    expect(list.toggle('active')).toBe(false);
    expect(list.contains('active')).toBe(false);
    expect(list.toggle('active')).toBe(true);
    expect(list.contains('active')).toBe(true);
  });

  it('flips when force is undefined, because an optional boolean is then omitted', () => {
    const list = fakeClassList(['active']);
    expect(list.toggle('active', undefined)).toBe(false);
    expect(list.contains('active')).toBe(false);
    expect(list.toggle('other', undefined)).toBe(true);
    expect(list.contains('other')).toBe(true);
  });

  it('adds when force is true and removes when force is false, including repeats', () => {
    const list = fakeClassList();
    expect(list.toggle('active', true)).toBe(true);
    expect(list.toggle('active', true)).toBe(true);
    expect(list.contains('active')).toBe(true);
    expect(list.toggle('active', false)).toBe(false);
    expect(list.toggle('active', false)).toBe(false);
    expect(list.contains('active')).toBe(false);
  });
});

describe('fakeEl className', () => {
  it('stays the same string as classList add, remove, and a full className write', () => {
    const el = fakeEl();
    el.className = 'device-chip';
    el.classList.add('active');
    expect(el.className).toBe('device-chip active');
    expect(el.classList.contains('device-chip')).toBe(true);
    el.classList.remove('active');
    expect(el.className).toBe('device-chip');
    expect(el.classList.contains('active')).toBe(false);
    el.className = 'heatmap-cell';
    expect(el.className).toBe('heatmap-cell');
    expect(el.classList.contains('device-chip')).toBe(false);
  });
});

describe('fakeButton', () => {
  it('starts from active, flips on a one-argument toggle, and click runs the listener', () => {
    const button = fakeButton({
      active: true,
      dataset: { tab: 'today' },
      id: 'tabTomorrow',
    });
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('active')).toBe(true);
    expect(button.classList.toggle('active')).toBe(false);
    expect(button.classList.contains('active')).toBe(false);
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    button.click();
    expect(clicks).toBe(1);
    expect(button.dataset.tab).toBe('today');
    expect(button.id).toBe('tabTomorrow');
    expect(button.title).toBe('');
  });

  it('removes .active when toggle is forced false, which is what setActive passes', () => {
    const button = fakeButton({ active: true, disabled: true });
    expect(button.disabled).toBe(true);
    expect(button.classList.toggle('active', false)).toBe(false);
    expect(button.classList.contains('active')).toBe(false);
  });
});
