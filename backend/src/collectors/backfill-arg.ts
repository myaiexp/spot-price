// Parse the collector --backfill CLI flag.

export type BackfillArg =
  | { kind: 'collect' }
  | { kind: 'backfill'; walkBackFrom?: Date }
  | { kind: 'invalid'; dateStr: string };

// `--backfill` runs a full history backfill; `--backfill=2024-01-01` resumes
// from that exclusive upper bound. Garbage dates are invalid rather than
// silently becoming Epoch (new Date('nope') → Invalid Date, not a throw).
export function parseBackfillArg(argv: string[]): BackfillArg {
  const backfillArg = argv.find((a) => a === '--backfill' || a.startsWith('--backfill='));
  if (!backfillArg) return { kind: 'collect' };

  const eq = backfillArg.indexOf('=');
  if (eq === -1) return { kind: 'backfill' };

  const dateStr = backfillArg.slice(eq + 1);
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return { kind: 'invalid', dateStr };
  return { kind: 'backfill', walkBackFrom: parsed };
}
