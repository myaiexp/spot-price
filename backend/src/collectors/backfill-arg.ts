// Parse the collector --backfill CLI flag.

import { getHelsinkiDateRange, isValidCalendarDate } from '../utils/helsinki-time.js';

export type BackfillArg =
  | { kind: 'collect' }
  | { kind: 'backfill'; walkBackFrom?: Date }
  | { kind: 'invalid'; dateStr: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// `--backfill` runs a full history backfill; `--backfill=2024-01-01` resumes
// from Helsinki midnight of that day (exclusive upper bound). A date-only
// string must not go through `new Date('YYYY-MM-DD')` — that is UTC midnight,
// 02:00/03:00 Helsinki, and would walk into the named day's first hours
// (finding #7100). Full ISO instants are kept as-is. Garbage dates are invalid
// rather than silently becoming Epoch (new Date('nope') → Invalid Date).
export function parseBackfillArg(argv: string[]): BackfillArg {
  const backfillArg = argv.find((a) => a === '--backfill' || a.startsWith('--backfill='));
  if (!backfillArg) return { kind: 'collect' };

  const eq = backfillArg.indexOf('=');
  if (eq === -1) return { kind: 'backfill' };

  const dateStr = backfillArg.slice(eq + 1);
  if (DATE_ONLY.test(dateStr)) {
    if (!isValidCalendarDate(dateStr)) return { kind: 'invalid', dateStr };
    return { kind: 'backfill', walkBackFrom: getHelsinkiDateRange(dateStr).start };
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return { kind: 'invalid', dateStr };
  return { kind: 'backfill', walkBackFrom: parsed };
}
