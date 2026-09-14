// Pins heatmap placeholder copy: a failed fetch is not empty-data (finding #7618,
// audit #5561). load.js only asserts that showHeatmapError is called. Also pins
// the success path: week caption, Monday-first labels, cell tooltips (#9931).

import { describe, it, expect, afterEach } from 'vitest';
import { renderHeatmap, showHeatmapError } from '../../frontend/js/heatmap.js';
import { state } from '../../frontend/js/state.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';

function resetState() {
  state.heatmap = null;
}

afterEach(resetState);

function heatmapDoc() {
  const els = {
    heatmapGrid: fakeEl(),
    heatmapPlaceholder: fakeEl(),
    heatmapTooltip: fakeEl(),
    heatmapWeekRange: fakeEl(),
  };
  return { doc: fakeDocument(els), els };
}

describe('heatmap placeholder copy (finding #7618, audit #5561)', () => {
  it('paints a fetch failure as an error, not as empty-data', () => {
    const { doc, els } = heatmapDoc();

    showHeatmapError({ document: doc });

    expect(els.heatmapPlaceholder.textContent).toBe('Lämpökartan lataus epäonnistui');
    expect(els.heatmapPlaceholder.style.display).toBe('block');
    expect(els.heatmapGrid.style.display).toBe('none');
    expect(els.heatmapPlaceholder.textContent).not.toBe('Ei riittävästi tietoja');
  });

  it('paints a missing heatmap as empty-data, not as a fetch failure', () => {
    state.heatmap = null;
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    expect(els.heatmapPlaceholder.textContent).toBe('Ei riittävästi tietoja');
    expect(els.heatmapPlaceholder.style.display).toBe('block');
    expect(els.heatmapGrid.style.display).toBe('none');
    expect(els.heatmapPlaceholder.textContent).not.toBe(
      'Lämpökartan lataus epäonnistui',
    );
  });

  it('paints an empty matrix the same as missing data, not as a fetch failure', () => {
    state.heatmap = { matrix: [], minPrice: 0, maxPrice: 0, weekNumber: 24 };
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    expect(els.heatmapPlaceholder.textContent).toBe('Ei riittävästi tietoja');
    expect(els.heatmapPlaceholder.textContent).not.toBe(
      'Lämpökartan lataus epäonnistui',
    );
  });

  it('colours a 0 and a negative cell instead of greying them as missing (finding #7617)', () => {
    const hours = Array.from({ length: 24 }, (_, h) => {
      if (h === 0) return 0;
      if (h === 1) return -5;
      return null;
    });
    state.heatmap = { matrix: [{ day: 0, hours }], minPrice: -5, maxPrice: 0, weekNumber: 24 };
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    const cells = els.heatmapGrid.children.filter((c) => c.className === 'heatmap-cell');
    expect(cells).toHaveLength(24);
    expect(cells[0].style.background).not.toBe('var(--border)');
    expect(cells[1].style.background).not.toBe('var(--border)');
    expect(cells[2].style.background).toBe('var(--border)');
    expect(cells[2].style.opacity).toBe('0.3');
  });
});

// The backend maps ISODOW 1 (Monday) → day 0 (heatmap-window.test.ts); this is
// the frontend half of that contract — DAY_LABELS is a separate array.
describe('heatmap success path (finding #9931)', () => {
  const byClass = (els: ReturnType<typeof heatmapDoc>['els'], cls: string) =>
    els.heatmapGrid.children.filter((c) => c.className === cls);
  const flatHours = (price: number) => Array.from({ length: 24 }, () => price);

  it('captions the week number and labels a full week Monday-first', () => {
    const matrix = Array.from({ length: 7 }, (_, day) => ({ day, hours: flatHours(day + 1) }));
    state.heatmap = { matrix, minPrice: 1, maxPrice: 7, weekNumber: 24 };
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    expect(els.heatmapWeekRange.textContent).toBe('vko 24');
    expect(byClass(els, 'heatmap-row-label').map((c) => c.textContent)).toEqual([
      'Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su',
    ]);
    expect(byClass(els, 'heatmap-header').map((c) => String(c.textContent))).toEqual(
      Array.from({ length: 24 }, (_, h) => String(h)),
    );
    expect(byClass(els, 'heatmap-cell')).toHaveLength(7 * 24);
  });

  it('labels a row from row.day, not its position in the matrix', () => {
    state.heatmap = {
      matrix: [{ day: 0, hours: flatHours(1) }, { day: 6, hours: flatHours(2) }],
      minPrice: 1,
      maxPrice: 2,
      weekNumber: 24,
    };
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    // Grid order: corner, 24 hour headers, then per row its label + 24 cells.
    const children = els.heatmapGrid.children;
    expect(children[0].className).toBe('heatmap-corner');
    expect(children[25].textContent).toBe('Ma');
    expect(children[50].textContent).toBe('Su');
    expect(children.slice(51, 75).every((c) => c.className === 'heatmap-cell')).toBe(true);
  });

  it('tooltips a cell with its own day, hour and price, following the pointer', () => {
    const suHours = flatHours(1);
    suHours[5] = 3.2;
    state.heatmap = {
      matrix: [{ day: 0, hours: flatHours(1) }, { day: 6, hours: suHours }],
      minPrice: 1,
      maxPrice: 3.2,
      weekNumber: 24,
    };
    const { doc, els } = heatmapDoc();
    const tooltip = els.heatmapTooltip;

    renderHeatmap({ document: doc });
    const suFive = byClass(els, 'heatmap-cell')[24 + 5];

    suFive.dispatch('mouseenter', { clientX: 100, clientY: 200 });
    expect(tooltip.textContent).toBe('Su 05:00 — 3.20 c/kWh');
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.style.left).toBe('112px');
    expect(tooltip.style.top).toBe('168px');

    suFive.dispatch('mousemove', { clientX: 150, clientY: 250 });
    expect(tooltip.style.left).toBe('162px');
    expect(tooltip.style.top).toBe('218px');

    suFive.dispatch('mouseleave');
    expect(tooltip.style.display).toBe('none');
  });

  it('gives a greyed missing cell no tooltip', () => {
    const hours = flatHours(1);
    hours[3] = null as unknown as number;
    state.heatmap = { matrix: [{ day: 0, hours }], minPrice: 1, maxPrice: 1, weekNumber: 24 };
    const { doc, els } = heatmapDoc();

    renderHeatmap({ document: doc });

    const cells = byClass(els, 'heatmap-cell');
    expect(cells[3].listeners).toEqual({});
    expect(Object.keys(cells[4].listeners).sort()).toEqual(['mouseenter', 'mouseleave', 'mousemove']);
  });
});
