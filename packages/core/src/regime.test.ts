import { describe, expect, it } from 'vitest';
import hyFixture from '../../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json';
import icsaFixture from '../../../fixtures/fred/fredgraph-ICSA.json';
import nfciFixture from '../../../fixtures/fred/fredgraph-NFCI.json';
import sahmFixture from '../../../fixtures/fred/fredgraph-SAHMREALTIME.json';
import spFixture from '../../../fixtures/fred/fredgraph-SP500.json';
import curveFixture from '../../../fixtures/fred/fredgraph-T10Y3M.json';
import vixFixture from '../../../fixtures/fred/fredgraph-VIXCLS.json';
import vix3mFixture from '../../../fixtures/fred/fredgraph-VXVCLS.json';
import {
  EVENT_STUDY_VERSION,
  MIN_EPISODES,
  REGIME_RULE_VERSION,
  baselineStudy,
  classifyRegime,
  eventStudy,
  publishedBy,
  publishedOn,
  quantile,
  recessionFilter,
  regimeHistory,
  type MacroSeries,
  type Obs,
  type RegimeInputs,
} from './regime.js';

/** The FRED graph download: a header line, then "date,value"; a blank or "." is a day with no value. */
function csv(text: string): Obs[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .filter(([, v]) => v !== undefined && v !== '' && v !== '.')
    .map(([d, v]) => ({ date: d as string, value: Number(v) }));
}

/** FNV-1a, 32 bits: the same function is in the Python reference, so the whole label history can be compared. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  // The label lines are plain ASCII, so a character code is the same as its UTF-8 byte.
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const real: MacroSeries = {
  SAHMREALTIME: csv(sahmFixture.body),
  T10Y3M: csv(curveFixture.body),
  BAMLH0A0HYM2: csv(hyFixture.body),
  ICSA: csv(icsaFixture.body),
  NFCI: csv(nfciFixture.body),
};
const sp500 = csv(spFixture.body);
const vix = csv(vixFixture.body);
const vix3m = csv(vix3mFixture.body);

describe('point in time: a value is used from the day it was published', () => {
  it('market closes on their own day; claims and NFCI 5 days after the week; the Sahm rule from the 10th of the next month', () => {
    expect(publishedOn('VIXCLS', '2026-11-20')).toBe('2026-11-20');
    expect(publishedOn('ICSA', '2026-11-14')).toBe('2026-11-19'); // week ending Saturday, out on Thursday
    expect(publishedOn('NFCI', '2026-11-13')).toBe('2026-11-18'); // week ending Friday, out on Wednesday
    expect(publishedOn('SAHMREALTIME', '2024-07-01')).toBe('2024-08-10');
    expect(publishedOn('SAHMREALTIME', '2024-12-01')).toBe('2025-01-10'); // across the year end
  });
  it('a later observation is not visible before its release', () => {
    const s = [
      { date: '2026-11-07', value: 1 },
      { date: '2026-11-14', value: 2 },
    ];
    expect(publishedBy('ICSA', s, '2026-11-18').map((o) => o.value)).toEqual([1]);
    expect(publishedBy('ICSA', s, '2026-11-19').map((o) => o.value)).toEqual([1, 2]);
  });
});

describe('recession filter on the real FRED history', () => {
  // Expected levels come from an independent Python implementation of ADR 0009 run on the same files.
  it('turns high on 2024-08-10, when the July 2024 Sahm rule reading of 0.53 counts as published, and not a day before', () => {
    const before = recessionFilter(real, '2024-08-09');
    const after = recessionFilter(real, '2024-08-10');
    expect(before.level).toBe('elevated');
    expect(after.level).toBe('high');
    expect(after.signals.find((s) => s.id === 'sahm')).toMatchObject({
      state: 'triggered',
      value: 0.53,
      asOf: '2024-07-01',
    });
  });
  it('reads low in mid-2021 (no inversion in the previous 18 months) and elevated in mid-2023 (curve inverted since October 2022)', () => {
    const y2021 = recessionFilter(real, '2021-06-30');
    expect(y2021.level).toBe('low');
    // The high-yield series on FRED starts on 2023-11-27, so in 2021 the credit signal is unavailable.
    expect(y2021.signals.find((s) => s.id === 'credit')?.state).toBe('unavailable');
    expect(y2021.available).toBe(4);
    const y2023 = recessionFilter(real, '2023-06-30');
    expect(y2023.level).toBe('elevated');
    expect(y2023.signals.filter((s) => s.state === 'triggered').map((s) => s.id)).toEqual([
      'curve',
      'claims',
    ]);
  });
  it('as of 2026-11-24: elevated, only because the curve was inverted on 50 of the last 378 sessions', () => {
    const f = recessionFilter(real, '2026-11-24');
    expect(f).toMatchObject({ level: 'elevated', available: 5, triggered: 1 });
    const by = Object.fromEntries(f.signals.map((s) => [s.id, s]));
    expect(by['curve']).toMatchObject({
      state: 'triggered',
      value: 0.55,
      asOf: '2026-11-24',
      detail: { invertedSessions: 50 },
    });
    expect(by['credit']).toMatchObject({ state: 'clear', value: 3.63, asOf: '2026-11-23' });
    expect(by['credit']?.detail['change63']).toBeCloseTo(0.96, 10);
    // Claims: the 4-week average 197,750 against the lowest of the previous 52 weeks, 195,250.
    expect(by['claims']).toMatchObject({ state: 'clear', value: 197750, asOf: '2026-11-14' });
    expect(by['claims']?.detail['low52w']).toBe(195250);
    expect(by['nfci']).toMatchObject({ state: 'clear', value: -0.478, asOf: '2026-11-13' });
    expect(by['sahm']).toMatchObject({ state: 'clear', value: 0, asOf: '2026-10-01' });
  });
});

describe('recession filter thresholds (hand-built series)', () => {
  const days = (n: number, value: number, from = '2026-01-01'): Obs[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      value,
    }));
  const asOf = '2026-12-31';
  const quiet: MacroSeries = {
    SAHMREALTIME: [{ date: '2026-11-01', value: 0.2 }],
    T10Y3M: days(400, 1, '2025-11-27'),
    BAMLH0A0HYM2: days(100, 3, '2026-09-23'),
    ICSA: Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.parse('2025-11-01T00:00:00Z') + i * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      value: 200000,
    })),
    NFCI: [{ date: '2026-12-25', value: -0.5 }],
  };
  it('a quiet economy is low with all five signals available', () => {
    expect(recessionFilter(quiet, asOf)).toMatchObject({
      level: 'low',
      available: 5,
      triggered: 0,
    });
  });
  it('the Sahm rule alone at exactly 0.50 makes it high', () => {
    const f = recessionFilter(
      { ...quiet, SAHMREALTIME: [{ date: '2026-11-01', value: 0.5 }] },
      asOf,
    );
    expect(f).toMatchObject({ level: 'high', triggered: 1 });
  });
  it('a high-yield spread of exactly 6.0 triggers credit, 5.99 does not; NFCI of exactly 0 does not trigger', () => {
    const hy = (v: number) => ({ ...quiet, BAMLH0A0HYM2: days(100, v, '2026-09-23') });
    expect(recessionFilter(hy(6), asOf).signals[2]?.state).toBe('triggered');
    expect(recessionFilter(hy(5.99), asOf).signals[2]?.state).toBe('clear');
    expect(
      recessionFilter({ ...quiet, NFCI: [{ date: '2026-12-25', value: 0 }] }, asOf).signals[4]
        ?.state,
    ).toBe('clear');
  });
  it('a rise of 1.5 points in the spread over 63 sessions triggers credit even at a low level', () => {
    const rising = [...days(37, 3, '2026-09-23'), ...days(63, 4.5, '2026-10-30')];
    expect(recessionFilter({ ...quiet, BAMLH0A0HYM2: rising }, asOf).signals[2]).toMatchObject({
      state: 'triggered',
      value: 4.5,
    });
  });
  it('one or two signals is elevated, three is high', () => {
    const two = {
      ...quiet,
      NFCI: [{ date: '2026-12-25', value: 0.1 }],
      BAMLH0A0HYM2: days(100, 7, '2026-09-23'),
    };
    expect(recessionFilter(two, asOf).level).toBe('elevated');
    const three = { ...two, T10Y3M: days(400, -0.1, '2025-11-27') };
    expect(recessionFilter(three, asOf).level).toBe('high');
  });
  it('a stale series is unavailable, and fewer than three available makes the level unavailable', () => {
    const f = recessionFilter({ ...quiet, NFCI: [{ date: '2026-11-01', value: 1 }] }, asOf);
    expect(f.signals[4]?.state).toBe('unavailable');
    expect(f.available).toBe(4);
    expect(recessionFilter({ NFCI: quiet['NFCI'] ?? [] }, asOf).level).toBe('unavailable');
    // Exactly two available is still too few; three is enough.
    const two = { NFCI: quiet['NFCI'] ?? [], SAHMREALTIME: quiet['SAHMREALTIME'] ?? [] };
    expect(recessionFilter(two, asOf)).toMatchObject({ available: 2, level: 'unavailable' });
    expect(recessionFilter({ ...two, T10Y3M: quiet['T10Y3M'] ?? [] }, asOf)).toMatchObject({
      available: 3,
      level: 'low',
    });
  });
});

describe('the regime label rules', () => {
  const base: RegimeInputs = {
    date: '2026-11-20',
    sp500: 100,
    sma50: 95,
    sma200: 90,
    sma200Prior: 89,
    drawdown: -0.01,
    vix: 15,
    vix3m: 18,
  };
  const label = (over: Partial<RegimeInputs>, recent = false) =>
    classifyRegime({ ...base, ...over }, recent).label;
  it('bull calm: above both averages, within 5% of the high, VIX under 20', () => {
    expect(label({})).toBe('bull-calm');
    expect(label({ vix: 20 })).toBe('bull-correction'); // 20 is not below 20
    expect(label({ drawdown: -0.05 })).toBe('bull-correction'); // 5% down is not "less than 5%"
  });
  it('stress at VIX 30 exactly, or in backwardation below the 50-day average', () => {
    expect(label({ vix: 30 })).toBe('stress');
    expect(label({ vix: 29.99 })).toBe('bull-correction');
    expect(label({ vix: 25, vix3m: 25, sp500: 94 })).toBe('stress');
    expect(label({ vix: 25, vix3m: 25, sp500: 96 })).toBe('bull-correction'); // backwardation above the 50-day
    expect(label({ vix: 25, vix3m: null, sp500: 94 })).toBe('bull-correction'); // no VIX3M: that test cannot run
  });
  it('bear: below a falling 200-day average; below a rising one is a correction', () => {
    expect(label({ sp500: 85, sma50: 88, sma200: 90, sma200Prior: 91, drawdown: -0.2 })).toBe(
      'bear',
    );
    expect(label({ sp500: 85, sma50: 88, sma200: 90, sma200Prior: 89, drawdown: -0.2 })).toBe(
      'bull-correction',
    );
  });
  it('recovery: within 63 sessions of stress or a bear, above the 50-day, still at least 5% below the high', () => {
    expect(label({ drawdown: -0.08 }, true)).toBe('recovery');
    expect(label({ drawdown: -0.03 }, true)).toBe('bull-calm'); // back near the high: no longer recovering
    expect(label({ drawdown: -0.08, sp500: 94 }, true)).toBe('bull-correction'); // below the 50-day
  });
  it('missing inputs are "insufficient data", never a guess', () => {
    expect(label({ vix: null })).toBe('insufficient-data');
    expect(label({ sma200: null })).toBe('insufficient-data');
  });
});

describe('the regime label history on the real S&P 500, VIX and VIX3M (FRED, 2016-11-25 to 2026-11-23)', () => {
  const h = regimeHistory(sp500, vix, vix3m);
  it('matches the independent Python implementation day by day', () => {
    const counts: Record<string, number> = {};
    for (const d of h) counts[d.label] = (counts[d.label] ?? 0) + 1;
    expect(counts).toEqual({
      'insufficient-data': 251,
      'bull-calm': 1156,
      stress: 246,
      'bull-correction': 522,
      recovery: 132,
      bear: 205,
    });
    expect(fnv(h.map((d) => `${d.date} ${d.label}\n`).join(''))).toBe(2748044851);
    expect(h.every((d) => d.ruleVersion === REGIME_RULE_VERSION)).toBe(true);
  });
  it('labels known days as history remembers them', () => {
    const on = (date: string) => h.find((d) => d.date === date)?.label;
    expect(on('2020-03-16')).toBe('stress'); // VIX 82.69
    expect(on('2022-12-15')).toBe('bear'); // below a falling 200-day average, VIX 22.83
    expect(on('2023-06-30')).toBe('bull-calm'); // VIX 13.59
    expect(on('2024-08-05')).toBe('stress'); // VIX 38.57
    expect(on('2025-04-08')).toBe('stress'); // VIX 52.33
  });
  it('stores the inputs with each day, so the label can be recomputed from them', () => {
    const d = h.find((x) => x.date === '2022-12-15');
    expect(d?.inputs).toMatchObject({ vix: 22.83, vix3m: 25.08 });
    const again = classifyRegime(d?.inputs as RegimeInputs, false);
    expect(again.label).toBe('bear');
  });
});

describe('quantiles (NumPy default: linear between order statistics)', () => {
  it('hand-checked values', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75); // position 0.75 between 1 and 2
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([7], 0.25)).toBe(7);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
  });
});

describe('event studies', () => {
  const closes = (values: number[]): Obs[] =>
    values.map((value, i) => ({ date: `d${String(i).padStart(3, '0')}`, value }));
  it('one episode per run of the condition, with forward returns from the first day', () => {
    // Prices 100..109; the condition holds on days 2 and 3 (one episode starting at day 2).
    const c = closes([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    const r = eventStudy(
      c,
      [false, false, true, true, false, false, false, false, false, false],
      [2, 5],
      1,
    );
    expect(r.version).toBe(EVENT_STUDY_VERSION);
    expect(r.episodes).toEqual(['d002']);
    expect(r.byHorizon[0]).toMatchObject({
      horizon: 2,
      n: 1,
      median: 104 / 102 - 1,
      sufficient: false,
    });
    expect(r.byHorizon[1]?.median).toBeCloseTo(107 / 102 - 1, 12);
  });
  it('a new episode within the cooldown is ignored, and a horizon past the last close is left out', () => {
    const c = closes([100, 110, 100, 110, 100, 110, 100]);
    const cond = [true, false, true, false, false, true, false];
    // With a cooldown of 3: starts at 0 and 5 (2 is too soon after 0).
    const r = eventStudy(c, cond, [1, 2], 3);
    expect(r.episodes).toEqual(['d000', 'd005']);
    expect(r.byHorizon[0]?.n).toBe(2); // 0->1 and 5->6
    expect(r.byHorizon[1]?.n).toBe(1); // 5->7 runs past the end
  });
  it('fewer than 30 episodes is marked insufficient; 30 is enough', () => {
    expect(MIN_EPISODES).toBe(30);
    const c = closes(Array.from({ length: 70 }, (_, i) => 100 + i));
    const every2 = Array.from({ length: 70 }, (_, i) => i % 2 === 0);
    const r = eventStudy(c, every2, [1], 2);
    expect(r.byHorizon[0]?.n).toBe(35);
    expect(r.byHorizon[0]?.sufficient).toBe(true);
    const r29 = eventStudy(c.slice(0, 59), every2.slice(0, 59), [1], 2);
    expect(r29.byHorizon[0]).toMatchObject({ n: 29, sufficient: false });
  });
  it('on the real data: 17 stress episodes since 2017, 16 with a 63-session return, so not enough to show', () => {
    const h = regimeHistory(sp500, vix, vix3m);
    const r = eventStudy(
      sp500,
      h.map((d) => d.label === 'stress'),
    );
    expect(r.episodes).toHaveLength(17);
    expect(r.episodes.slice(0, 3)).toEqual(['2018-02-05', '2018-10-10', '2019-05-13']);
    // Same numbers as the Python reference (NumPy quantiles).
    expect(r.byHorizon.map((s) => [s.horizon, s.n, s.sufficient])).toEqual([
      [21, 16, false],
      [63, 16, false],
      [126, 16, false],
    ]);
    expect(r.byHorizon[1]?.median).toBeCloseTo(0.048039, 6);
    expect(r.byHorizon[1]?.q1).toBeCloseTo(-0.021643, 6);
    expect(r.byHorizon[1]?.q3).toBeCloseTo(0.103252, 6);
    const base = baselineStudy(sp500);
    expect(base.map((s) => [s.horizon, s.n, s.sufficient])).toEqual([
      [21, 119, true],
      [63, 39, true],
      [126, 19, false],
    ]);
    expect(base[1]?.median).toBeCloseTo(0.037155, 6);
  });
});
