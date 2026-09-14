// Tests for the chart's pure series derivation (../../frontend/js/chart-series.js,
// finding #9586, finding #9928): colon-form DST-correct labels (two '03:00'
// buckets on the 25h fall-back day), EMA resolution, ghost nulls, now index per
// tab, and null for an empty primary — all without a Chart constructor.

import { describe, it, expect } from 'vitest';
import { chartSeries } from '../../frontend/js/chart-series.js';
import { emaAggregate } from '../../frontend/js/calc.js';
import { eurToCents } from '../../frontend/js/format.js';
import { stepSlots } from './test-support/rows.js';

type SeriesState = {
  activeTab?: string;
  resolution?: string;
  chartType?: string;
  today?: { slots: unknown[] } | null;
  yesterday?: { slots: unknown[] } | null;
  tomorrow?: { slots: unknown[] } | null;
};

function series(s: SeriesState, nowMs = 0) {
  return chartSeries(
    { activeTab: 'today', resolution: '15min', chartType: 'area', ...s },
    nowMs,
  );
}

const indexPrices = (n: number) => Array.from({ length: n }, (_, i) => i);
// Helsinki midnight → midnight: 24h summer day, 25h fall-back (2026-10-25,
// 04:00 EEST → 03:00 EET), 23h spring-forward (2026-03-29, 03:00 → 04:00).
const SUMMER_DAY = stepSlots('2026-07-17T21:00:00Z', indexPrices(96));
const FALL_BACK_DAY = stepSlots('2026-10-24T21:00:00Z', indexPrices(100));
const SPRING_DAY = stepSlots('2026-03-28T22:00:00Z', indexPrices(92));
const COLON_HHMM = /^\d{2}:\d{2}$/;

describe('chartSeries empty primary', () => {
  it('returns null for missing or empty primary slots on either tab', () => {
    expect(series({ today: null })).toBeNull();
    expect(series({ today: { slots: [] } })).toBeNull();
    expect(series({ activeTab: 'tomorrow', today: { slots: SUMMER_DAY }, tomorrow: null })).toBeNull();
  });
});

describe('chartSeries labels (finding #9928)', () => {
  it('15-min labels are colon-form Helsinki slot starts, not fi-FI dots', () => {
    const s = series({ today: { slots: SUMMER_DAY } })!;
    expect(s.labels).toHaveLength(96);
    expect(s.labels.every((l: string) => COLON_HHMM.test(l))).toBe(true);
    expect(s.labels.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(s.labels[95]).toBe('23:45');
  });

  it('hourly fall-back day has 25 buckets with two 03:00 labels in a row', () => {
    const s = series({ today: { slots: FALL_BACK_DAY }, resolution: 'hourly' })!;
    expect(s.labels).toHaveLength(25);
    expect(s.labels.slice(2, 6)).toEqual(['02:00', '03:00', '03:00', '04:00']);
    expect(s.labels[24]).toBe('23:00');
    expect(s.labels.filter((l: string) => l === '03:00')).toHaveLength(2);
  });

  it('15-min fall-back day repeats 03:00–03:45 once each', () => {
    const s = series({ today: { slots: FALL_BACK_DAY } })!;
    expect(s.labels).toHaveLength(100);
    expect(s.labels.slice(12, 20)).toEqual([
      '03:00', '03:15', '03:30', '03:45', '03:00', '03:15', '03:30', '03:45',
    ]);
  });

  it('hourly spring-forward day has 23 buckets and skips 03:00', () => {
    const s = series({ today: { slots: SPRING_DAY }, resolution: 'hourly' })!;
    expect(s.labels).toHaveLength(23);
    expect(s.labels.slice(2, 4)).toEqual(['02:00', '04:00']);
    expect(s.labels).not.toContain('03:00');
  });
});

describe('chartSeries data', () => {
  it('hourly primary is the EMA of each wall-clock hour, in cents', () => {
    const s = series({ today: { slots: SUMMER_DAY }, resolution: 'hourly' })!;
    const expected = emaAggregate(SUMMER_DAY).map((b: { priceWithTax: number }) =>
      eurToCents(b.priceWithTax),
    );
    expect(s.primaryData).toEqual(expected);
    expect(s.isHourly).toBe(true);
  });

  it('no yesterday → empty ghost array (config skips the dataset)', () => {
    const s = series({ today: { slots: SUMMER_DAY }, yesterday: null })!;
    expect(s.secondaryData).toEqual([]);
  });

  it('keeps ghost nulls where yesterday has no matching wall-clock slot', () => {
    const s = series({ today: { slots: SUMMER_DAY }, yesterday: { slots: SPRING_DAY } })!;
    expect(s.secondaryData).toHaveLength(96);
    for (let i = 12; i < 16; i++) expect(s.secondaryData[i]).toBeNull();
    expect(s.secondaryData[16]).toBe(eurToCents(SPRING_DAY[12].priceWithTax));
  });

  it('reports bar mode and per-tab dataset labels', () => {
    const today = series({ today: { slots: SUMMER_DAY }, chartType: 'bar' })!;
    expect(today.isBar).toBe(true);
    expect([today.primaryLabel, today.secondaryLabel]).toEqual(['Tänään', 'Eilen']);

    const tomorrow = series({
      activeTab: 'tomorrow',
      today: { slots: SUMMER_DAY },
      tomorrow: { slots: SUMMER_DAY },
    })!;
    expect(tomorrow.isBar).toBe(false);
    expect([tomorrow.primaryLabel, tomorrow.secondaryLabel]).toEqual(['Huomenna', 'Tänään']);
  });
});

describe('chartSeries now index', () => {
  const at = (iso: string) => Date.parse(iso);

  it('picks the fall-back hour by absolute instant, not by the repeated label', () => {
    // 01:20Z is 03:20 EET — the second 03:00 bucket (index 4), not the first.
    const s = series(
      { today: { slots: FALL_BACK_DAY }, resolution: 'hourly' },
      at('2026-10-25T01:20:00Z'),
    )!;
    expect(s.nowIndex).toBe(4);
  });

  it('is -1 outside the shown day and always -1 on the tomorrow tab', () => {
    expect(series({ today: { slots: SUMMER_DAY } }, at('2026-07-19T12:00:00Z'))!.nowIndex).toBe(-1);
    const tomorrow = series(
      { activeTab: 'tomorrow', today: { slots: SUMMER_DAY }, tomorrow: { slots: SUMMER_DAY } },
      at('2026-07-18T12:00:00Z'),
    )!;
    expect(tomorrow.nowIndex).toBe(-1);
  });
});
