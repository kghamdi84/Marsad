import { describe, expect, it } from 'vitest';
import {
  RuleEvaluator,
  canonicalRule,
  ruleHash,
  validateRule,
  type RuleCondition,
  type RuleDoc,
} from './rules.js';
import { mulberry32 } from './stats.js';
import type { DailyBar } from './study.js';

function bars(closes: number[]): DailyBar[] {
  return closes.map((close, i) => ({
    date: `d${String(i).padStart(3, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + i,
    vwap: null,
  }));
}

describe('RuleEvaluator (hand-checked)', () => {
  // closes 1..10
  const ev = new RuleEvaluator(bars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

  it('reads fields with offsets and computes moving averages', () => {
    expect(ev.value({ ind: 'close' }, 4)).toBe(5);
    expect(ev.value({ ind: 'close', offset: 2 }, 4)).toBe(3);
    expect(ev.value({ ind: 'close', offset: 5 }, 4)).toBeNull(); // before the first bar
    expect(ev.value({ ind: 'sma', period: 3 }, 4)).toBe(4); // (3 + 4 + 5) / 3
    expect(ev.value({ ind: 'sma', period: 3 }, 1)).toBeNull(); // needs 3 bars
    expect(ev.value({ ind: 'highest', period: 3 }, 4)).toBe(6); // highs 4, 5, 6
    expect(ev.value({ ind: 'lowest', period: 3, of: 'close' }, 4)).toBe(3);
    expect(ev.value({ ind: 'return', period: 4 }, 4)).toBeCloseTo(5 / 1 - 1, 12);
    expect(ev.value({ ind: 'mul', left: 2, right: { ind: 'close' } }, 4)).toBe(10);
  });

  it('compares, combines and treats missing values as unknown', () => {
    const above: RuleCondition = {
      left: { ind: 'close' },
      op: '>',
      right: { ind: 'sma', period: 3 },
    };
    expect(ev.holds(above, 4)).toBe(true); // 5 > 4
    expect(ev.holds(above, 1)).toBeNull(); // the average needs 3 bars
    expect(ev.holds({ all: [above, { left: 1, op: '<', right: 0 }] }, 4)).toBe(false);
    expect(ev.holds({ any: [above, { left: 1, op: '<', right: 0 }] }, 4)).toBe(true);
    expect(ev.holds({ not: above }, 4)).toBe(false);
    // all: a false wins over an unknown; any: a true wins over an unknown.
    expect(ev.holds({ all: [above, { left: 1, op: '<', right: 0 }] }, 1)).toBe(false);
    expect(ev.holds({ any: [above, { left: 1, op: '>', right: 0 }] }, 1)).toBe(true);
    expect(ev.holds({ all: [above, { left: 1, op: '>', right: 0 }] }, 1)).toBeNull();
  });

  it('crosses only on the bar it happens', () => {
    // closes 5 5 5 7 7: crosses above 6 at bar 3 only.
    const e = new RuleEvaluator(bars([5, 5, 5, 7, 7]));
    const cross: RuleCondition = { left: { ind: 'close' }, op: 'crossesAbove', right: 6 };
    expect(e.signals(cross)).toEqual([null, false, false, true, false]);
    // Touching the line and then closing above it counts as a cross (previous 6, equal to 6).
    expect(new RuleEvaluator(bars([5, 6, 7])).signals(cross)).toEqual([null, false, true]);
    const down: RuleCondition = { left: { ind: 'close' }, op: 'crossesBelow', right: 6 };
    expect(new RuleEvaluator(bars([7, 5, 5])).signals(down)).toEqual([null, true, false]);
  });
});

describe('look-ahead: changing future bars never changes a past signal', () => {
  const rule: RuleCondition = {
    all: [
      { left: { ind: 'close' }, op: '>', right: { ind: 'sma', period: 20 } },
      { left: { ind: 'ema', period: 10 }, op: 'crossesAbove', right: { ind: 'sma', period: 30 } },
      { left: { ind: 'rsi', period: 14 }, op: '<', right: 70 },
      { left: { ind: 'rvol', period: 20 }, op: '>', right: 0.5 },
      {
        left: { ind: 'close' },
        op: '>=',
        right: { ind: 'highest', period: 50, of: 'close', offset: 1 },
      },
    ],
  };
  it('holds for 50 random cut points and random futures', () => {
    const rand = mulberry32(11);
    const base: number[] = [];
    let p = 100;
    for (let i = 0; i < 300; i++) base.push((p *= 1 + (rand() - 0.5) * 0.04));
    const before = new RuleEvaluator(bars(base));
    const a = before.signals(rule);
    for (let k = 0; k < 50; k++) {
      const cut = 40 + Math.floor(rand() * 250);
      const changed = base.map((x, i) => (i > cut ? x * (0.5 + rand()) : x));
      const b = new RuleEvaluator(bars(changed)).signals(rule);
      expect(b.slice(0, cut + 1)).toEqual(a.slice(0, cut + 1));
      for (const e of [{ ind: 'atr', period: 14 } as const, { ind: 'ema', period: 10 } as const])
        for (let i = 0; i <= cut; i += 17)
          expect(new RuleEvaluator(bars(changed)).value(e, i)).toBe(before.value(e, i));
    }
  });
});

const good: RuleDoc = {
  id: 'index-trend-filter',
  name: 'Index core with a trend filter',
  side: 'long',
  entry: { left: { ind: 'close' }, op: '>', right: { ind: 'sma', period: 200 } },
  exit: { left: { ind: 'close' }, op: '<', right: { ind: 'sma', period: 200 } },
};

describe('validateRule', () => {
  it('accepts a valid rule', () => {
    expect(validateRule(good)).toEqual([]);
  });
  it('names every problem', () => {
    expect(
      validateRule({
        id: 'Bad Id',
        name: '',
        side: 'short',
        entry: { left: { ind: 'sma', period: 0 }, op: '=>', right: { ind: 'magic' } },
        stop: { pct: 2 },
      }),
    ).toEqual([
      'id: lower-case letters, digits and hyphens, 2 to 60 characters',
      'name: required',
      'side: only long rules are supported',
      'entry: unknown operator =>',
      'entry.left: period must be a whole number from 1 to 400',
      'entry.right: unknown indicator magic',
      'stop.pct: between 0 and 1',
    ]);
  });
  it('needs some way out', () => {
    const noExit: Partial<RuleDoc> = { ...good };
    delete noExit.exit;
    expect(validateRule(noExit)).toEqual([
      'exit: a rule needs an exit condition, a stop or a time stop',
    ]);
    expect(validateRule({ ...noExit, maxHoldBars: 20 })).toEqual([]);
  });
  it('limits nesting', () => {
    let c: unknown = { left: 1, op: '>', right: 0 };
    for (let i = 0; i < 15; i++) c = { not: c };
    expect(validateRule({ ...good, entry: c }).some((e) => e.includes('nested too deeply'))).toBe(
      true,
    );
  });
});

describe('versions', () => {
  it('the hash ignores key order and changes with content', () => {
    const reordered = JSON.parse(
      JSON.stringify({
        side: good.side,
        exit: good.exit,
        entry: good.entry,
        name: good.name,
        id: good.id,
      }),
    ) as RuleDoc;
    expect(canonicalRule(reordered)).toBe(canonicalRule(good));
    expect(ruleHash(reordered)).toBe(ruleHash(good));
    expect(ruleHash({ ...good, name: 'Other' })).not.toBe(ruleHash(good));
    expect(ruleHash(good)).toMatch(/^[0-9a-f]{8}$/);
  });
});
