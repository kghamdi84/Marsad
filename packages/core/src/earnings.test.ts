import { describe, expect, it } from 'vitest';
import factsFixture from '../../../fixtures/sec/companyfacts-NVDA-trimmed.json';
import submissions from '../../../fixtures/sec/submissions-NVDA-trimmed.json';
import { parseCompanyFacts } from './adapters/sec-facts.js';
import {
  EARNINGS_VERSION,
  buildEarningsHistory,
  earningsMove,
  summarizeMoves,
  type EarningsFiling,
  type EarningsRow,
} from './earnings.js';
import { summarizeFinancials, type Metric, type QuarterRow } from './fundamentals.js';
import type { DailyBar } from './study.js';

// All arithmetic below is done by hand and written next to the expectation. The bars are invented round numbers
// (a release time, a close before and a close after); only the 8-K in the last block is a real recorded filing.

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  vwap: close,
});

const metric = (value: number | null, filed: string | null): Metric => ({
  value,
  filed,
  accession: filed ? `acc-${filed}` : null,
  derived: false,
});

function quarter(end: string, filed: string | null): QuarterRow {
  return {
    end,
    revenue: metric(1000, filed),
    grossProfit: metric(null, null),
    operatingIncome: metric(null, null),
    netIncome: metric(null, null),
    epsDiluted: metric(1.5, filed),
    grossMarginPct: null,
    operatingMarginPct: null,
    netMarginPct: null,
    revenueYoYPct: 12.5,
  };
}

function eightK(accession: string, acceptedAt: string, items: string[] = ['2.02', '9.01']) {
  return {
    accession,
    form: '8-K',
    filingDate: acceptedAt.slice(0, 10),
    acceptedAt,
    items,
  } satisfies EarningsFiling;
}

describe('which session reacts to a release', () => {
  // 2026-08-26 is a Wednesday and August is on daylight time (ET = UTC - 4).
  const bars = [bar('2026-08-25', 100), bar('2026-08-26', 120), bar('2026-08-27', 93)];

  it('after the close: the next session, measured from the release day close', () => {
    // 20:20 UTC = 16:20 ET. 120 -> 93 is -27/120 = -22.5%.
    const r = earningsMove(eightK('a', '2026-08-26T20:20:00Z'), bars, []);
    expect(r).toMatchObject({
      move: {
        baseDate: '2026-08-26',
        reactionDate: '2026-08-27',
        baseClose: 120,
        reactionClose: 93,
      },
    });
    expect('move' in r && r.move.pct).toBeCloseTo(-22.5, 10);
    expect('move' in r && r.move.large).toBe(false);
  });

  it('exactly at 16:00 ET counts as after the close', () => {
    const r = earningsMove(eightK('a', '2026-08-26T20:00:00Z'), bars, []);
    expect('move' in r && r.move.reactionDate).toBe('2026-08-27');
  });

  it('labels the timing at the edges: 09:29:59 before the open, 09:30:00 and 15:59:59 in the session, 16:00:00 after', () => {
    // August is on daylight time: ET = UTC - 4.
    const timing = (at: string) =>
      buildEarningsHistory({
        quarters: [quarter('2026-07-26', '2026-08-30')],
        filings: [eightK('x', at)],
        bars,
        splits: [],
      }).rows[0]?.release?.timing;
    expect(timing('2026-08-26T13:29:59Z')).toBe('before-open');
    expect(timing('2026-08-26T13:30:00Z')).toBe('during-session');
    expect(timing('2026-08-26T19:59:59Z')).toBe('during-session');
    expect(timing('2026-08-26T20:00:00Z')).toBe('after-close');
  });

  it('before the open: that day, measured from the previous close', () => {
    // 11:00 UTC = 07:00 ET. 100 -> 120 is +20/100 = +20%.
    const r = earningsMove(eightK('a', '2026-08-26T11:00:00Z'), bars, []);
    expect(r).toMatchObject({ move: { baseDate: '2026-08-25', reactionDate: '2026-08-26' } });
    expect('move' in r && r.move.pct).toBeCloseTo(20, 10);
  });

  it('during the session: that day, measured from the previous close', () => {
    // 17:00 UTC = 13:00 ET.
    const r = earningsMove(eightK('a', '2026-08-26T17:00:00Z'), bars, []);
    expect(r).toMatchObject({ move: { baseDate: '2026-08-25', reactionDate: '2026-08-26' } });
  });

  it('a Friday after-close release reacts on Monday, from Friday', () => {
    // 2026-08-28 is a Friday; Monday is the 31st. 120 -> 126 is +5%.
    const wk = [bar('2026-08-27', 100), bar('2026-08-28', 120), bar('2026-08-31', 126)];
    const r = earningsMove(eightK('a', '2026-08-28T21:00:00Z'), wk, []);
    expect(r).toMatchObject({ move: { baseDate: '2026-08-28', reactionDate: '2026-08-31' } });
    expect('move' in r && r.move.pct).toBeCloseTo(5, 10);
  });

  it('winter time is read correctly (ET = UTC - 5): 21:10 UTC is 16:10 ET, after the close', () => {
    const w = [bar('2026-01-27', 50), bar('2026-01-28', 40)];
    const r = earningsMove(eightK('a', '2026-01-27T21:10:00Z'), w, []);
    expect(r).toMatchObject({ move: { baseDate: '2026-01-27', reactionDate: '2026-01-28' } });
    expect('move' in r && r.move.pct).toBeCloseTo(-20, 10);
    // 20:50 UTC is 15:50 ET, still in the session: the same day reacts.
    const during = earningsMove(eightK('a', '2026-01-27T20:50:00Z'), w, []);
    expect(during).toMatchObject({ gap: 'outside-bars' }); // no bar before 2026-01-27 to measure from
  });

  it('flags a move above 25% and does not flag exactly 25%', () => {
    const big = earningsMove(
      eightK('a', '2026-08-26T20:20:00Z'),
      [bar('2026-08-26', 100), bar('2026-08-27', 131)],
      [],
    );
    expect('move' in big && big.move.large).toBe(true);
    const edge = earningsMove(
      eightK('a', '2026-08-26T20:20:00Z'),
      [bar('2026-08-26', 100), bar('2026-08-27', 125)],
      [],
    );
    expect('move' in edge && edge.move.pct).toBe(25);
    expect('move' in edge && edge.move.large).toBe(false);
  });
});

describe('why a move is not shown', () => {
  const bars = [bar('2026-08-25', 100), bar('2026-08-26', 120), bar('2026-08-27', 93)];
  it('no acceptance time: the session is unknown', () => {
    const f = { ...eightK('a', '2026-08-26T20:20:00Z'), acceptedAt: null };
    expect(earningsMove(f, bars, [])).toEqual({ gap: 'no-time' });
  });
  it('release before the first stored bar', () => {
    expect(earningsMove(eightK('a', '2026-08-20T20:20:00Z'), bars, [])).toEqual({
      gap: 'outside-bars',
    });
  });
  it('release after the last stored bar: the reacting session has no bar yet', () => {
    expect(earningsMove(eightK('a', '2026-08-27T20:20:00Z'), bars, [])).toEqual({
      gap: 'not-yet',
    });
  });
  it('a split between the two closes: not computed', () => {
    const split = { executionDate: '2026-08-27', splitFrom: 1, splitTo: 10 };
    expect(earningsMove(eightK('a', '2026-08-26T20:20:00Z'), bars, [split])).toEqual({
      gap: 'split',
    });
    // A split before the base close does not touch the window.
    const earlier = { executionDate: '2026-08-26', splitFrom: 1, splitTo: 10 };
    expect(earningsMove(eightK('a', '2026-08-26T20:20:00Z'), bars, [earlier])).toHaveProperty(
      'move',
    );
  });
  it('a hole in the bars: the previous bar is not the previous session', () => {
    const holes = [bar('2026-08-10', 100), bar('2026-08-27', 93)];
    expect(earningsMove(eightK('a', '2026-08-26T20:20:00Z'), holes, [])).toEqual({
      gap: 'missing-bars',
    });
  });
});

describe('joining quarters to their releases', () => {
  const bars = [
    bar('2026-04-29', 80),
    bar('2026-04-30', 80),
    bar('2026-05-01', 88),
    bar('2026-08-25', 100),
    bar('2026-08-26', 120),
    bar('2026-08-27', 93),
  ];
  // Q1 ended 2026-04-26 and was filed 2026-05-20; its release was 2026-04-30 after the close.
  // Q2 ended 2026-07-26 and was filed 2026-08-26 (the same day as the release, before the open).
  const quarters = [quarter('2026-07-26', '2026-08-26'), quarter('2026-04-26', '2026-05-20')];
  const filings = [
    eightK('q2', '2026-08-26T11:00:00Z'),
    eightK('q1', '2026-04-30T20:30:00Z'),
    // Not earnings: an amendment and an 8-K without Item 2.02 are ignored.
    { ...eightK('amend', '2026-04-28T12:00:00Z'), form: '8-K/A' },
    eightK('other', '2026-05-03T12:00:00Z', ['7.01']),
    // A second 2.02 inside the same window does not replace the first.
    eightK('dup', '2026-05-10T12:00:00Z'),
    // A second 2.02 on the day the Q2 10-Q was filed is not a new release (it is not after the newest filing).
    eightK('dup2', '2026-08-26T20:10:00Z'),
  ];
  const h = buildEarningsHistory({ quarters, filings, bars, splits: [] });

  it('lists quarters oldest first, each with the earliest 2.02 in its window', () => {
    expect(h.formulaVersion).toBe(EARNINGS_VERSION);
    expect(h.rows.map((r) => [r.quarterEnd, r.release?.accession])).toEqual([
      ['2026-04-26', 'q1'],
      ['2026-07-26', 'q2'],
    ]);
  });
  it('measures each reaction: Q1 80 -> 88 is +10%; Q2 (before open) 100 -> 120 is +20%', () => {
    expect(h.rows[0]?.move?.pct).toBeCloseTo(10, 10);
    expect(h.rows[0]?.release?.timing).toBe('after-close');
    expect(h.rows[1]?.move?.pct).toBeCloseTo(20, 10);
    expect(h.rows[1]?.release?.timing).toBe('before-open');
  });
  it('the extra 2.02s are not listed as releases without results', () => {
    expect(h.rows).toHaveLength(2);
  });
  it('carries the reported figures through unchanged', () => {
    expect(h.rows[0]?.revenue.value).toBe(1000);
    expect(h.rows[0]?.epsDiluted.value).toBe(1.5);
    expect(h.rows[0]?.revenueYoYPct).toBe(12.5);
  });
  it('a prior-year quarter repeated in a later filing does not take the release', () => {
    // The 2025 quarters are restated as comparatives in the 2026 filings, so they carry a late "filed" date
    // (this is what the real NVIDIA facts do). The release still belongs to the quarter that ended just before it.
    const withComparatives = [
      quarter('2025-07-27', '2026-08-26'),
      quarter('2025-10-26', '2026-08-26'),
      ...quarters,
    ];
    const c = buildEarningsHistory({ quarters: withComparatives, filings, bars, splits: [] });
    const byEnd = Object.fromEntries(
      c.rows.map((r) => [r.quarterEnd, r.release?.accession ?? null]),
    );
    expect(byEnd).toEqual({
      '2025-07-27': null,
      '2025-10-26': null,
      '2026-04-26': 'q1',
      '2026-07-26': 'q2',
    });
  });
  it('a release 95 days after the newest quarter still matches it; 96 days is a quarter not reported yet', () => {
    // 2026-07-26 + 95 days = 2026-10-29; + 96 days = 2026-10-30. Both after the close, so no bar is needed here.
    const at95 = buildEarningsHistory({
      quarters: [quarter('2026-07-26', '2026-08-26')],
      filings: [eightK('x', '2026-10-29T12:00:00Z')],
      bars,
      splits: [],
    });
    expect(at95.rows.map((r) => [r.quarterEnd, r.release?.accession])).toEqual([
      ['2026-07-26', 'x'],
    ]);
    const at96 = buildEarningsHistory({
      quarters: [quarter('2026-07-26', '2026-08-26')],
      filings: [eightK('x', '2026-10-30T12:00:00Z')],
      bars,
      splits: [],
    });
    expect(at96.rows.map((r) => [r.quarterEnd, r.release?.accession])).toEqual([
      ['2026-07-26', undefined],
      [null, 'x'],
    ]);
  });
  it('a release on the very day a quarter ended belongs to the quarter before it', () => {
    // Q1 ended 2026-04-26 and Q2 ends 2026-07-26: a 2.02 accepted on 2026-07-26 reports Q1 (91 days earlier), not Q2.
    const day = buildEarningsHistory({
      quarters,
      filings: [eightK('on-the-day', '2026-07-26T12:00:00Z')],
      bars,
      splits: [],
    });
    expect(day.rows.map((r) => [r.quarterEnd, r.release?.accession])).toEqual([
      ['2026-04-26', 'on-the-day'],
      ['2026-07-26', undefined],
    ]);
  });
  it('an old release before every quarter shown is not listed as a pending one', () => {
    const old = buildEarningsHistory({
      quarters,
      filings: [eightK('old', '2026-01-10T12:00:00Z')],
      bars,
      splits: [],
    });
    expect(old.rows.map((r) => r.quarterEnd)).toEqual(['2026-04-26', '2026-07-26']);
  });
  it('a quarter with no stored release says so instead of guessing from the 10-Q date', () => {
    const none = buildEarningsHistory({ quarters, filings: [], bars, splits: [] });
    expect(none.rows.map((r) => [r.release, r.move, r.moveGap])).toEqual([
      [null, null, 'no-release'],
      [null, null, 'no-release'],
    ]);
    expect(none.summary).toMatchObject({ n: 0, meanAbsPct: null });
  });
  it('a 2.02 filed after the newest results is a pending row with its own move', () => {
    // 2026-11-17 21:20 UTC is 16:20 ET, after the close, so 2026-11-18 reacts: 200 -> 210 is +5%.
    const p = buildEarningsHistory({
      quarters,
      filings: [...filings, eightK('next', '2026-11-17T21:20:00Z')],
      bars: [...bars, bar('2026-11-17', 200), bar('2026-11-18', 210)],
      splits: [],
    });
    const last = p.rows.at(-1);
    expect(last).toMatchObject({ quarterEnd: null, release: { accession: 'next' } });
    expect(last?.revenue.value).toBeNull();
    expect(last?.move?.pct).toBeCloseTo(5, 10);
    expect(p.rows).toHaveLength(3);
  });
});

describe('summary of moves', () => {
  const row = (pct: number | null): EarningsRow => ({
    quarterEnd: 'x',
    revenue: metric(null, null),
    epsDiluted: metric(null, null),
    revenueYoYPct: null,
    release: null,
    move:
      pct === null
        ? null
        : { baseDate: 'a', baseClose: 1, reactionDate: 'b', reactionClose: 1, pct, large: false },
    moveGap: pct === null ? 'no-release' : null,
  });
  it('counts direction and averages the size: +10, -22.5, +5, and one report without a move', () => {
    // (10 + 22.5 + 5) / 3 = 12.5
    const s = summarizeMoves([row(10), row(-22.5), row(5), row(null), row(0)]);
    expect(s).toEqual({ n: 4, up: 2, down: 1, unchanged: 1, meanAbsPct: 9.375, smallSample: true });
  });
  it('stays marked small until there are 30 reports', () => {
    expect(summarizeMoves(Array.from({ length: 29 }, () => row(1))).smallSample).toBe(true);
    expect(summarizeMoves(Array.from({ length: 30 }, () => row(1))).smallSample).toBe(false);
  });
});

describe('the real NVIDIA filings (recorded 2026-11-24)', () => {
  const recent = submissions.body.filings.recent;
  const filings: EarningsFiling[] = recent.form.map((form: string, i: number) => ({
    accession: recent.accessionNumber[i] as string,
    form,
    filingDate: recent.filingDate[i] as string,
    acceptedAt: recent.acceptanceDateTime[i] as string,
    items: ((recent.items[i] as string) || '').split(',').filter(Boolean),
  }));
  const quarters = summarizeFinancials(
    parseCompanyFacts(factsFixture.body).facts,
    '2026-11-24',
  ).quarters;

  it('finds the real 2026-11-17 results 8-K and shows it as a release without results yet', () => {
    // Accepted 2026-11-17 21:20:51 UTC = 16:20:51 ET: after the close, so the reaction is 2026-11-18.
    // The 10-Q for the quarter ended 2026-10-25 is not filed yet, so no quarter row can claim it.
    // Closes below are invented: 200 -> 210 is +5%.
    const bars = [bar('2026-11-16', 190), bar('2026-11-17', 200), bar('2026-11-18', 210)];
    const h = buildEarningsHistory({ quarters, filings, bars, splits: [] });
    const last = h.rows.at(-1);
    expect(last?.quarterEnd).toBeNull();
    expect(last?.release).toMatchObject({ date: '2026-11-17', timing: 'after-close' });
    expect(last?.move?.pct).toBeCloseTo(5, 10);
    // The reported quarters carry real figures: the quarter ended 2026-07-26 had revenue of $96.221 billion.
    expect(h.rows.find((r) => r.quarterEnd === '2026-07-26')?.revenue.value).toBe(96_221_000_000);
  });
});
