// Tests for the Chart.js config builder (../../frontend/js/chart-config.js,
// finding #9586, finding #9928): bar vs area branches (bar type, no fill, ghost
// stays a line overlay), ghost omitted when empty, x tick stride per resolution,
// y/tooltip callbacks, reduced motion, and fresh option objects per call.

import { describe, it, expect } from 'vitest';
import { buildChartConfig } from '../../frontend/js/chart-config.js';

type Dataset = Record<string, unknown> & { data: (number | null)[] };
type Config = {
  type: string;
  data: { labels: string[]; datasets: Dataset[] };
  options: {
    animation: unknown;
    scales: {
      x: { ticks: { callback: (this: unknown, v: number, i: number) => string } };
      y: { ticks: { callback: (v: number) => string } };
    };
    plugins: {
      tooltip: {
        callbacks: {
          title: (items: { label: string }[]) => string;
          label: (ctx: { dataset: { label: string }; parsed: { y: number | null } }) => string;
        };
      };
      annotation: { annotations: Record<string, { xMin: number; xMax: number }> };
    };
  };
};

function seriesOf(over: Record<string, unknown> = {}) {
  return {
    labels: ['00:00', '00:15', '00:30'],
    primaryData: [1, 2, 3],
    secondaryData: [4, null, 6],
    primaryLabel: 'Tänään',
    secondaryLabel: 'Eilen',
    nowIndex: 1,
    isHourly: false,
    isBar: false,
    ...over,
  };
}

const build = (over: Record<string, unknown> = {}, reducedMotion = false) =>
  buildChartConfig(seriesOf(over), reducedMotion) as Config;

describe('buildChartConfig chart type (finding #9928)', () => {
  it('area: line chart, filled primary, ghost inherits the chart type', () => {
    const config = build();
    expect(config.type).toBe('line');
    const [primary, ghost] = config.data.datasets;
    expect(primary.fill).toBe(true);
    expect(primary.borderWidth).toBe(2);
    expect(primary.tension).toBe(0.3);
    expect(ghost.type).toBeUndefined();
  });

  it('bar: bar chart, unfilled primary, ghost stays a line overlay', () => {
    const config = build({ isBar: true });
    expect(config.type).toBe('bar');
    const [primary, ghost] = config.data.datasets;
    expect(primary.fill).toBe(false);
    expect(primary.borderWidth).toBe(0);
    expect(primary.borderRadius).toBe(4);
    expect(primary.pointHoverRadius).toBe(0);
    expect(ghost.type).toBe('line');
    expect(ghost.fill).toBe(false);
  });
});

describe('buildChartConfig data', () => {
  it('passes labels and both series through with their dataset labels', () => {
    const config = build();
    expect(config.data.labels).toEqual(['00:00', '00:15', '00:30']);
    expect(config.data.datasets.map((d) => d.label)).toEqual(['Tänään', 'Eilen']);
    expect(config.data.datasets[0].data).toEqual([1, 2, 3]);
    expect(config.data.datasets[1].data).toEqual([4, null, 6]);
  });

  it('omits the ghost dataset when there is no secondary data', () => {
    expect(build({ secondaryData: [] }).data.datasets).toHaveLength(1);
  });

  it('adds the Nyt line at nowIndex and none when nowIndex is -1', () => {
    const nowLine = build({ nowIndex: 2 }).options.plugins.annotation.annotations.nowLine;
    expect([nowLine.xMin, nowLine.xMax]).toEqual([2, 2]);
    expect(build({ nowIndex: -1 }).options.plugins.annotation.annotations).toEqual({});
  });
});

describe('buildChartConfig callbacks', () => {
  const scale = { getLabelForValue: (v: number) => `L${v}` };
  const ticksShown = (isHourly: boolean, n: number) => {
    const cb = build({ isHourly }).options.scales.x.ticks.callback;
    return Array.from({ length: n }, (_, i) => cb.call(scale, i, i)).filter(Boolean);
  };

  it('x ticks every 12th 15-min slot and every 3rd hourly bucket', () => {
    expect(ticksShown(false, 96)).toEqual(['L0', 'L12', 'L24', 'L36', 'L48', 'L60', 'L72', 'L84']);
    expect(ticksShown(true, 25)).toEqual(['L0', 'L3', 'L6', 'L9', 'L12', 'L15', 'L18', 'L21', 'L24']);
  });

  it('y ticks are cents with a " c" suffix', () => {
    expect(build().options.scales.y.ticks.callback(12)).toBe('12 c');
  });

  it('tooltip shows c/kWh to 2 decimals and an em dash for ghost gaps', () => {
    const { title, label } = build().options.plugins.tooltip.callbacks;
    expect(title([{ label: '03:00' }])).toBe('03:00');
    expect(label({ dataset: { label: 'Tänään' }, parsed: { y: 7.5 } })).toBe('Tänään: 7.50 c/kWh');
    expect(label({ dataset: { label: 'Eilen' }, parsed: { y: null } })).toBe('Eilen: —');
  });
});

describe('buildChartConfig options', () => {
  it('disables animation under reduced motion', () => {
    expect(build({}, true).options.animation).toBe(false);
    expect(build({}, false).options.animation).toEqual({ duration: 600 });
  });

  it('builds fresh option objects per call (Chart.js reassigns options.scales)', () => {
    const a = build();
    const b = build();
    expect(a.options).not.toBe(b.options);
    expect(a.options.scales).not.toBe(b.options.scales);
    expect(a.options.scales.x).not.toBe(b.options.scales.x);
    expect(a.options.plugins).not.toBe(b.options.plugins);
    expect(a.options.plugins.tooltip).not.toBe(b.options.plugins.tooltip);
  });
});
