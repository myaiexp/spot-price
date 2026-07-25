// Tests for the hero card's pure presentation logic
// (../../frontend/js/hero-calc.js): the cheap-rank → band/tint/copy mapping.
//
// This is the layer that turns /now's `cheaperThanPercent` into the headline's
// money cue, and it had no coverage while it read the value with the polarity
// inverted — peak prices tinted green and captioned "cheaper than 96% of today"
// (audit #5549, #5552, #5563). These pin the direction: high = cheap, always.

import { describe, it, expect } from 'vitest';
import { heroBand, heroSignal, HERO_TINTS } from '../../frontend/js/hero-calc.js';

describe('heroBand polarity (high = cheap)', () => {
  it('tints a near-cheapest slot green, never red', () => {
    // 96 % of today costs more than this slot — the best price of the day.
    expect(heroBand(96)).toBe('cheap');
  });

  it('tints a peak slot red, never green', () => {
    // Nothing (or almost nothing) costs more: this IS the expensive end.
    expect(heroBand(0)).toBe('expensive');
    expect(heroBand(4)).toBe('expensive');
  });

  it('keeps the mid range amber', () => {
    expect(heroBand(50)).toBe('mid');
  });

  it('bands at the documented thirds boundaries', () => {
    expect(heroBand(70)).toBe('cheap');
    expect(heroBand(69)).toBe('mid');
    expect(heroBand(30)).toBe('mid');
    expect(heroBand(29)).toBe('expensive');
  });

  it('falls back to the neutral band when the rank is unknown', () => {
    // A cached old bundle against a new backend sends undefined here; an unknown
    // rank must not render as the red "expensive" signal.
    expect(heroBand(undefined)).toBe('mid');
    expect(heroBand(NaN)).toBe('mid');
  });
});

describe('heroSignal', () => {
  it('pairs the cheap band with the green tint and a high cheaper-than caption', () => {
    expect(heroSignal(78)).toEqual({
      band: 'cheap',
      tint: HERO_TINTS.cheap,
      context: 'Halvempi kuin 78% tänään',
    });
  });

  it('pairs the expensive band with the red tint and a low caption', () => {
    expect(heroSignal(8)).toEqual({
      band: 'expensive',
      tint: HERO_TINTS.expensive,
      context: 'Halvempi kuin 8% tänään',
    });
  });

  it('rounds a fractional rank for display', () => {
    expect(heroSignal(66.6).context).toBe('Halvempi kuin 67% tänään');
  });

  it('omits the caption entirely when the rank is unknown', () => {
    // Rather than rendering "Halvempi kuin undefined% tänään".
    expect(heroSignal(undefined)).toEqual({
      band: 'mid',
      tint: HERO_TINTS.mid,
      context: null,
    });
  });
});
