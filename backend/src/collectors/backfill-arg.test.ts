// Tests for parseBackfillArg — the collector CLI's --backfill flag. Bare
// `--backfill` walks from Helsinki today; `--backfill=DATE` resumes from that
// exclusive upper bound; garbage dates are invalid rather than becoming Epoch.

import { describe, it, expect } from 'vitest';
import { parseBackfillArg } from './backfill-arg.js';

describe('parseBackfillArg', () => {
  it('returns collect when no --backfill flag is present', () => {
    expect(parseBackfillArg(['node', 'collector.js'])).toEqual({ kind: 'collect' });
  });

  it('returns an unbounded backfill for a bare --backfill', () => {
    expect(parseBackfillArg(['--verbose', '--backfill'])).toEqual({ kind: 'backfill' });
  });

  it('parses --backfill=2024-01-01 as walkBackFrom', () => {
    const result = parseBackfillArg(['--backfill=2024-01-01']);
    expect(result).toEqual({
      kind: 'backfill',
      walkBackFrom: new Date('2024-01-01'),
    });
  });

  it('returns invalid for a non-date --backfill value', () => {
    expect(parseBackfillArg(['--backfill=nope'])).toEqual({
      kind: 'invalid',
      dateStr: 'nope',
    });
  });

  it('returns invalid for an empty --backfill= value', () => {
    expect(parseBackfillArg(['--backfill='])).toEqual({
      kind: 'invalid',
      dateStr: '',
    });
  });
});
