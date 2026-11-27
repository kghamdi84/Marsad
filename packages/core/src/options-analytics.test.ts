import { describe, expect, it } from 'vitest';
import {
  UNUSUAL_LIMITS,
  impliedVsRealized,
  ivAtDelta,
  ivCrushWarning,
  putCallRatios,
  skew25,
  termStructure,
  unusualActivity,
} from './options-analytics.js';

describe('term structure (options-2), hand-checked', () => {
  // 20 days at 30% and 40 days at 25%: total variance 0.09 x 20 = 1.8 and 0.0625 x 40 = 2.5; at 30 days
  // 1.8 + (2.5 - 1.8) x 10 / 20 = 2.15, so IV30 = sqrt(2.15 / 30) = 0.267706...
  const t = termStructure([
    { dte: 40, iv: 0.25 },
    { dte: 20, iv: 0.3 },
  ]);
  it('interpolates 30-day IV in total variance and reads the slope', () => {
    expect(t.iv30).toBeCloseTo(Math.sqrt(2.15 / 30), 12);
    expect(t.slope).toBeCloseTo(-0.05, 12);
    expect(t.inverted).toBe(true);
  });
  it('says nothing it cannot support', () => {
    expect(termStructure([{ dte: 45, iv: 0.2 }])).toMatchObject({
      iv30: null,
      slope: null,
      inverted: null,
    });
  });
});

describe('25-delta skew, hand-checked', () => {
  const chain = [
    { type: 'put' as const, delta: -0.2, iv: 0.32 },
    { type: 'put' as const, delta: -0.3, iv: 0.3 },
    { type: 'call' as const, delta: 0.2, iv: 0.24 },
    { type: 'call' as const, delta: 0.3, iv: 0.26 },
  ];
  it('interpolates each wing at 25 delta: put 0.31, call 0.25; skew 0.06, 0.24 of ATM 0.25', () => {
    expect(ivAtDelta(chain, 'put')).toBeCloseTo(0.31, 12);
    expect(ivAtDelta(chain, 'call')).toBeCloseTo(0.25, 12);
    const s = skew25(chain, 0.25);
    expect(s?.skew).toBeCloseTo(0.06, 12);
    expect(s?.normalized).toBeCloseTo(0.24, 12);
  });
  it('needs both wings bracketed', () => {
    expect(skew25(chain.slice(0, 2), 0.25)).toBeNull();
  });
});

describe('implied against realized earnings moves', () => {
  const m = (date: string, implied: number, after: number) => ({
    date,
    implied,
    closeBefore: 100,
    closeAfter: after,
  });
  it('keeps the last eight, counts the misses, and gives the median ratio', () => {
    const r = impliedVsRealized([
      m('2024-01-01', 0.05, 110), // 10% vs 5%: ratio 2, exceeded
      m('2024-04-01', 0.05, 102), // 2%: 0.4
      m('2024-07-01', 0.05, 96), // 4%: 0.8
      m('2024-10-01', 0.05, 103), // 3%: 0.6
      m('2025-01-01', 0.05, 107), // 7%: 1.4, exceeded
      m('2025-04-01', 0.05, 101), // 1%: 0.2
      m('2025-07-01', 0.05, 95), // 5%: 1.0, not more
      m('2025-10-01', 0.05, 106), // 6%: 1.2, exceeded
      m('2026-01-01', 0.05, 105), // 5%: 1.0
    ]);
    expect(r.n).toBe(8);
    expect(r.rows[0]?.date).toBe('2024-04-01');
    expect(r.exceeded).toBe(2); // 1.4 and 1.2; the 10% move fell out of the window
    // Ratios 0.4, 0.8, 0.6, 1.4, 0.2, 1.0, 1.2, 1.0: sorted middle pair 0.8 and 1.0.
    expect(r.medianRatio).toBeCloseTo(0.9, 12);
  });
});

describe('IV-crush guard', () => {
  const base = { netDebit: 3.2, expiry: '2026-12-18', today: '2026-11-27' };
  it('warns for long premium spanning earnings, and only then', () => {
    expect(ivCrushWarning({ ...base, earningsDate: '2026-12-10' })).toContain('IV crush');
    expect(ivCrushWarning({ ...base, earningsDate: '2027-01-20' })).toBeNull(); // after expiry
    expect(ivCrushWarning({ ...base, earningsDate: '2026-11-20' })).toBeNull(); // already past
    expect(ivCrushWarning({ ...base, netDebit: -1.1, earningsDate: '2026-12-10' })).toBeNull(); // credit
    expect(ivCrushWarning({ ...base, earningsDate: null })).toBeNull();
  });
});

describe('unusual activity, with its stated limits', () => {
  const row = {
    contract: 'NVDA 2026-12-18 200 C',
    volume: 2500,
    openInterest: 1000,
    delta: 0.4,
    bid: 4.9,
    ask: 5.1,
    price: 5,
  };
  it('passes a contract on every filter: 2.5x open interest, $1.25M premium, $500 a contract, delta 0.4', () => {
    expect(unusualActivity([row])).toEqual([
      { contract: row.contract, volumeToOi: 2.5, premium: 1_250_000 },
    ]);
  });
  it('drops lottery tickets, small premium, thin quotes and ordinary volume', () => {
    expect(unusualActivity([{ ...row, delta: 0.05 }])).toEqual([]);
    expect(unusualActivity([{ ...row, price: 0.3 }])).toEqual([]); // $30 a contract
    expect(unusualActivity([{ ...row, bid: 3, ask: 7 }])).toEqual([]); // spread 80% of the mid
    expect(unusualActivity([{ ...row, volume: 1500 }])).toEqual([]); // 1.5x open interest
  });
  it('states what the feed cannot tell', () => {
    expect(UNUSUAL_LIMITS).toContain('opening from closing');
  });
});

describe('put/call ratios, equity and index apart', () => {
  it('divides puts by calls for volume and open interest', () => {
    const r = putCallRatios([
      { kind: 'equity', type: 'put', volume: 600, openInterest: 900 },
      { kind: 'equity', type: 'call', volume: 1000, openInterest: 1500 },
      { kind: 'index', type: 'put', volume: 300, openInterest: 400 },
      { kind: 'index', type: 'call', volume: 200, openInterest: 0 },
    ]);
    expect(r.equity).toEqual({ volume: 0.6, openInterest: 0.6 });
    expect(r.index.volume).toBe(1.5);
    expect(r.index.openInterest).toBeNull(); // no call open interest
  });
});
