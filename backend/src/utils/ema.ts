// Exponential moving average over a numeric series

/**
 * Compute exponential moving average over an array of values (oldest first).
 * EMA_0 = values[0], EMA_i = alpha * values[i] + (1 - alpha) * EMA_{i-1}
 */
export function computeEma(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}
