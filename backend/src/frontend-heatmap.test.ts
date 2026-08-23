// Pins heatmap placeholder copy: a failed fetch is not empty-data (finding #7618,
// audit #5561). load.js only asserts that showHeatmapError is called.

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
