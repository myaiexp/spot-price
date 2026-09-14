// Drop upstream price slots that fail a runtime guard and log the skip count.

/**
 * Keep the slots `guard` accepts, in order. Dropped slots are counted and warned
 * about (`Skipped N slot(s) with invalid fields from <sourceName>`) so upstream
 * data-quality problems stay visible without one bad slot poisoning the batch
 * upsert. An all-invalid input returns [] — whether that is fatal is the
 * caller's call (sahkotin throws, spot-hinta upserts nothing).
 */
export function filterValidSlots<T>(
  slots: readonly unknown[],
  guard: (slot: unknown) => slot is T,
  sourceName: string,
): T[] {
  const valid = slots.filter(guard);
  const skipped = slots.length - valid.length;
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} slot(s) with invalid fields from ${sourceName}`);
  }
  return valid;
}
