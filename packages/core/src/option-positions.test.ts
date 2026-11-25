import { describe, expect, it } from 'vitest';
import {
  daysToExpiry,
  optionExitSignals,
  optionPositionView,
  validateOptionPosition,
  type OptionPosition,
} from './option-positions.js';

// Bull call spread: long 1 NVDA 100 call at 5.00, short 1 110 call at 2.00.
// Debit 100 x (5 - 2) = 300; max gain 100 x (110 - 100) - 300 = 700; breakeven 100 + 3 = 103.
const spread: OptionPosition = {
  underlying: 'NVDA',
  label: 'Bull call spread',
  expiry: '2026-12-18',
  legs: [
    { type: 'call', strike: 100, qty: 1, price: 5 },
    { type: 'call', strike: 110, qty: -1, price: 2 },
  ],
  openedOn: '2026-11-20',
  exitDte: 21,
  profitTakePct: 0.5,
  lossLimitPct: 0.5,
  bearCase:
    'A miss on data-center revenue takes the stock below 100 and the spread expires worthless.',
};

describe('validateOptionPosition', () => {
  it('accepts a defined-risk spread with exit rules and a bear case', () => {
    expect(validateOptionPosition(spread, '2026-11-25')).toEqual([]);
  });
  it('refuses an unlimited-loss position (a naked short call)', () => {
    const naked = { ...spread, legs: [{ type: 'call' as const, strike: 110, qty: -1, price: 2 }] };
    expect(validateOptionPosition(naked, '2026-11-25')).toEqual([
      'The maximum loss is unlimited. Marsad tracks defined-risk positions only.',
    ]);
  });
  it('needs at least one exit rule and a bear case, and names each faulty leg', () => {
    const bad: OptionPosition = {
      ...spread,
      exitDte: null,
      profitTakePct: null,
      lossLimitPct: null,
      bearCase: ' ',
      legs: [{ type: 'put', strike: 0, qty: 1.5, price: -1 }],
    };
    expect(validateOptionPosition(bad, '2026-11-25')).toEqual([
      'Leg 1: strike must be above 0.',
      'Leg 1: contracts must be a whole number, not 0.',
      'Leg 1: premium must be 0 or more.',
      'Write at least one exit rule: days to expiry, a profit take or a loss limit.',
      'Write the bear case: what makes this position lose.',
    ]);
  });
  it('refuses a past expiry, more than 4 legs and limits outside 0 to 100%', () => {
    const legs = Array.from({ length: 5 }, () => ({
      type: 'put' as const,
      strike: 90,
      qty: 1,
      price: 1,
    }));
    const e = validateOptionPosition(
      { ...spread, expiry: '2026-11-24', legs, profitTakePct: 1.5 },
      '2026-11-25',
    );
    expect(e).toContain('Expiry is in the past.');
    expect(e).toContain('Enter 1 to 4 legs.');
    expect(e).toContain('Profit take must be above 0% and at most 100%.');
  });
});

describe('optionPositionView', () => {
  it('computes debit, maximum loss and gain, breakeven and the expiry payoff at the last close', () => {
    const v = optionPositionView(spread, { value: 105, asOf: '2026-11-24' }, '2026-11-25');
    expect(v.netPremium).toBe(300);
    expect(v.maxLoss).toBe(-300);
    expect(v.maxGain).toBe(700);
    expect(v.breakevens).toEqual([103]);
    // 2026-11-25 to 2026-12-18: 23 days.
    expect(v.dte).toBe(23);
    // At 105: long call worth 5 (paid 5), short call worth 0 (received 2): +200 = (105 - 103) x 100.
    expect(v.atExpiryIfUnchanged).toBe(200);
    expect(v.currentValue).toBeNull();
  });
  it('a credit spread shows a negative net premium', () => {
    // Bull put spread: short 95 put at 3, long 90 put at 1: credit 200, max loss 500 - 200 = 300.
    const v = optionPositionView(
      {
        ...spread,
        legs: [
          { type: 'put', strike: 95, qty: -1, price: 3 },
          { type: 'put', strike: 90, qty: 1, price: 1 },
        ],
      },
      null,
      '2026-11-25',
    );
    expect(v.netPremium).toBe(-200);
    expect(v.maxLoss).toBe(-300);
    expect(v.maxGain).toBe(200);
    expect(v.breakevens).toEqual([93]);
    expect(v.atExpiryIfUnchanged).toBeNull();
  });
  it('counts calendar days to expiry, 0 on the day', () => {
    expect(daysToExpiry('2026-12-18', '2026-12-18')).toBe(0);
    expect(daysToExpiry('2026-12-18', '2026-12-19')).toBe(-1);
  });
});

describe('optionExitSignals', () => {
  it('restates profit take and loss limit with dollar levels but never judges them without quotes', () => {
    const v = optionPositionView(spread, { value: 105, asOf: '2026-11-24' }, '2026-11-25');
    expect(optionExitSignals(spread, v)).toEqual([
      { rule: 'time', met: false, text: 'Time exit at 21 days to expiry (now 23).' },
      {
        rule: 'profit-take',
        met: false,
        text: 'Profit take at 50% of the maximum gain ($350.00); needs option quotes to judge.',
      },
      {
        rule: 'loss-limit',
        met: false,
        text: 'Loss limit at 50% of the maximum loss (-$150.00); needs option quotes to judge.',
      },
    ]);
  });
  it('meets the time exit at the rule and flags a short leg in the money in the last 7 days', () => {
    const v = optionPositionView(spread, { value: 112, asOf: '2026-12-12' }, '2026-12-13');
    const s = optionExitSignals(spread, v);
    expect(s[0]).toEqual({
      rule: 'time',
      met: true,
      text: 'Time exit: 5 days to expiry; your rule says close at 21.',
    });
    expect(s[1]).toEqual({
      rule: 'assignment',
      met: true,
      text: 'Assignment risk: the short 110 call is in the money at the 2026-12-12 close (112.00) with 5 days left.',
    });
    // 8 days out: no assignment flag yet.
    const early = optionPositionView(spread, { value: 112, asOf: '2026-12-09' }, '2026-12-10');
    expect(optionExitSignals(spread, early).some((x) => x.rule === 'assignment')).toBe(false);
  });
  it('says an expired position needs its close recorded', () => {
    const v = optionPositionView(spread, null, '2026-12-21');
    expect(optionExitSignals(spread, v)[0]).toEqual({
      rule: 'expired',
      met: true,
      text: 'Expired 3 days ago: record how it closed.',
    });
  });
});
