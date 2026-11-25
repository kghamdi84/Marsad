import {
  EVENT_STUDY_VERSION,
  RECESSION_RULE_VERSION,
  REGIME_RULE_VERSION,
  baselineStudy,
  eventStudy,
  recessionFilter,
  regimeHistory,
  runJob,
  type ForwardStats,
  type JobRunRecord,
  type MacroSeries,
  type Obs,
  type RegimeLabel,
} from '@marsad/core';
import type { EventStatRow, RegimeRow, Store } from './store.js';

export interface RegimeJobDeps {
  store: Store;
  now: () => Date;
}

/** The FRED series the regime and the recession filter read (ADR 0009). */
export const REGIME_SERIES = [
  'SP500',
  'VIXCLS',
  'VXVCLS',
  'T10Y3M',
  'BAMLH0A0HYM2',
  'ICSA',
  'NFCI',
  'SAHMREALTIME',
] as const;

/** A newest S&P 500 close older than this many calendar days fails the run: silence must not look like calm. */
export const MAX_SP500_AGE_DAYS = 5;

const LABELS: readonly RegimeLabel[] = [
  'stress',
  'bear',
  'recovery',
  'bull-calm',
  'bull-correction',
];

function statRows(
  condition: string,
  stats: readonly ForwardStats[],
  episodes: string[],
  from: string,
  to: string,
): EventStatRow[] {
  return stats.map((s) => ({
    condition,
    horizon: s.horizon,
    n: s.n,
    sufficient: s.sufficient,
    median: s.median,
    q1: s.q1,
    q3: s.q3,
    min: s.min,
    max: s.max,
    episodes,
    dataFrom: from,
    dataTo: to,
  }));
}

/**
 * Recomputes the regime label and the recession filter for every S&P 500 session from the stored FRED series,
 * stores each day with its inputs and rule versions, and refreshes the event-study statistics per label. Every day
 * is recomputed on each run, so a rule change or a revised input shows up everywhere at once. Reads only the
 * database: run it after the FRED job.
 */
export async function runRegimeJob(deps: RegimeJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'regime-daily',
    async () => {
      const today = now().toISOString().slice(0, 10);
      const series: Record<string, Obs[]> = {};
      for (const id of REGIME_SERIES) {
        const obs = await store.getFredRange(id, '1990-01-01', today);
        series[id] = obs.filter((o): o is Obs => o.value !== null);
      }
      const sp500 = series['SP500'] ?? [];
      if (sp500.length < 252)
        throw new Error(
          `S&P 500 history has ${sp500.length} sessions; 252 are needed. Run the FRED job first.`,
        );
      const macro: MacroSeries = series;
      const days = regimeHistory(sp500, series['VIXCLS'] ?? [], series['VXVCLS'] ?? []);
      const rows: RegimeRow[] = days.map((d) => {
        const f = recessionFilter(macro, d.date);
        return {
          date: d.date,
          ruleVersion: d.ruleVersion,
          label: d.label,
          reason: d.reason,
          inputs: { ...d.inputs },
          recessionVersion: f.ruleVersion,
          recessionLevel: f.level,
          recession: { available: f.available, triggered: f.triggered, signals: f.signals },
        };
      });
      const written = await store.upsertRegimeDays(rows);

      const from = sp500[0]?.date as string;
      const to = sp500.at(-1)?.date as string;
      const stats: EventStatRow[] = [];
      for (const label of LABELS) {
        const s = eventStudy(
          sp500,
          days.map((d) => d.label === label),
        );
        stats.push(...statRows(label, s.byHorizon, s.episodes, from, to));
      }
      const vixBy = new Map((series['VIXCLS'] ?? []).map((o) => [o.date, o.value]));
      const vix30 = eventStudy(
        sp500,
        sp500.map((o) => (vixBy.get(o.date) ?? 0) >= 30),
      );
      stats.push(...statRows('vix-30', vix30.byHorizon, vix30.episodes, from, to));
      stats.push(...statRows('all-days', baselineStudy(sp500), [], from, to));
      await store.replaceEventStats(REGIME_RULE_VERSION, stats);

      const last = days.at(-1);
      const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) / 86_400_000;
      if (age > MAX_SP500_AGE_DAYS)
        throw new Error(
          `Regime computed, but the newest S&P 500 close is ${to} (${age} days old): the FRED job may not be running`,
        );
      return {
        rows: written,
        details: {
          latest: last?.date,
          label: last?.label,
          recession: rows.at(-1)?.recessionLevel,
          sessions: days.length,
          from,
          to,
          versions: [REGIME_RULE_VERSION, RECESSION_RULE_VERSION, EVENT_STUDY_VERSION],
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
