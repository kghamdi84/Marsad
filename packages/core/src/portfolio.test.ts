import { describe, expect, it } from 'vitest';
import {
  CHECKLIST,
  CHECKLIST_V2,
  CHECKLIST_V3,
  CURRENT_CHECKLIST,
  checklistItems,
  checklistVersionOf,
  riskDefinedBlock,
  checklistComplete,
  exitSignals,
  parseHoldingsCsv,
  positionSize,
  rewardRisk,
  gapToStop,
  sahmTicket,
  markDuplicateHoldings,
  portfolioTotals,
  sessionsHeld,
  unrealized,
  type Holding,
} from './portfolio.js';
import type { DailyBar } from './study.js';

describe('positionSize (hand-checked)', () => {
  it('sizes from the risk budget and the stop distance', () => {
    // USD 50,000 at 1% is USD 500; 24.15 - 23.70 = 0.45 a share; 500 / 0.45 = 1,111.1, so 1,111 shares.
    // 1,111 x 24.15 = USD 26,830.65, over the 25% cap of USD 12,500: capped at 517 shares (12,500 / 24.15 = 517.6).
    const r = positionSize({ account: 50_000, riskPct: 0.01, entry: 24.15, stop: 23.7 });
    expect(r).toMatchObject({ shares: 517, capped: true });
    if ('error' in r) throw new Error(r.error);
    expect(r.risk).toBeCloseTo(517 * 0.45, 9);
    expect(r.positionValue).toBeCloseTo(517 * 24.15, 9);
  });

  it('uses the risk size when it is under the cap', () => {
    // USD 50,000 at 0.5% = 250; stop distance 2.00 = 125 shares; 125 x 24.15 = 3,018.75 (6% of the account).
    const r = positionSize({ account: 50_000, riskPct: 0.005, entry: 24.15, stop: 22.15 });
    expect(r).toMatchObject({ shares: 125, capped: false });
  });

  it('refuses impossible inputs with a reason', () => {
    expect(positionSize({ account: 50_000, riskPct: 0.01, entry: 24, stop: 25 })).toEqual({
      error: 'For a long trade the stop must be below the entry.',
    });
    expect(positionSize({ account: 50_000, riskPct: 0.1, entry: 24, stop: 23 })).toHaveProperty(
      'error',
    );
    expect(positionSize({ account: 100, riskPct: 0.01, entry: 500, stop: 400 })).toEqual({
      error: 'The risk budget buys less than one share at this stop distance.',
    });
  });

  it('reward-to-risk per target', () => {
    // Entry 24.15, stop 23.70 (risk 0.45); targets 25.05 and 26.40: 2.0R and 5.0R.
    const rr = rewardRisk(24.15, 23.7, [25.05, 26.4]);
    expect(rr[0]).toBeCloseTo(2, 9);
    expect(rr[1]).toBeCloseTo(5, 9);
  });

  it('gap to stop (hand-checked, tolerance 1e-9)', () => {
    // Close 388.90 against a stop of 390.00: 388.90 / 390 - 1 = -1.10 / 390 = -0.0028205128 (-0.28%).
    expect(gapToStop(388.9, 390)).toBeCloseTo(-0.0028205128, 9);
    // 101 against 95: 6 / 95 = 0.0631578947 (+6.32%).
    expect(gapToStop(101, 95)).toBeCloseTo(0.0631578947, 9);
    expect(gapToStop(95, 95)).toBe(0);
    // No positive stop or price: no number rather than a wrong one.
    expect(gapToStop(100, 0)).toBeNull();
    expect(gapToStop(0, 95)).toBeNull();
    expect(gapToStop(Number.NaN, 95)).toBeNull();
  });
});

describe('Sahm ticket', () => {
  it('matches the brief’s example', () => {
    expect(
      sahmTicket({
        side: 'BUY',
        shares: 125,
        ticker: 'RKLB',
        type: 'LIMIT',
        limit: 24.15,
        stop: 23.7,
        tif: 'GTC',
      }),
    ).toBe('BUY 125 RKLB LIMIT 24.15 STOP 23.70 GTC');
    expect(
      sahmTicket({ side: 'SELL', shares: 40, ticker: 'SOFI', type: 'MARKET', tif: 'DAY' }),
    ).toBe('SELL 40 SOFI MARKET DAY');
  });
});

describe('checklist', () => {
  it('needs every item ticked (checklist-1)', () => {
    const all = Object.fromEntries(CHECKLIST.map((c) => [c.key, true]));
    expect(checklistComplete(all, 'checklist-1')).toBe(true);
    expect(checklistComplete({ ...all, bearCaseRead: false }, 'checklist-1')).toBe(false);
    expect(checklistComplete({}, 'checklist-1')).toBe(false);
  });
  // Until ADR 0048 round 2 this was the default; checklist-3 is now (below), so the version is passed explicitly.
  it('checklist-2: its five ticks complete it; checklist-1 ticks do not', () => {
    const v1 = Object.fromEntries(CHECKLIST.map((c) => [c.key, true]));
    const v2 = Object.fromEntries(CHECKLIST_V2.map((c) => [c.key, true]));
    expect(checklistComplete(v2, 'checklist-2')).toBe(true);
    expect(checklistComplete(v1, 'checklist-2')).toBe(false);
    expect(checklistComplete(v1)).toBe(false);
    expect(checklistComplete(v1, 'checklist-1')).toBe(true);
    expect(checklistComplete({ ...v2, manualInSahm: false }, 'checklist-2')).toBe(false);
  });
  it('checklist-1 and checklist-2 are unchanged (stored trades keep their wording)', () => {
    expect(checklistItems('checklist-1').map((c) => [c.key, c.label])).toEqual([
      ['cleanSetup', 'The setup is clean: it matches a written rule, not a feeling.'],
      ['notExtended', 'Price is not extended: within the chase limit of the signal.'],
      ['riskDefined', 'Risk is defined: the stop is set and the size comes from it.'],
      ['profitPlan', 'There is a profit plan: targets and when to take them.'],
      ['bearCaseRead', 'I read the bear case and the exit conditions.'],
    ]);
    expect(checklistItems(undefined)).toBe(CHECKLIST);
    expect(checklistItems('checklist-2').map((c) => [c.key, c.label])).toEqual([
      ['regimeFit', 'Fits the current regime'],
      ['structuralStop', 'Stop set from structure, not hope'],
      ['bearCaseEarnings', 'Bear case and earnings date read'],
      ['shariahChecked', 'Shariah aid checked'],
      ['manualInSahm', 'Order will be entered by hand in Sahm'],
    ]);
  });
  it('checklist-3 is current: checklist-2 plus riskDefined and profitPlan, worded as in checklist-1', () => {
    expect(CURRENT_CHECKLIST).toBe('checklist-3');
    expect(checklistItems('checklist-3').map((c) => [c.key, c.label])).toEqual([
      ['regimeFit', 'Fits the current regime'],
      ['structuralStop', 'Stop set from structure, not hope'],
      ['bearCaseEarnings', 'Bear case and earnings date read'],
      ['shariahChecked', 'Shariah aid checked'],
      ['manualInSahm', 'Order will be entered by hand in Sahm'],
      ['riskDefined', 'Risk is defined: the stop is set and the size comes from it.'],
      ['profitPlan', 'There is a profit plan: targets and when to take them.'],
    ]);
    const v2 = Object.fromEntries(CHECKLIST_V2.map((c) => [c.key, true]));
    const v3 = Object.fromEntries(CHECKLIST_V3.map((c) => [c.key, true]));
    // The default is checklist-3: checklist-2's five ticks are not enough.
    expect(checklistComplete(v2)).toBe(false);
    expect(checklistComplete(v3)).toBe(true);
    expect(checklistComplete({ ...v3, profitPlan: false })).toBe(false);
  });
  it('reads a stored version; anything else answered checklist-1', () => {
    expect(checklistVersionOf('checklist-3')).toBe('checklist-3');
    expect(checklistVersionOf('checklist-2')).toBe('checklist-2');
    expect(checklistVersionOf('checklist-1')).toBe('checklist-1');
    expect(checklistVersionOf(null)).toBe('checklist-1');
    expect(checklistVersionOf('checklist-9')).toBe('checklist-1');
  });
  it('risk defined: a stop, and the ticket at or below the sizer for that stop (hand-checked)', () => {
    expect(riskDefinedBlock({ stop: null, sizerShares: 125, ticketShares: 125 })).toBe('no-stop');
    expect(riskDefinedBlock({ stop: 0, sizerShares: 125, ticketShares: 125 })).toBe('no-stop');
    expect(riskDefinedBlock({ stop: 22.15, sizerShares: null, ticketShares: null })).toBe(
      'no-size',
    );
    expect(riskDefinedBlock({ stop: 22.15, sizerShares: 125, ticketShares: 0 })).toBe('no-size');
    expect(riskDefinedBlock({ stop: 22.15, sizerShares: 125, ticketShares: 125 })).toBeNull();
    expect(riskDefinedBlock({ stop: 22.15, sizerShares: 125, ticketShares: 100 })).toBeNull();
    expect(riskDefinedBlock({ stop: 22.15, sizerShares: 125, ticketShares: 126 })).toBe(
      'over-size',
    );
  });
});

describe('parseHoldingsCsv', () => {
  it('reads valid rows and names each problem by line', () => {
    const csv = [
      'ticker,shares,cost_basis,opened_on,stop,targets,trend_break,time_stop_sessions',
      'rklb,125,24.15,2026-10-01,23.70,26.40;28,sma50,30',
      'SOFI,40,18.5,2026-09-15,,,,',
      'bad ticker,0,x,2026/1/1,,,',
    ].join('\n');
    const r = parseHoldingsCsv(csv);
    expect(r.holdings).toEqual([
      {
        ticker: 'RKLB',
        shares: 125,
        costBasis: 24.15,
        openedOn: '2026-10-01',
        stop: 23.7,
        targets: [26.4, 28],
        trendBreak: { ind: 'sma', period: 50 },
        timeStopSessions: 30,
      },
      {
        ticker: 'SOFI',
        shares: 40,
        costBasis: 18.5,
        openedOn: '2026-09-15',
        stop: null,
        targets: [],
        trendBreak: null,
        timeStopSessions: null,
      },
    ]);
    expect(r.errors).toEqual(['Line 4: check ticker, shares, cost_basis, opened_on (YYYY-MM-DD).']);
  });
  it('needs the four required columns', () => {
    expect(parseHoldingsCsv('ticker,shares\nNVDA,1').errors).toEqual([
      'Missing columns: cost_basis, opened_on.',
    ]);
  });
});

function bars(closes: number[], from = 1): DailyBar[] {
  return closes.map((close, i) => ({
    date: `2026-10-${String(from + i).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    vwap: null,
  }));
}

describe('exitSignals (hand-checked)', () => {
  const h: Holding = {
    ticker: 'RKLB',
    shares: 100,
    costBasis: 24,
    openedOn: '2026-10-01',
    stop: 22,
    targets: [27, 30],
    trendBreak: { ind: 'sma', period: 3 },
    timeStopSessions: 5,
  };
  it('a stop and a trend break on the same close', () => {
    // Last three closes 25, 24, 21.5: SMA(3) = 23.5; close 21.5 is below it and below the stop 22.
    expect(exitSignals(h, bars([24, 25, 24, 21.5])).map((e) => e.kind)).toEqual([
      'stop',
      'trend-break',
    ]);
  });
  it('a target, and no time stop once a target is reached', () => {
    const s = exitSignals(h, bars([24, 25, 26, 27.5, 28, 28.2]));
    expect(s.map((e) => e.kind)).toEqual(['target']);
    expect(s[0]?.detail).toBe(
      'Closed at 28.20, at or above target 27.00: take profits as planned.',
    );
  });
  it('the time stop after 5 sessions after the opening day without a target', () => {
    // Opened 2026-10-01; sessions after it: 10-02 .. 10-06 = 5.
    expect(
      exitSignals({ ...h, trendBreak: null }, bars([24, 24.5, 24.2, 24.4, 24.6, 24.8])).map(
        (e) => e.kind,
      ),
    ).toEqual(['time-stop']);
    expect(
      exitSignals({ ...h, trendBreak: null }, bars([24, 24.5, 24.2, 24.4, 24.6])).map(
        (e) => e.kind,
      ),
    ).toEqual([]);
  });
  it('unrealized result', () => {
    expect(unrealized({ shares: 100, costBasis: 24 }, 27)).toEqual({ usd: 300, pct: 27 / 24 - 1 });
  });
});

describe('portfolioTotals (hand-checked)', () => {
  it('sums value and cost of priced holdings and lists the rest', () => {
    // 10 RKLB bought at 20, now 25 (value 250, cost 200); 4 SOFI bought at 10, now 8 (value 32, cost 40);
    // HOOD has no price. Value 282, cost 240, gain 42, gain on cost 42 / 240 = 17.5%.
    const prices: Record<string, number> = { RKLB: 25, SOFI: 8 };
    const r = portfolioTotals(
      [
        { ticker: 'RKLB', shares: 10, costBasis: 20 },
        { ticker: 'SOFI', shares: 4, costBasis: 10 },
        { ticker: 'HOOD', shares: 3, costBasis: 30 },
      ],
      (t) => prices[t] ?? null,
    );
    expect(r.value).toBe(282);
    expect(r.cost).toBe(240);
    expect(r.gainUsd).toBe(42);
    expect(r.gainPct).toBeCloseTo(0.175, 12);
    expect(r.unpriced).toEqual(['HOOD']);
  });

  it('gives no percentage when nothing is priced', () => {
    const r = portfolioTotals([{ ticker: 'X', shares: 1, costBasis: 5 }], () => null);
    expect(r).toMatchObject({ value: 0, cost: 0, gainUsd: 0, gainPct: null, unpriced: ['X'] });
  });
});

describe('sessionsHeld and markDuplicateHoldings (hand-checked)', () => {
  it('counts the bars after the opening date', () => {
    const bars = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'].map((date) => ({ date }));
    expect(sessionsHeld(bars, '2026-10-01')).toBe(3); // the 2nd, 5th and 6th
    expect(sessionsHeld(bars, '2026-10-06')).toBe(0);
  });

  it('marks rows already stored or repeated in the file', () => {
    const a = { ticker: 'RKLB', openedOn: '2026-10-01', shares: 100, costBasis: 24 };
    const b = { ticker: 'SOFI', openedOn: '2026-09-15', shares: 40, costBasis: 18.5 };
    const c = { ticker: 'RKLB', openedOn: '2026-10-01', shares: 50, costBasis: 24 }; // a different lot
    expect(markDuplicateHoldings([a], [a, b, b, c])).toEqual([true, false, true, false]);
  });
});
