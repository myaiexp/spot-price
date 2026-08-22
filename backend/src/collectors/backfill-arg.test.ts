// Tests for parseBackfillArg — the collector CLI's --backfill flag. Bare
// `--backfill` walks from Helsinki today; `--backfill=DATE` resumes from that
// exclusive upper bound; garbage dates are invalid rather than becoming Epoch.

import { describe, it, expect } from 'vitest';
import { parseBackfillArg } from './backfill-arg.js';
import { getHelsinkiDateRange } from '../utils/helsinki-time.js';

describe('parseBackfillArg', () => {
  it('returns collect when no --backfill flag is present', () => {
    expect(parseBackfillArg(['node', 'collector.js'])).toEqual({ kind: 'collect' });
  });

  it('returns an unbounded backfill for a bare --backfill', () => {
    expect(parseBackfillArg(['--verbose', '--backfill'])).toEqual({ kind: 'backfill' });
  });

  it('resolves a date-only --backfill=YYYY-MM-DD to Helsinki midnight (finding #7100)', () => {
    // Winter: EET +02, so 2024-01-01 00:00 Helsinki is 2023-12-31T22:00:00Z.
    // `new Date('2024-01-01')` is UTC midnight — 2h into the named Helsinki day.
    const winter = parseBackfillArg(['--backfill=2024-01-01']);
    expect(winter).toEqual({
      kind: 'backfill',
      walkBackFrom: getHelsinkiDateRange('2024-01-01').start,
    });
    expect(winter.kind === 'backfill' && winter.walkBackFrom?.toISOString()).toBe(
      '2023-12-31T22:00:00.000Z',
    );

    // Summer: EEST +03, so 2026-08-20 00:00 Helsinki is 2026-08-19T21:00:00Z.
    const summer = parseBackfillArg(['--backfill=2026-08-20']);
    expect(summer).toEqual({
      kind: 'backfill',
      walkBackFrom: getHelsinkiDateRange('2026-08-20').start,
    });
    expect(summer.kind === 'backfill' && summer.walkBackFrom?.toISOString()).toBe(
      '2026-08-19T21:00:00.000Z',
    );
  });

  it('keeps a full ISO-instant --backfill argument as-is', () => {
    const result = parseBackfillArg(['--backfill=2026-08-20T12:34:56.000Z']);
    expect(result).toEqual({
      kind: 'backfill',
      walkBackFrom: new Date('2026-08-20T12:34:56.000Z'),
    });
  });

  it('returns invalid for an impossible calendar date', () => {
    expect(parseBackfillArg(['--backfill=2026-02-30'])).toEqual({
      kind: 'invalid',
      dateStr: '2026-02-30',
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
