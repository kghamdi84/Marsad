import { describe, expect, it } from 'vitest';
import {
  CHECKLIST,
  checklistComplete,
  exitSignals,
  parseHoldingsCsv,
  positionSize,
  rewardRisk,
  sahmTicket,
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
    ).toBe('BUY 125 RKLB LIMIT 24.15, STOP 23.70, GTC');
    expect(
      sahmTicket({ side: 'SELL', shares: 40, ticker: 'SOFI', type: 'MARKET', tif: 'DAY' }),
    ).toBe('SELL 40 SOFI MARKET, DAY');
  });
});

describe('checklist', () => {
  it('needs every item ticked', () => {
    const all = Object.fromEntries(CHECKLIST.map((c) => [c.key, true]));
    expect(checklistComplete(all)).toBe(true);
    expect(checklistComplete({ ...all, bearCaseRead: false })).toBe(false);
    expect(checklistComplete({})).toBe(false);
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
