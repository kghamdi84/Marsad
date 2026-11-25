import { describe, expect, it } from 'vitest';
import known from '../../../fixtures/backtest/sma-cross-known.json';
import { backtestGate, canMove, demotionCheck, shadowGate } from './lifecycle.js';
import { LEFT_OUT, PLAYBOOKS } from './playbooks.js';
import { replayDay } from './replay.js';
import { RuleEvaluator, validateRule, type RuleDoc } from './rules.js';
import type { DailyBar } from './study.js';

describe('playbook library', () => {
  it('has the brief’s eleven playbooks, numbered once each, with sources and a rating', () => {
    expect(PLAYBOOKS.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const p of PLAYBOOKS) {
      expect(p.sources.length, p.id).toBeGreaterThan(0);
      expect(['strong', 'moderate', 'weak', 'weak-to-moderate']).toContain(p.rating);
    }
    expect(LEFT_OUT).toHaveLength(5);
  });

  it('every rule is valid and every untestable playbook says why', () => {
    for (const p of PLAYBOOKS) {
      if (p.rule) {
        expect(validateRule(p.rule), p.id).toEqual([]);
        expect(p.rule.id).toBe(p.id);
        expect(p.testOn.length, p.id).toBeGreaterThan(0);
        expect(p.notTestableBecause).toBeNull();
      } else expect(p.notTestableBecause, p.id).toMatch(/\S/);
    }
    expect(PLAYBOOKS.filter((p) => p.rule).map((p) => p.number)).toEqual([1, 3, 6]);
  });
});

describe('lifecycle gates (hand-checked)', () => {
  it('backtested needs 30 out-of-sample trades and an interval above zero', () => {
    expect(backtestGate({ n: 29, expectancy: 0.01, ci90: { low: 0.001, high: 0.02 } }).ok).toBe(
      false,
    );
    expect(backtestGate({ n: 40, expectancy: 0.01, ci90: { low: -0.001, high: 0.02 } })).toEqual({
      ok: false,
      reason: 'the 90% interval of the expectancy includes zero',
    });
    expect(backtestGate({ n: 40, expectancy: -0.001, ci90: { low: -0.002, high: 0.001 } }).ok).toBe(
      false,
    );
    expect(backtestGate({ n: 40, expectancy: 0.01, ci90: { low: 0.002, high: 0.02 } }).ok).toBe(
      true,
    );
  });
  it('live needs 20 trading days and 15 signals in shadow', () => {
    expect(shadowGate({ tradingDays: 19, signals: 40 }).ok).toBe(false);
    expect(shadowGate({ tradingDays: 25, signals: 14 }).ok).toBe(false);
    expect(shadowGate({ tradingDays: 20, signals: 15 }).ok).toBe(true);
  });
  it('demotion uses the last 30 live signals against the backtest’s lower bound', () => {
    const good = Array.from({ length: 30 }, () => 0.01);
    expect(demotionCheck(good, 0.005).ok).toBe(false);
    // 40 signals: the first 10 good, the last 30 average 0.001, below 0.002.
    expect(
      demotionCheck([...good.slice(0, 10), ...Array.from({ length: 30 }, () => 0.001)], 0.002).ok,
    ).toBe(true);
    expect(demotionCheck(good.slice(0, 29), 0.5).ok).toBe(false);
  });
  it('only allowed moves', () => {
    expect(canMove('draft', 'live')).toBe(false);
    expect(canMove('draft', 'backtested')).toBe(true);
    expect(canMove('live', 'draft')).toBe(false); // a live rule is edited by making a new version
    expect(canMove('live', 'demoted')).toBe(true);
  });
});

describe('replay', () => {
  const bars = known.bars as DailyBar[];
  const rule = known.rule as RuleDoc;

  it('reproduces the evaluator on every day and lists each comparison with its values', () => {
    const ev = new RuleEvaluator(bars);
    const entries = ev.signals(rule.entry);
    for (const k of [35, 120, 333, 599]) {
      const r = replayDay(rule, bars, (bars[k] as DailyBar).date);
      expect(r?.entry).toBe(entries[k]);
      expect(r?.terms.map((t) => t.path)).toEqual(['entry', 'exit']);
      expect(r?.terms[0]?.left).toBe(ev.value({ ind: 'sma', period: 10 }, k));
    }
  });

  it('reproduces the day the first trade signalled, and never reads later bars', () => {
    const first = known.trades[0] as { signalDate: string };
    expect(replayDay(rule, bars, first.signalDate)?.entry).toBe(true);
    const k = bars.findIndex((b) => b.date === first.signalDate);
    const changed = bars.map((b, i) => (i > k ? { ...b, close: b.close * 3 } : b));
    expect(replayDay(rule, changed, first.signalDate)).toEqual(
      replayDay(rule, bars, first.signalDate),
    );
    expect(replayDay(rule, bars, 'nope')).toBeNull();
  });
});
