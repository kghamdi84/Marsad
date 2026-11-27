import { describe, expect, it } from 'vitest';
import type { JournalTrade } from './journal.js';
import { weekReturn, weeklyReview, weeklyTiles } from './weekly-review.js';

const all5 = {
  cleanSetup: true,
  notExtended: true,
  riskDefined: true,
  profitPlan: true,
  bearCaseRead: true,
};
const t = (o: Partial<JournalTrade>): JournalTrade => ({
  id: 1,
  ticker: 'RKLB',
  side: 'long',
  setup: 'trend-template-breakout',
  tags: [],
  alertId: null,
  entryDate: '2026-11-10',
  entryPrice: 24,
  shares: 100,
  stop: 22,
  target: null,
  exitDate: null,
  exitPrice: null,
  checklist: all5,
  followed: { stopPlaced: true, sizedBySizer: true, exitedPerPlan: true, noEmotion: true },
  notes: '',
  screenshots: [],
  ...o,
});

describe('weeklyReview (hand-checked)', () => {
  const b = weeklyReview({
    weekEnding: '2026-11-29', // the week is 2026-11-23 to 2026-11-29
    trades: [
      t({ id: 1, exitDate: '2026-11-24', exitPrice: 28 }), // +400, +2R, all honored (10 of 10)
      t({ id: 2, exitDate: '2026-11-26', exitPrice: 23, followed: { stopPlaced: true } }), // -100, -0.5R, 7 of 10
      t({ id: 3, entryDate: '2026-11-25', setup: '' }), // opened, unnamed: 8 of 9
      t({ id: 4, exitDate: '2026-11-01', exitPrice: 30 }), // outside the week
    ],
    alerts: [
      { kind: 'halt', decision: 'push' },
      { kind: 'exit', decision: 'digest' },
      { kind: 'halt', decision: 'push' },
    ],
    feedback: [{ verdict: 'useful' }],
    scorecard: [],
    regime: 'Stress',
  });
  const lines = (h: string) => b.sections.find((s) => s.heading === h)?.lines;

  it('results: closed trades, realized USD and mean R', () => {
    expect(lines('Results')).toEqual([
      '2 trades closed, 1 winning: USD 300.00 realized.',
      'Mean +0.75R over 2 trades with a stop.',
      '1 opened.',
    ]);
  });
  it('behavior: mean adherence and the most-broken rules first', () => {
    // (100 + 70 + 88.9) / 3 = 86.3; trade 2 broke three items, trade 3 one.
    expect(lines('Behavior')?.[0]).toBe('Mean adherence 86 over 3 trades.');
    expect(lines('Behavior')?.slice(1)).toEqual([
      'Broken 1 time: No chasing, no revenge trade, no moving the stop away.',
      'Broken 1 time: The exit followed the plan (stop, target, trend break or time stop).',
      'Broken 1 time: The size came from the sizer, not from a feeling.',
    ]);
  });
  it('alerts and feedback counts, the regime, and the template label', () => {
    expect(lines('Alerts')).toEqual(['3 alerts: 1 digest, 2 push.', 'Feedback: 1 useful.']);
    expect(lines('Market')).toEqual(["Regime at the week's end: Stress."]);
    expect(lines('Rules (5 sessions)')).toEqual(['No scored alerts yet.']);
  });
  it('title and push fit their limits', () => {
    expect(b.title).toBe('Weekly review, week ending 2026-11-29');
    expect(b.pushBody).toBe('2 closed, USD 300.00; adherence 86; 4 rule breaks.');
    expect(b.kind).toBe('weekly-review');
  });
});

describe('weeklyTiles', () => {
  const base = {
    id: 1,
    ticker: 'RKLB',
    side: 'long' as const,
    setup: 'trend',
    tags: [],
    alertId: null,
    entryDate: '2026-11-17',
    entryPrice: 24,
    stop: 22,
    shares: 100,
    target: null,
    checklist: {},
    followed: {},
    exitDate: null,
    exitPrice: null,
    notes: '',
    screenshots: [],
  };
  it('counts closed trades, plan followed of touched, and the mean R (hand-checked)', () => {
    const t = weeklyTiles({
      weekEnding: '2026-11-22',
      trades: [
        // Closed in the week at 28: (28 - 24) / (24 - 22) = +2R; nothing ticked, so not followed.
        { ...base, id: 1, exitDate: '2026-11-20', exitPrice: 28 },
        // Closed at 23: -0.5R.
        { ...base, id: 2, exitDate: '2026-11-21', exitPrice: 23 },
        // Opened in the week, still open.
        { ...base, id: 3 },
        // Outside the week entirely.
        { ...base, id: 4, entryDate: '2026-10-01', exitDate: '2026-10-05', exitPrice: 30 },
      ],
    });
    expect(t).toEqual({ closed: 2, followed: 0, touched: 3, meanR: 0.75 });
  });
});

describe('weekReturn', () => {
  // Hand-checked: the week ending Sunday 2026-11-29 starts Monday 2026-11-23. Base is the Friday 2026-11-20 close
  // 500.00; end is the Friday 2026-11-27 close 510.00: 510 / 500 - 1 = 0.02 exactly (tolerance 1e-12).
  const bars = [
    { date: '2026-11-19', close: 498 },
    { date: '2026-11-20', close: 500 },
    { date: '2026-11-23', close: 505 },
    { date: '2026-11-27', close: 510 },
    { date: '2026-11-30', close: 520 },
  ];
  it('is close to close over the week, ignoring bars after it', () => {
    const r = weekReturn(bars, '2026-11-29');
    expect(r?.pct).toBeCloseTo(0.02, 12);
    expect(r).toMatchObject({ from: '2026-11-20', to: '2026-11-27' });
  });
  it('is null when the week has no close or nothing precedes it', () => {
    expect(weekReturn(bars.slice(0, 2), '2026-11-29')).toBeNull();
    expect(weekReturn(bars.slice(2), '2026-11-29')).toBeNull();
    expect(weekReturn([], '2026-11-29')).toBeNull();
  });
});
