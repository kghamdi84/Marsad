import {
  BACKTEST_VERSION,
  DEFAULT_COSTS,
  PLAYBOOKS,
  backtest,
  backtestGate,
  backtestReport,
  ruleHash,
  runJob,
  walkForward,
  walkForwardSplit,
  type DailyBar,
  type JobRunRecord,
  type Trade,
} from '@marsad/core';
import type { Store } from './store.js';

export interface BacktestJobDeps {
  store: Store;
  now: () => Date;
  seed?: number;
}

/**
 * The backtest runner (ADR 0018): stores each playbook rule as a new immutable version when its content changed,
 * backtests it on its tickers' stored bars (walk-forward, untouched holdout), stores the run with its report and
 * parameters, and moves a draft to backtested only when the out-of-sample gate passes.
 */
export async function runBacktestJob(deps: BacktestJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const seed = deps.seed ?? 20261125;
  const run = await runJob(
    'backtest-lab',
    async () => {
      const labels = new Map(
        (await store.getRegimeLabels('2000-01-01')).map((r) => [r.date, r.label]),
      );
      const spy = await store.getDailyBars('SPY');
      const cache = new Map<string, DailyBar[]>();
      const barsOf = async (t: string) => {
        const hit = cache.get(t);
        if (hit) return hit;
        const b = await store.getDailyBars(t);
        cache.set(t, b);
        return b;
      };
      const summary: Record<string, unknown> = {};
      for (const p of PLAYBOOKS) {
        if (!p.rule) continue;
        const rule = p.rule;
        const hash = ruleHash(rule);
        const versions = await store.getRuleVersions(rule.id);
        let current = versions.find((v) => v.hash === hash);
        if (!current) {
          const version = (versions.at(-1)?.version ?? 0) + 1;
          await store.insertRuleVersion({
            id: rule.id,
            version,
            hash,
            doc: rule,
            source: 'playbook',
          });
          current = { version, hash, status: 'draft' };
        }
        const all: Trade[] = [];
        const oos: Trade[] = [];
        const tested: string[] = [];
        for (const t of p.testOn) {
          const bars = await barsOf(t);
          if (bars.length < 100) continue;
          tested.push(t);
          all.push(...backtest(rule, bars, t, DEFAULT_COSTS));
          const split = walkForwardSplit(
            bars.map((b) => b.date),
            4,
            0.2,
          );
          oos.push(...walkForward([rule], bars, t, split, { costs: DEFAULT_COSTS }).outOfSample);
        }
        const opts = {
          seed,
          ...(spy.length > 0 ? { benchmark: { ticker: 'SPY', bars: spy } } : {}),
          regimeAt: (d: string) => labels.get(d) ?? null,
        };
        const full = backtestReport(all, opts);
        const out = backtestReport(oos, opts);
        const gate = backtestGate({
          n: out.stats.n,
          expectancy: out.expectancy.value,
          ci90: out.expectancy.ci90,
        });
        await store.saveBacktestRun({
          ruleId: rule.id,
          version: current.version,
          engine: BACKTEST_VERSION,
          params: { tickers: tested, costs: DEFAULT_COSTS, seed, folds: 4, holdoutFraction: 0.2 },
          trials: 1,
          report: {
            full,
            outOfSample: out,
            gate,
            trades: all.length,
            from: spy[0]?.date ?? null,
            to: spy.at(-1)?.date ?? null,
          },
        });
        if (current.status === 'draft' && gate.ok)
          await store.setRuleStatus(rule.id, current.version, 'draft', 'backtested', gate.reason, {
            n: out.stats.n,
            expectancy: out.expectancy.value,
            ci90: out.expectancy.ci90,
          });
        summary[rule.id] = {
          version: current.version,
          trades: all.length,
          oos: out.stats.n,
          gate: gate.reason,
        };
      }
      return { rows: Object.keys(summary).length, details: summary };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
