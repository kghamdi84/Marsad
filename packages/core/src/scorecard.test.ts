import { describe, expect, it } from 'vitest';
import {
  alertOutcomes,
  calibration,
  directionOf,
  referenceIndex,
  summarize,
  type Outcome,
  type ScoredAlert,
} from './scorecard.js';
import { mulberry32, wilson } from './stats.js';
import type { DailyBar } from './study.js';

const bar = (date: string, close: number, high = close, low = close): DailyBar => ({
  date,
  open: close,
  high,
  low,
  close,
  volume: 1,
  vwap: null,
});
// Sessions 2026-11-02 (Mon) to 2026-11-06 (Fri), then 11-09 and 11-10.
const DATES = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-09',
  '2026-11-10',
];
const stock = [
  bar(DATES[0]!, 100),
  bar(DATES[1]!, 102, 103, 99),
  bar(DATES[2]!, 101, 104, 100),
  bar(DATES[3]!, 98, 101, 97),
  bar(DATES[4]!, 99, 100, 96),
  bar(DATES[5]!, 105, 106, 98),
  bar(DATES[6]!, 106),
];
const spy = DATES.map((d, i) => bar(d, 500 + 5 * i)); // 500, 505, ..., 530
const base: ScoredAlert = {
  id: 'a1',
  createdAt: '2026-11-02T22:40:00Z', // 17:40 ET Monday: after the close, so Monday's close is the reference
  kind: 'setup',
  ticker: 'RKLB',
  ruleId: 'trend',
  ruleStatus: 'live',
};

describe('referenceIndex and direction', () => {
  it('uses the session that had closed when the alert fired', () => {
    expect(referenceIndex(stock, new Date('2026-11-02T22:40:00Z'))).toBe(0); // after 16:00 ET
    expect(referenceIndex(stock, new Date('2026-11-03T15:00:00Z'))).toBe(0); // 10:00 ET Tuesday: Monday's close
    expect(referenceIndex(stock, new Date('2026-11-03T21:00:00Z'))).toBe(1); // 16:00 ET Tuesday
    expect(referenceIndex(stock, new Date('2026-11-01T12:00:00Z'))).toBe(-1);
  });
  it('exits point down, setups up, halts nowhere', () => {
    expect([directionOf('exit'), directionOf('setup'), directionOf('halt')]).toEqual([
      'down',
      'up',
      null,
    ]);
  });
});

describe('alertOutcomes (hand-checked)', () => {
  it('a long setup: returns, excess over SPY, excursions, and the stop touched first', () => {
    const [d1, d5, d20] = alertOutcomes(
      { ...base, plan: { stop: 97, targets: [105] } },
      stock,
      spy,
    );
    // 1 session: 102 / 100 - 1 = 2%; SPY 505 / 500 - 1 = 1%; excess 1%. High 103 (+3%), low 99 (-1%).
    expect(d1).toMatchObject({
      status: 'done',
      refDate: '2026-11-02',
      endDate: '2026-11-03',
      hit: 'neither',
    });
    expect(d1?.ret).toBeCloseTo(0.02, 12);
    expect(d1?.benchRet).toBeCloseTo(0.01, 12);
    expect(d1?.excess).toBeCloseTo(0.01, 12);
    expect(d1?.mfe).toBeCloseTo(0.03, 12);
    expect(d1?.mae).toBeCloseTo(-0.01, 12);
    // 5 sessions: end 11-09 close 105 = +5%; SPY 525 / 500 = +5%; excess 0. Highest high 106, lowest low 96.
    // The stop (97) is touched on 11-05 (low 97) before the target (105) on 11-09: stop first.
    expect(d5).toMatchObject({ endDate: '2026-11-09', hit: 'stop' });
    expect(d5?.ret).toBeCloseTo(0.05, 12);
    expect(d5?.excess).toBeCloseTo(0, 12);
    expect(d5?.mfe).toBeCloseTo(0.06, 12);
    expect(d5?.mae).toBeCloseTo(-0.04, 12);
    // 20 sessions: only 6 after the reference so far.
    expect(d20).toMatchObject({ status: 'pending', note: '6 of 20 sessions so far', ret: null });
  });

  it('an exit alert scores a fall as positive', () => {
    const o = alertOutcomes(
      { ...base, kind: 'exit', createdAt: '2026-11-04T22:00:00Z' },
      stock,
      spy,
    );
    // Reference 11-04 close 101; 1 session later 98: -2.97% fall, scored +2.97%. SPY 510 -> 515 rose 0.98%,
    // scored -0.98% in the down direction; excess = 2.97% + 0.98%. MFE from the low 97: (101 - 97) / 101.
    expect(o[0]?.ret).toBeCloseTo(-(98 / 101 - 1), 12);
    expect(o[0]?.benchRet).toBeCloseTo(-(515 / 510 - 1), 12);
    expect(o[0]?.excess).toBeCloseTo(-(98 / 101 - 1) + (515 / 510 - 1), 12);
    expect(o[0]?.mfe).toBeCloseTo(-(97 / 101 - 1), 12);
    expect(o[0]?.mae).toBeCloseTo(-(101 / 101 - 1), 12);
    expect(o[0]?.hit).toBeNull(); // no plan
  });

  it('a target touched before the stop, and a bar touching both counts as the stop', () => {
    const t = alertOutcomes({ ...base, plan: { stop: 90, targets: [103] } }, stock, spy);
    expect(t[1]?.hit).toBe('target'); // high 103 on 11-03
    const both = alertOutcomes({ ...base, plan: { stop: 99, targets: [103] } }, stock, spy);
    expect(both[0]?.hit).toBe('stop'); // 11-03: low 99 and high 103 on the same bar
  });

  it('halts are not scored; an alert before any bar is unavailable', () => {
    expect(alertOutcomes({ ...base, kind: 'halt' }, stock, spy).map((o) => o.status)).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
    expect(alertOutcomes({ ...base, createdAt: '2026-10-01T12:00:00Z' }, stock, spy)[0]?.note).toBe(
      'no bar before the alert',
    );
  });
});

describe('summarize and calibration: recomputed from raw outcomes', () => {
  // 80 synthetic alerts with seeded outcomes: two rules, live and shadow.
  const rnd = mulberry32(7);
  const alerts: ScoredAlert[] = Array.from({ length: 80 }, (_, i) => ({
    ...base,
    id: `x${i}`,
    ruleId: i % 2 === 0 ? 'trend' : 'breakout',
    ruleStatus: i % 4 < 2 ? 'live' : 'shadow',
    qualityScore: Math.floor(rnd() * 101),
  }));
  const outcomes: Outcome[] = alerts.flatMap((a) =>
    (['1d', '5d', '20d'] as const).map((h) => {
      const ret = (rnd() - 0.45) * 0.1;
      const bench = (rnd() - 0.5) * 0.04;
      const done = !(h === '20d' && Number(a.id.slice(1)) % 10 === 0);
      return {
        alertId: a.id,
        horizon: h,
        status: done ? ('done' as const) : ('pending' as const),
        note: null,
        refDate: '2026-11-02',
        endDate: done ? '2026-11-03' : null,
        ret: done ? ret : null,
        benchRet: done ? bench : null,
        excess: done ? ret - bench : null,
        mfe: done ? Math.max(ret, 0) + 0.01 : null,
        mae: done ? Math.min(ret, 0) - 0.01 : null,
        hit: done
          ? ret < -0.03
            ? ('stop' as const)
            : ret > 0.04
              ? ('target' as const)
              : ('neither' as const)
          : null,
      };
    }),
  );

  it('every summary figure equals a plain recomputation from the stored outcomes', () => {
    const rows = summarize(alerts, outcomes);
    expect(rows).toHaveLength(2 * 2 * 3);
    for (const r of rows) {
      const raw = outcomes.filter((o) => {
        const a = alerts.find((x) => x.id === o.alertId)!;
        return (
          a.ruleId === r.ruleId &&
          a.ruleStatus === r.status &&
          o.horizon === r.horizon &&
          o.status === 'done'
        );
      });
      const rets = raw.map((o) => o.ret!);
      const wins = rets.filter((x) => x > 0).length;
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      expect(r.n).toBe(raw.length);
      expect(r.wins).toBe(wins);
      expect(r.winRate).toBeCloseTo(wins / raw.length, 12);
      expect(r.meanRet).toBeCloseTo(avg(rets), 12);
      expect(r.meanExcess).toBeCloseTo(avg(raw.map((o) => o.excess!)), 12);
      expect(r.meanMfe).toBeCloseTo(avg(raw.map((o) => o.mfe!)), 12);
      expect(r.meanMae).toBeCloseTo(avg(raw.map((o) => o.mae!)), 12);
      expect(r.stops).toBe(raw.filter((o) => o.hit === 'stop').length);
      expect(r.targets).toBe(raw.filter((o) => o.hit === 'target').length);
      // 20 alerts per rule and status: under 30, so no interval and flagged insufficient.
      expect(r.insufficient).toBe(raw.length < 30);
      expect(r.winCi).toBeNull();
    }
    // Pending outcomes are left out: alerts 0, 20, 40 and 60 are the 20-day pending ones in "trend, live"
    // (index divisible by 10 and by 4), so 16 of its 20 count.
    expect(
      rows.find((r) => r.ruleId === 'trend' && r.status === 'live' && r.horizon === '20d')?.n,
    ).toBe(16);
  });

  it('exactly 30 cases is enough for an interval; 29 is not', () => {
    const pick = (k: number) =>
      alerts.slice(0, k).map((a) => ({ ...a, ruleId: 'edge', ruleStatus: 'live' as const }));
    const at = (k: number) => summarize(pick(k), outcomes).find((x) => x.horizon === '1d')!;
    expect(at(30)).toMatchObject({ n: 30, insufficient: false });
    expect(at(30).winCi).not.toBeNull();
    expect(at(29)).toMatchObject({ n: 29, insufficient: true, winCi: null });
  });

  it('an interval appears at 30 cases', () => {
    const many = alerts.map((a) => ({ ...a, ruleId: 'one', ruleStatus: 'live' as const }));
    const r = summarize(many, outcomes).find((x) => x.horizon === '1d')!;
    expect(r.n).toBe(80);
    expect(r.winCi).toEqual(wilson(r.wins, 80));
  });

  it('calibration bins recompute from raw outcomes, and need 30 scored cases', () => {
    const bins = calibration(alerts, outcomes, '1d', 5)!;
    expect(bins.map((b) => [b.low, b.high])).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
      [60, 80],
      [80, 100],
    ]);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(80);
    for (const b of bins) {
      const inBin = outcomes.filter((o) => {
        const s = alerts.find((a) => a.id === o.alertId)!.qualityScore!;
        return o.horizon === '1d' && s >= b.low && (s < b.high || (b.high === 100 && s <= 100));
      });
      expect(b.n).toBe(inBin.length);
      expect(b.winRate).toBeCloseTo(inBin.filter((o) => o.ret! > 0).length / inBin.length, 12);
    }
    expect(calibration(alerts.slice(0, 20), outcomes, '1d')).toBeNull();
  });
});
