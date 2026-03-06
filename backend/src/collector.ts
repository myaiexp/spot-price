import type { Db } from './db/connection.js';

// Stub — implemented in Task 3
export async function collectPrices(_db: Db): Promise<{ inserted: number; updated: number }> {
  return { inserted: 0, updated: 0 };
}
