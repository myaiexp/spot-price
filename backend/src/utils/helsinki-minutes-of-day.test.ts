// Direct unit tests for helsinkiMinutesOfDay, focused on the midnight edge
// (audit #3964). The helper reads an instant's hour/minute parts in
// Europe/Helsinki and normalises a "24" hour to 0 via `% 24`, because some ICU
// builds render midnight as hour "24" under hour12:false. On the build these
// tests run against (node 22, observed) ICU renders midnight as "00", so the
// `% 24` branch is a defensive no-op here — but the observable contract is the
// same either way: a Helsinki-midnight instant maps to 0. These tests pin that
// contract at both DST offsets, plus a couple of non-edge points so a future
// change that breaks the normalisation (e.g. midnight surfacing as 1440) fails.
//
// helsinkiMinutesOfDay takes the instant as an argument, so each test passes a
// fixed UTC instant rather than the real wall clock — deterministic and DST-immune
// by construction, no clock fake needed.
import { describe, it, expect } from 'vitest';
import { helsinkiMinutesOfDay } from './helsinki-time.js';

describe('helsinkiMinutesOfDay — midnight edge (audit #3964)', () => {
  it('maps winter midnight (EET +2) to 0', () => {
    // 2026-01-15T22:00Z = 2026-01-16T00:00 Helsinki.
    expect(helsinkiMinutesOfDay(new Date('2026-01-15T22:00:00Z'))).toBe(0);
  });

  it('maps summer midnight (EEST +3) to 0', () => {
    // 2026-06-14T21:00Z = 2026-06-15T00:00 Helsinki.
    expect(helsinkiMinutesOfDay(new Date('2026-06-14T21:00:00Z'))).toBe(0);
  });

  it('maps the first slot after midnight (00:15) to 15, not 1455', () => {
    // 2026-01-15T22:15Z = 2026-01-16T00:15 Helsinki. Without the `% 24`
    // normalisation a "24:15" misread would yield 24*60+15 = 1455.
    expect(helsinkiMinutesOfDay(new Date('2026-01-15T22:15:00Z'))).toBe(15);
  });
});

describe('helsinkiMinutesOfDay — non-edge instants (audit #3964)', () => {
  it('maps Helsinki noon to 720', () => {
    // 2026-01-15T10:00Z = 12:00 Helsinki (EET).
    expect(helsinkiMinutesOfDay(new Date('2026-01-15T10:00:00Z'))).toBe(720);
  });

  it('maps the last quarter-hour (23:45) to 1425', () => {
    // 2026-01-15T21:45Z = 2026-01-15T23:45 Helsinki — the highest in-range key.
    expect(helsinkiMinutesOfDay(new Date('2026-01-15T21:45:00Z'))).toBe(1425);
  });
});
