import { describe, expect, it } from 'vitest';
import { PLAYBOOKS } from './playbooks.js';
import { ruleExprText, ruleLines } from './rule-text.js';
import type { RuleDoc } from './rules.js';

// Known answers written by hand from the rule documents in playbooks.ts (exact string match, no tolerance).
describe('rule-text-1', () => {
  it('spells out the index trend filter as in the Lab design', () => {
    const p = PLAYBOOKS.find((x) => x.id === 'index-trend-filter');
    expect(ruleLines(p!.rule!)).toEqual([
      'entry: close crossesAbove sma(200)',
      'exit:  close crossesBelow sma(200)',
    ]);
  });

  it('lists every condition of the trend template, with offsets, the multiplier and the 8% stop', () => {
    const p = PLAYBOOKS.find((x) => x.id === 'trend-template-breakout');
    expect(ruleLines(p!.rule!)).toEqual([
      'entry: all of:',
      '         close > sma(50)',
      '         sma(50) > sma(150)',
      '         sma(150) > sma(200)',
      '         sma(200) > sma(200, 20 bars ago)',
      '         close >= 0.75 × highest(close, 252)',
      '         close >= highest(close, 20, 1 bar ago)',
      'exit:  close < sma(50)',
      'stop:  8% below entry',
    ]);
  });

  it('covers any, not, an ATR stop, a time stop and a field offset', () => {
    const rule: RuleDoc = {
      id: 'x',
      name: 'x',
      side: 'long',
      entry: {
        any: [
          { not: { left: { ind: 'rsi', period: 14 }, op: '<', right: 30 } },
          { left: { ind: 'close', offset: 2 }, op: '<=', right: { ind: 'open' } },
        ],
      },
      stop: { atr: 2.5 },
      maxHoldBars: 20,
    };
    expect(ruleLines(rule)).toEqual([
      'entry: any of:',
      '         not:',
      '           rsi(14) < 30',
      '         close(2 bars ago) <= open',
      'stop:  2.5 × atr(14) below entry',
      'time:  exit after 20 bars',
    ]);
    expect(ruleExprText({ ind: 'return', period: 252 })).toBe('return(252)');
  });
});
