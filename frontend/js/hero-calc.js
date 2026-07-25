// Pure hero presentation logic: cheap-rank band, tint colour, context copy.

// Tint per band. Alpha-light washes over the hero card — green reads "cheap",
// red "expensive".
export const HERO_TINTS = {
  cheap: 'rgba(34, 197, 94, 0.08)',
  mid: 'rgba(232, 163, 8, 0.08)',
  expensive: 'rgba(239, 68, 68, 0.08)',
};

/**
 * Band for /now's `cheaperThanPercent` (share of today's slots that cost MORE,
 * so HIGH = CHEAP): roughly the cheapest third green, dearest third red.
 *
 * The polarity is the whole reason this module exists. The field was once a
 * bottom-up `percentile` (share of slots *cheaper* than now) and the hero read
 * it as if high meant cheap, tinting peak prices green and captioning them
 * "cheaper than 96% of today" (audit #5549/#5563). Keep the comparisons and the
 * Finnish copy pointing the same way: a big number is good news.
 *
 * A non-finite input (missing field — e.g. a cached old bundle against a new
 * backend) falls back to the neutral band rather than the red "expensive" one,
 * so an unknown rank never masquerades as a price signal.
 */
export function heroBand(cheaperThanPercent) {
  if (!Number.isFinite(cheaperThanPercent)) return 'mid';
  if (cheaperThanPercent >= 70) return 'cheap';
  if (cheaperThanPercent >= 30) return 'mid';
  return 'expensive';
}

/**
 * Hero signal for a cheap-rank: `{ band, tint, context }`, where `context` is
 * the Finnish caption or null when the rank is unknown (the caller then omits
 * the line instead of printing "Halvempi kuin undefined%").
 */
export function heroSignal(cheaperThanPercent) {
  const band = heroBand(cheaperThanPercent);
  const known = Number.isFinite(cheaperThanPercent);
  return {
    band,
    tint: HERO_TINTS[band],
    context: known ? `Halvempi kuin ${Math.round(cheaperThanPercent)}% tänään` : null,
  };
}
