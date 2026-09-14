// Tests for the tomorrow-tab renderer (../../frontend/js/tabs.js): Huomenna
// disabled with its Finnish title when tomorrow is unpublished, the midnight
// fallback to Tänään moving .active, and re-enabling once prices land
// (finding #9607 moved this out of main.js; behaviour from finding #7099).

import { describe, it, expect, afterEach } from 'vitest';
import { state } from '../../frontend/js/state.js';
import { renderTomorrowTab } from '../../frontend/js/tabs.js';
import { slot } from './test-support/rows.js';

afterEach(() => {
  state.tomorrow = null;
  state.activeTab = 'today';
});

function tabButton(tab: string, active: boolean) {
  const classes = new Set(active ? ['active'] : []);
  return {
    disabled: false,
    title: '',
    dataset: { tab },
    classList: {
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => {
        if (force) classes.add(c);
        else classes.delete(c);
      },
    },
  };
}

// Document seam passed as deps.document — no global stub needed.
function tabsDoc(active: 'today' | 'tomorrow') {
  const today = tabButton('today', active === 'today');
  const tomorrow = tabButton('tomorrow', active === 'tomorrow');
  const doc = {
    getElementById: (id: string) => (id === 'tabTomorrow' ? tomorrow : null),
    querySelectorAll: (sel: string) => (sel === '.tab-btn' ? [today, tomorrow] : []),
  };
  return { doc, today, tomorrow };
}

const PUBLISHED = { slots: [slot('2026-07-18T21:00:00.000Z', 1)] };

describe('renderTomorrowTab', () => {
  it('disables Huomenna and falls back to Tänään at midnight', () => {
    const { doc, today, tomorrow } = tabsDoc('tomorrow');
    state.activeTab = 'tomorrow';
    state.tomorrow = null;

    renderTomorrowTab({ document: doc });

    expect(state.activeTab).toBe('today');
    expect(tomorrow.disabled).toBe(true);
    expect(tomorrow.title).toBe('Huomisen hintoja ei vielä saatavilla');
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });

  it('disables Huomenna without touching .active when Tänään is already shown', () => {
    const { doc, today, tomorrow } = tabsDoc('today');
    state.activeTab = 'today';
    state.tomorrow = { slots: [] };

    renderTomorrowTab({ document: doc });

    expect(state.activeTab).toBe('today');
    expect(tomorrow.disabled).toBe(true);
    expect(today.classList.contains('active')).toBe(true);
    expect(tomorrow.classList.contains('active')).toBe(false);
  });

  it('re-enables Huomenna and keeps the active tab once tomorrow is published', () => {
    const { doc, today, tomorrow } = tabsDoc('tomorrow');
    tomorrow.disabled = true;
    tomorrow.title = 'Huomisen hintoja ei vielä saatavilla';
    state.activeTab = 'tomorrow';
    state.tomorrow = PUBLISHED;

    renderTomorrowTab({ document: doc });

    expect(state.activeTab).toBe('tomorrow');
    expect(tomorrow.disabled).toBe(false);
    expect(tomorrow.title).toBe('');
    expect(tomorrow.classList.contains('active')).toBe(true);
    expect(today.classList.contains('active')).toBe(false);
  });
});
