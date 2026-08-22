// Heatmap price-to-color scale (green → amber → red).

export function priceToColor(value, min, max) {
  if (max === min) return '#e8a308';
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // HSL interpolation: green (142°) → amber (39°) → red (0°)
  let h, s, l;
  if (ratio <= 0.5) {
    const t = ratio / 0.5;
    h = 142 - (142 - 39) * t;
    s = 72 + (85 - 72) * t;
    l = 50 + (52 - 50) * t;
  } else {
    const t = (ratio - 0.5) / 0.5;
    h = 39 - (39 - 0) * t;
    s = 85 + (72 - 85) * t;
    l = 52 + (50 - 52) * t;
  }
  return `hsl(${h}, ${s}%, ${l}%)`;
}
