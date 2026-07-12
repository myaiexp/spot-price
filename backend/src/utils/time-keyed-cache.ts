// Single-value cache keyed by a caller-supplied time-bucket string (audit #1).

/** Read/write seam over one cached value guarded by key-equality AND TTL. */
export interface TimeKeyedCache<T> {
  /** The cached value when it matches `key` and is still within the TTL, else undefined. */
  get(key: string): T | undefined;
  /** Replace the single held value, stamping it with `key` and the current time. */
  set(key: string, value: T): void;
}

/**
 * Hold one value keyed by the current time-bucket: serve it while the key matches
 * AND now − stored-time < ttlMs, otherwise report a miss so the caller recomputes
 * and `set`s the fresh value. Both invalidation conditions live here, in one
 * place, so a call site can't drift out of sync with the other.
 *
 * Only the latest entry is retained — a `set` with a new key overwrites the old
 * one, so distinct buckets (weeks, 15-min slots) never accumulate. Each call
 * returns an independent closure with its own private entry, so separate app
 * instances — and successive tests — never share cached data.
 */
export function createTimeKeyedCache<T>(ttlMs: number): TimeKeyedCache<T> {
  let entry: { key: string; value: T; timestamp: number } | null = null;

  return {
    get(key: string): T | undefined {
      if (entry && entry.key === key && Date.now() - entry.timestamp < ttlMs) {
        return entry.value;
      }
      return undefined;
    },
    set(key: string, value: T): void {
      entry = { key, value, timestamp: Date.now() };
    },
  };
}
