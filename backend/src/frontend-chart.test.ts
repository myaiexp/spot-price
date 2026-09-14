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

type FakeChartInstance = { destroyed: number; destroy: () => void };
type ChartCall = { canvas: unknown; config: Record<string, unknown>; instance: FakeChartInstance };

function fakeChart() {
  const constructed: ChartCall[] = [];
  function Chart(this: FakeChartInstance, canvas: unknown, config: Record<string, unknown>) {
    constructed.push({ canvas, config, instance: this });
    this.destroyed = 0;
    this.destroy = () => {
      this.destroyed += 1;
    };
  }
  return { Chart, constructed };
}

function render(
  doc: ReturnType<typeof fakeDocument>,
  extra: Record<string, unknown> = {},
  chart = fakeChart(),
) {
  renderChart({
    document: doc,
    Chart: chart.Chart,
    matchMedia: () => ({ matches: false }),
    ...extra,
  });
  return chart.constructed;
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

describe('renderChart re-render and mode (finding #9928)', () => {
  it('destroys the previous Chart instance before constructing the next', () => {
    state.today = { slots: TWO_HOURS };
    const { doc, els } = chartDoc();
    const chart = fakeChart();
    render(doc, {}, chart);
    const first = chart.constructed[0].instance;
    expect(state.chart).toBe(first);
    expect(first.destroyed).toBe(0);

    state.resolution = 'hourly';
    render(doc, {}, chart);

    expect(chart.constructed).toHaveLength(2);
    expect(first.destroyed).toBe(1);
    expect(state.chart).toBe(chart.constructed[1].instance);
    expect(chart.constructed[1].instance.destroyed).toBe(0);
    expect(chart.constructed[1].canvas).toBe(els.priceChart);
  });

  it('bar mode builds a bar chart with the ghost kept as a line overlay', () => {
    state.today = { slots: TWO_HOURS };
    state.yesterday = { slots: TWO_HOURS };
    state.chartType = 'bar';
    const { doc } = chartDoc();
    const constructed = render(doc);

    const { config } = constructed[0];
    expect(config.type).toBe('bar');
    const [primary, ghost] = datasetsOf(config) as { fill?: boolean; type?: string }[];
    expect(primary.fill).toBe(false);
    expect(ghost.type).toBe('line');
  });

  it('passes colon-form Helsinki labels, two 03:00 buckets on the fall-back hourly day', () => {
    // 2026-10-25: Helsinki 04:00 EEST → 03:00 EET, a 25h / 100-slot day.
    state.today = { slots: stepSlots('2026-10-24T21:00:00Z', Array(100).fill(0.1)) };
    state.resolution = 'hourly';
    const { doc } = chartDoc();
    const constructed = render(doc);

    const labels = (constructed[0].config.data as { labels: string[] }).labels;
    expect(labels).toHaveLength(25);
    expect(labels.slice(2, 6)).toEqual(['02:00', '03:00', '03:00', '04:00']);
    expect(labels.every((l) => /^\d{2}:\d{2}$/.test(l))).toBe(true);
  });
});

describe('renderChart hourly with a missing :00 slot (finding #9929)', () => {
  it('draws the gap hour as its own bucket and puts Nyt on it', () => {
    // Helsinki 09:00–09:45, 10:15–10:45, 11:00 (EEST): the 10:00 slot is missing.
    const slots = stepSlots('2026-07-18T06:00:00Z', [1, 2, 3, 4, 99, 10, 20, 30, 5]).filter(
      (_, i) => i !== 4,
    );
    state.today = { slots };
    state.resolution = 'hourly';
    const { doc } = chartDoc();
    // 07:20Z = 10:20 Helsinki, inside the gap hour.
    const constructed = render(doc, { nowMs: Date.parse('2026-07-18T07:20:00Z') });

    const { config } = constructed[0];
    expect((config.data as { labels: string[] }).labels).toEqual(['09:00', '10:00', '11:00']);
    expect(datasetsOf(config)[0].data).toEqual(
      emaAggregate(slots).map((b: { priceWithTax: number }) => eurToCents(b.priceWithTax)),
    );
    expect(annotationOf(config).nowLine.xMin).toBe(1);
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
