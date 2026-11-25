import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, ruleHash, type DailyBar } from '@marsad/core';
import known from '../../fixtures/backtest/sma-cross-known.json';
import { runBacktestJob } from './backtest-job.js';
import { fakeStore } from './fake-store.js';

const bars = known.bars as DailyBar[];
const testable = PLAYBOOKS.filter((p) => p.rule);
const allTickers = [...new Set(testable.flatMap((p) => p.testOn))];
const seedBars = Object.fromEntries(allTickers.map((t) => [t, bars]));
const NOW = () => new Date('2026-11-29T06:20:00Z');

describe('runBacktestJob', () => {
  it('stores version 1 of each testable playbook and a run for each, as drafts unless the gate passes', async () => {
    const { store, log } = fakeStore({ bars: seedBars, rules: {} });
    const run = await runBacktestJob({ store, now: NOW });
    expect(run.status).toBe('ok');
    expect(log.ruleVersions.map((v) => [v.id, v.version])).toEqual(testable.map((p) => [p.id, 1]));
    expect(log.backtestRuns.map((r) => r.ruleId)).toEqual(testable.map((p) => p.id));
    for (const r of log.backtestRuns) {
      expect(r.trials).toBe(1);
      expect(r.report).toHaveProperty('outOfSample');
      expect(r.report).toHaveProperty('gate');
    }
    // Any status move is a draft-to-backtested move with its reason, and only when the gate passed.
    for (const e of log.ruleEvents) {
      expect([e.from, e.to]).toEqual(['draft', 'backtested']);
      const report = log.backtestRuns.find((r) => r.ruleId === e.id)?.report as {
        gate: { ok: boolean };
      };
      expect(report.gate.ok).toBe(true);
    }
  });

  it('adds no version when the content is unchanged, and version 2 when it changed', async () => {
    const first = testable[0];
    if (!first?.rule) throw new Error('no testable playbook');
    const same = Object.fromEntries(
      testable.map((p) => [
        p.id,
        [{ version: 1, hash: ruleHash(p.rule as never), status: 'draft' as const }],
      ]),
    );
    const a = fakeStore({ bars: seedBars, rules: same });
    await runBacktestJob({ store: a.store, now: NOW });
    expect(a.log.ruleVersions).toEqual([]);
    const changed = {
      ...same,
      [first.id]: [{ version: 1, hash: '00000000', status: 'live' as const }],
    };
    const b = fakeStore({ bars: seedBars, rules: changed });
    await runBacktestJob({ store: b.store, now: NOW });
    expect(b.log.ruleVersions.map((v) => [v.id, v.version])).toEqual([[first.id, 2]]);
    // A live version is never moved by the runner.
    expect(b.log.ruleEvents.filter((e) => e.id === first.id && e.version === 1)).toEqual([]);
  });

  it('skips tickers with fewer than 100 bars', async () => {
    const { store, log } = fakeStore({ bars: { SPY: bars.slice(0, 50) }, rules: {} });
    await runBacktestJob({ store, now: NOW });
    const params = log.backtestRuns.map((r) => r.report);
    expect(params.every((p) => (p as { trades: number }).trades === 0)).toBe(true);
  });
});
