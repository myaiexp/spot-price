// Tests for the heatmap colour scale (../../frontend/js/heatmap-calc.js):
// flat range, both interpolation halves, and out-of-range clamping.

import { describe, it, expect } from 'vitest';
import { priceToColor } from '../../frontend/js/heatmap-calc.js';

describe('priceToColor', () => {
  it('returns the amber midpoint when min equals max (no range to scale)', () => {
    expect(priceToColor(5, 5, 5)).toBe('#e8a308');
    expect(priceToColor(0, 0, 0)).toBe('#e8a308');
  });

  it('maps the cheap end to green', () => {
    expect(priceToColor(0, 0, 10)).toBe('hsl(142, 72%, 50%)');
  });

  it('maps the midpoint to amber', () => {
    expect(priceToColor(5, 0, 10)).toBe('hsl(39, 85%, 52%)');
  });

  it('maps the expensive end to red', () => {
    expect(priceToColor(10, 0, 10)).toBe('hsl(0, 72%, 50%)');
  });

  it('clamps values below min to the green end', () => {
    expect(priceToColor(-50, 0, 10)).toBe('hsl(142, 72%, 50%)');
  });

  it('clamps values above max to the red end', () => {
    expect(priceToColor(50, 0, 10)).toBe('hsl(0, 72%, 50%)');
  });

  it('colours a zero cell when the week range includes negatives (finding #7617)', () => {
    // 0 is the midpoint of [-10, 10] — a real price, not a missing-data grey.
    expect(priceToColor(0, -10, 10)).toBe('hsl(39, 85%, 52%)');
    expect(priceToColor(-10, -10, 10)).toBe('hsl(142, 72%, 50%)');
  });
});
