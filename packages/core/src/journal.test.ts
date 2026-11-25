import { describe, expect, it } from 'vitest';
import {
  adherence,
  adherenceVsResult,
  pnl,
  rMultiple,
  screenshotPath,
  statsBySetup,
  type JournalTrade,
} from './journal.js';

const all5 = {
  cleanSetup: true,
  notExtended: true,
  riskDefined: true,
  profitPlan: true,
  bearCaseRead: true,
};
const t = (over: Partial<JournalTrade> = {}): JournalTrade => ({
  id: 1,
  ticker: 'RKLB',
  side: 'long',
  setup: 'trend-template-breakout',
  tags: [],
  alertId: null,
  entryDate: '2026-11-02',
  entryPrice: 24,
  shares: 100,
  stop: 22,
  target: 30,
  exitDate: null,
  exitPrice: null,
  checklist: all5,
  followed: { stopPlaced: true, sizedBySizer: true, noEmotion: true },
  notes: '',
  screenshots: [],
  ...over,
});

describe('adherence (hand-checked)', () => {
  it('an open trade with everything honored scores 100 of 9 items', () => {
    // 5 checklist + 3 followed (the exit item waits for the close) + a named setup = 9.
    expect(adherence(t())).toMatchObject({ score: 100, honored: 9, applicable: 9, broken: [] });
  });

  it('a closed trade adds the exit item; unanswered counts as not honored', () => {
    const a = adherence(
      t({ exitDate: '2026-11-10', exitPrice: 21, followed: { stopPlaced: true } }),
    );
    // 10 items: 5 checklist + stopPlaced honored + setup named = 7; sizedBySizer, exitedPerPlan, noEmotion not.
    expect(a).toMatchObject({ honored: 7, applicable: 10, score: 70 });
    expect(a.broken).toEqual([
      'The size came from the sizer, not from a feeling.',
      'The exit followed the plan (stop, target, trend break or time stop).',
      'No chasing, no revenge trade, no moving the stop away.',
    ]);
    expect(a.principles.find((p) => p.key === 'risk')).toEqual({
      key: 'risk',
      label: 'Strict risk',
      honored: 2,
      applicable: 3,
    });
    expect(a.principles.find((p) => p.key === 'profits')).toMatchObject({
      honored: 0,
      applicable: 1,
    });
  });

  it('the profits principle is left out while the trade is open; an unnamed setup breaks "clean setups"', () => {
    const a = adherence(t({ setup: '  ' }));
    expect(a.principles.map((p) => p.key)).toEqual([
      'patience',
      'process',
      'risk',
      'setups',
      'emotion',
    ]);
    expect(a.broken).toEqual(['The trade names a written setup.']);
    expect(a.score).toBeCloseTo((100 * 8) / 9, 12);
  });
});

describe('rMultiple and pnl (hand-checked)', () => {
  it('long: (27 - 24) / (24 - 22) = 1.5R; USD 300 on 100 shares', () => {
    const c = t({ exitDate: '2026-11-10', exitPrice: 27 });
    expect(rMultiple(c)).toBeCloseTo(1.5, 12);
    expect(pnl(c)).toBeCloseTo(300, 9);
  });
  it('short: entry 50, stop 55, exit 45 is +1R', () => {
    expect(
      rMultiple(t({ side: 'short', entryPrice: 50, stop: 55, exitPrice: 45, exitDate: 'x' })),
    ).toBeCloseTo(1, 12);
  });
  it('null while open, without a stop, or with a stop on the wrong side', () => {
    expect(rMultiple(t())).toBeNull();
    expect(rMultiple(t({ stop: null, exitPrice: 27, exitDate: 'x' }))).toBeNull();
    expect(rMultiple(t({ stop: 25, exitPrice: 27, exitDate: 'x' }))).toBeNull();
    expect(pnl(t())).toBeNull();
  });
});

describe('statsBySetup and adherenceVsResult', () => {
  const trades = [
    t({ id: 1, exitDate: '2026-11-10', exitPrice: 28 }), // +2R, +400
    t({ id: 2, exitDate: '2026-11-11', exitPrice: 22 }), // -1R, -200
    t({
      id: 3,
      setup: 'insider-cluster-buying',
      exitDate: '2026-11-12',
      exitPrice: 25,
      stop: null,
    }), // +100, no R
    t({ id: 4 }), // open
  ];
  it('groups by setup with an "All trades" row first', () => {
    const s = statsBySetup(trades);
    expect(s.map((x) => x.setup)).toEqual([
      'All trades',
      'insider-cluster-buying',
      'trend-template-breakout',
    ]);
    expect(s[0]).toMatchObject({
      closed: 3,
      open: 1,
      wins: 2,
      rCount: 2,
      totalPnl: 300,
      insufficient: true,
    });
    expect(s[0]?.meanR).toBeCloseTo(0.5, 12);
    expect(s[2]).toMatchObject({ closed: 2, open: 1, wins: 1, winRate: 0.5 });
    // Closed trades: exitedPerPlan unanswered, so 9 of 10 items each: 90.
    expect(s[2]?.meanAdherence).toBeCloseTo(90, 12);
  });
  it('compares mean R above and below an adherence of 80, and says when there is too little', () => {
    const r = adherenceVsResult(trades);
    expect(r.high.n).toBe(2);
    expect(r.high.meanR).toBeCloseTo(0.5, 12);
    expect(r.low).toEqual({ n: 0, meanR: null });
    expect(r.insufficient).toBe(true);
  });
});

describe('screenshotPath', () => {
  it('starts with the owner folder that the bucket policy checks', () => {
    expect(screenshotPath('u1', 7, 2, 'image/png')).toBe('u1/trade-7-2.png');
    expect(screenshotPath('u1', 7, 3, 'image/jpeg')).toBe('u1/trade-7-3.jpg');
  });
});
