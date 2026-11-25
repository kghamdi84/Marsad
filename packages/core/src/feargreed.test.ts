import { describe, expect, it } from 'vitest';
import synthetic from '../../../fixtures/feargreed/synthetic-feargreed.json';
import hyFixture from '../../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json';
import igFixture from '../../../fixtures/fred/fredgraph-BAMLC0A0CM.json';
import spFixture from '../../../fixtures/fred/fredgraph-SP500.json';
import vixFixture from '../../../fixtures/fred/fredgraph-VIXCLS.json';
import {
  FEAR_GREED_RULES,
  componentSeries,
  fearGreedHistory,
  fearGreedLabel,
  overAverage,
  relativeReturn,
  trailingPercentile,
  type BreadthInput,
  type FearGreedInputs,
} from './feargreed.js';
import type { Obs } from './regime.js';

function csv(text: string): Obs[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .filter(([, v]) => v !== undefined && v !== '' && v !== '.')
    .map(([d, v]) => ({ date: d as string, value: Number(v) }));
}
const pairs = (p: [string, number][]): Obs[] => p.map(([date, value]) => ({ date, value }));

const inputs: FearGreedInputs = {
  sp500: csv(spFixture.body),
  vix: csv(vixFixture.body),
  highYield: csv(hyFixture.body),
  investmentGrade: csv(igFixture.body),
  breadth: synthetic.breadth as BreadthInput[],
  spy: pairs(synthetic.spy as [string, number][]),
  ief: pairs(synthetic.ief as [string, number][]),
};

describe('building blocks', () => {
  it('overAverage divides by the trailing average including the day (hand-checked)', () => {
    const s = pairs([
      ['d1', 10],
      ['d2', 20],
      ['d3', 30],
      ['d4', 40],
    ]);
    // average of 20, 30, 40 is 30, so 40 / 30 - 1
    expect(overAverage(s, 3).map((o) => o.value)).toEqual([30 / 20 - 1, 40 / 30 - 1]);
  });

  it('relativeReturn counts sessions both series share', () => {
    const a = pairs([
      ['d1', 100],
      ['d2', 101],
      ['d3', 110],
    ]);
    const b = pairs([
      ['d1', 50],
      ['d3', 51],
    ]);
    // d2 is missing from b, so the 1-session return at d3 spans d1 to d3: 10% minus 2%
    const r = relativeReturn(a, b, 1);
    expect(r).toHaveLength(1);
    expect(r[0]?.date).toBe('d3');
    expect(r[0]?.value).toBeCloseTo(0.1 - 0.02, 12);
  });

  it('trailingPercentile uses mid-ranks for ties (hand-checked)', () => {
    // window of 4 ending at index 4 is [2, 2, 3, 2]: none below 2, three equal, so (0 + 1.5) / 4
    expect(trailingPercentile([1, 2, 2, 3, 2], 4, 4)).toBe(37.5);
    // window [1, 2, 2, 3, 2] (all five): one below, three equal: (1 + 1.5) / 5
    expect(trailingPercentile([1, 2, 2, 3, 2], 4, 504)).toBe(50);
    expect(trailingPercentile([5, 1, 2, 3], 3, 3)).toBe((100 * (2 + 0.5)) / 3);
  });

  it('stock price strength needs at least 500 members with 252 sessions', () => {
    const row = (date: string, n252: number) => ({
      date,
      newHighs: 30,
      newLows: 10,
      n252,
      mcclellanSummation: null,
    });
    const s = componentSeries({
      ...inputs,
      breadth: [row('d1', 499), row('d2', 500), row('d3', 800)],
    }).strength;
    expect(s).toEqual([
      { date: 'd2', value: 20 / 500 },
      { date: 'd3', value: 20 / 800 },
    ]);
  });

  it('labels follow CNN bands on the rounded composite', () => {
    expect(fearGreedLabel(24.49)).toBe('extreme-fear');
    expect(fearGreedLabel(24.5)).toBe('fear');
    expect(fearGreedLabel(44.4)).toBe('fear');
    expect(fearGreedLabel(45)).toBe('neutral');
    expect(fearGreedLabel(55.4)).toBe('neutral');
    expect(fearGreedLabel(56)).toBe('greed');
    expect(fearGreedLabel(75.4)).toBe('greed');
    expect(fearGreedLabel(75.5)).toBe('extreme-greed');
  });
});

describe('fearGreedHistory against the independent Python implementation', () => {
  const days = fearGreedHistory(inputs);
  const expected = synthetic.expected as [string, number | null, number][];

  it('covers the same days', () => {
    expect(days.map((d) => d.date)).toEqual(expected.map((e) => e[0]));
  });

  it('matches every composite to 1e-8 and every count exactly', () => {
    const bad: string[] = [];
    days.forEach((d, i) => {
      const [date, composite, available] = expected[i] as [string, number | null, number];
      const ok =
        d.available === available &&
        (composite === null
          ? d.composite === null
          : d.composite !== null && Math.abs(d.composite - composite) < 1e-8);
      if (!ok) bad.push(`${date}: ${d.composite} (${d.available}) vs ${composite} (${available})`);
    });
    expect(bad.slice(0, 5)).toEqual([]);
    expect(expected.filter((e) => e[1] !== null)).toHaveLength(222);
  });

  it('never counts put/call without a source, and says why', () => {
    for (const d of days) {
      const pc = d.components.find((c) => c.key === 'putCall');
      expect(pc).toMatchObject({ score: null, reason: 'no-source' });
    }
  });

  it('marks a component with under 252 values as short history', () => {
    const last = days.at(-1);
    const strength = last?.components.find((c) => c.key === 'strength');
    expect(strength?.reason).toBe('short-history');
    expect(strength?.window).toBeLessThan(FEAR_GREED_RULES.minWindow);
  });

  it('scores volatility and junk inversely (high raw value is fear)', () => {
    const d = days.find((x) => x.composite !== null) ?? days[0];
    for (const key of ['volatility', 'junk'] as const) {
      const c = d?.components.find((x) => x.key === key);
      if (c?.score === null || c?.score === undefined) continue;
      const series = key === 'volatility' ? overAverage(inputs.vix, 50) : null;
      if (series) {
        const i = series.findIndex((o) => o.date === d?.date);
        const p = trailingPercentile(
          series.map((o) => o.value),
          i,
          504,
        );
        expect(c.score).toBeCloseTo(100 - p, 9);
      }
    }
  });

  it('needs at least 4 components for a composite', () => {
    for (const d of days) expect(d.composite === null).toBe(d.available < 4);
  });
});
