import {
  SCORECARD_VERSION,
  alertOutcomes,
  runJob,
  type DailyBar,
  type JobRunRecord,
  type Outcome,
} from '@marsad/core';
import type { Store } from './store.js';

export interface ScorecardJobDeps {
  store: Store;
  now: () => Date;
}

/** Alerts newer than this are scored; 20 sessions fit well inside 45 days. */
const LOOKBACK_DAYS = 45;

/**
 * Computes the outcome of every alert of the last 45 days at 1, 5 and 20 sessions from stored daily bars
 * (ADR 0023) and stores them. Finished and unavailable outcomes are never recomputed; pending ones are
 * refreshed each run until their window has passed.
 */
export async function runScorecardJob(deps: ScorecardJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'scorecard',
    async () => {
      const since = new Date(now().getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
      const alerts = await store.getAlertsForScoring(since);
      const finished = await store.getFinishedOutcomeKeys(alerts.map((a) => a.id));
      const spy = await store.getDailyBars('SPY');
      const bars = new Map<string, DailyBar[]>();
      const rows: Outcome[] = [];
      for (const a of alerts) {
        if (a.ticker && !bars.has(a.ticker)) bars.set(a.ticker, await store.getDailyBars(a.ticker));
        for (const o of alertOutcomes(a, a.ticker ? (bars.get(a.ticker) ?? []) : [], spy))
          if (!finished.has(`${o.alertId}|${o.horizon}`)) rows.push(o);
      }
      const written = await store.upsertOutcomes(rows, SCORECARD_VERSION);
      const states: Record<string, number> = {};
      for (const o of rows) states[o.status] = (states[o.status] ?? 0) + 1;
      return {
        rows: written,
        details: { alerts: alerts.length, states, version: SCORECARD_VERSION },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
