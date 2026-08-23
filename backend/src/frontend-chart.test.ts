// Pins chart renderer wiring (finding #7897): empty-data Finnish placeholder,
// hourly 'Nyt' marker via HOUR_MS (not SLOT_MS — the #7615 regression), and
// ghost series from alignSecondaryByWallClock (nulls on DST gaps, not zip-by-index
// — audit #6332). renderChart takes { document, nowMs, Chart, matchMedia } so
// these run without jsdom or the Chart.js CDN global.

import { describe, it, expect, afterEach } from 'vitest';
import { renderChart } from '../../frontend/js/chart.js';
import { state } from '../../frontend/js/state.js';
import { alignSecondaryByWallClock, emaAggregate } from '../../frontend/js/calc.js';
import { eurToCents } from '../../frontend/js/format.js';
import { fakeDocument, fakeEl } from './test-support/fake-dom.js';
import { stepSlots } from './test-support/rows.js';

afterEach(() => {
  state.today = null;
  state.yesterday = null;
  state.tomorrow = null;
  state.activeTab = 'today';
  state.chartType = 'area';
  state.resolution = '15min';
  state.chart = null;
});

function chartDoc() {
  const els = {
    priceChart: fakeEl(),
    chartPlaceholder: fakeEl(),
  };
  return { doc: fakeDocument(els), els };
}

type ChartCall = { canvas: unknown; config: Record<string, unknown> };

function fakeChart() {
  const constructed: ChartCall[] = [];
  function Chart(this: { destroy: () => void }, canvas: unknown, config: Record<string, unknown>) {
    constructed.push({ canvas, config });
    this.destroy = () => {};
  }
  return { Chart, constructed };
}

function render(doc: ReturnType<typeof fakeDocument>, extra: Record<string, unknown> = {}) {
  const { Chart, constructed } = fakeChart();
  renderChart({
    document: doc,
    Chart,
    matchMedia: () => ({ matches: false }),
    ...extra,
  });
  return constructed;
}

function annotationOf(config: Record<string, unknown>) {
  const options = config.options as {
    plugins: { annotation: { annotations: Record<string, { xMin: number; label: { content: string } }> } };
  };
  return options.plugins.annotation.annotations;
}

function datasetsOf(config: Record<string, unknown>) {
  const data = config.data as { datasets: { data: (number | null)[] }[] };
  return data.datasets;
}

// Two hours of 15-min slots from 12:00Z. :20 into the first hour is past the
// first 15-min window but still inside the first hourly bucket.
const TWO_HOURS = stepSlots('2026-07-18T12:00:00Z', Array(8).fill(0.1));
const NOW_AT_20 = Date.parse('2026-07-18T12:20:00Z');

describe('renderChart empty copy (finding #7897)', () => {
  it('paints the Finnish placeholder and does not construct Chart', () => {
    state.today = { slots: [] };
    const { doc, els } = chartDoc();
    const constructed = render(doc);

    expect(constructed).toHaveLength(0);
    expect(els.chartPlaceholder.textContent).toBe('Ei hintatietoja saatavilla');
    expect(els.chartPlaceholder.style.display).toBe('flex');
    expect(els.priceChart.style.display).toBe('none');
  });

  it('treats a missing today payload the same as empty slots', () => {
    state.today = null;
    const { doc, els } = chartDoc();
    const constructed = render(doc);

    expect(constructed).toHaveLength(0);
    expect(els.chartPlaceholder.textContent).toBe('Ei hintatietoja saatavilla');
  });
});

describe('renderChart now marker (finding #7897, #7615)', () => {
  it('places Nyt on the hourly bucket containing :20, not -1 from SLOT_MS', () => {
    state.today = { slots: TWO_HOURS };
    state.resolution = 'hourly';
    const { doc, els } = chartDoc();
    const constructed = render(doc, { nowMs: NOW_AT_20 });

    expect(constructed).toHaveLength(1);
    expect(els.priceChart.style.display).toBe('block');
    expect(els.chartPlaceholder.style.display).toBe('none');
    const nowLine = annotationOf(constructed[0].config).nowLine;
    expect(nowLine).toBeDefined();
    expect(nowLine.xMin).toBe(0);
    expect(nowLine.label.content).toBe('Nyt');
  });

  it('places Nyt on the 15-min slot containing :20, not the hour-start from HOUR_MS', () => {
    state.today = { slots: TWO_HOURS };
    state.resolution = '15min';
    const { doc } = chartDoc();
    const constructed = render(doc, { nowMs: NOW_AT_20 });

    const nowLine = annotationOf(constructed[0].config).nowLine;
    expect(nowLine.xMin).toBe(1);
    expect(nowLine.label.content).toBe('Nyt');
  });

  it('omits the now marker on the tomorrow tab even when nowMs lands in a slot', () => {
    state.activeTab = 'tomorrow';
    state.tomorrow = { slots: TWO_HOURS };
    state.today = { slots: TWO_HOURS };
    const { doc } = chartDoc();
    const constructed = render(doc, { nowMs: NOW_AT_20 });

    expect(annotationOf(constructed[0].config).nowLine).toBeUndefined();
  });
});

describe('renderChart ghost series (finding #7897, audit #6332)', () => {
  it('aligns 15-min yesterday by wall-clock, with nulls on the spring-forward gap', () => {
    // Primary: normal 96-slot day (has 03:00–03:45). Secondary: spring-forward
    // 92 slots (skips 03:00–03:45). Zip-by-index would shift everything after 03:00.
    const primary = stepSlots(
      '2026-07-17T21:00:00Z',
      Array.from({ length: 96 }, (_, i) => i),
    );
    const secondary = stepSlots(
      '2026-03-28T22:00:00Z',
      Array.from({ length: 92 }, (_, i) => i + 0.5),
    );
    state.today = { slots: primary };
    state.yesterday = { slots: secondary };
    const { doc } = chartDoc();
    const constructed = render(doc);

    const ghost = datasetsOf(constructed[0].config)[1].data;
    const expected = alignSecondaryByWallClock(primary, secondary).map((p) =>
      p == null ? null : eurToCents(p),
    );
    expect(ghost).toEqual(expected);
    for (let i = 12; i < 16; i++) expect(ghost[i]).toBeNull();
    expect(ghost[12]).not.toBe(eurToCents(secondary[12].priceWithTax));
  });

  it('aligns hourly yesterday by wall-clock across 24 vs 23 buckets, not by index', () => {
    const primary = stepSlots(
      '2026-07-17T21:00:00Z',
      Array.from({ length: 96 }, (_, i) => i),
    );
    const secondary = stepSlots(
      '2026-03-28T22:00:00Z',
      Array.from({ length: 92 }, (_, i) => i + 0.5),
    );
    state.today = { slots: primary };
    state.yesterday = { slots: secondary };
    state.resolution = 'hourly';
    const { doc } = chartDoc();
    const constructed = render(doc);

    const ghost = datasetsOf(constructed[0].config)[1].data;
    const expected = alignSecondaryByWallClock(emaAggregate(primary), emaAggregate(secondary), {
      hourly: true,
    }).map((p) => (p == null ? null : eurToCents(p)));
    expect(ghost).toEqual(expected);
    expect(ghost[3]).toBeNull();
    expect(ghost[3]).not.toBe(eurToCents(emaAggregate(secondary)[3].priceWithTax));
  });
});
