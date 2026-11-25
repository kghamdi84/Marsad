import {
  summarize,
  weeklyReview,
  runJob,
  type JobRunRecord,
  type JournalTrade,
} from '@marsad/core';
import { briefText } from './brief-job.js';
import type { Store } from './store.js';

export interface WeeklyReviewJobDeps {
  store: Store;
  now: () => Date;
  sendEmail?: (subject: string, text: string) => Promise<void>;
}

function toTrade(x: Record<string, unknown>): JournalTrade {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(x['id']),
    ticker: String(x['ticker']),
    side: x['side'] === 'short' ? 'short' : 'long',
    setup: String(x['setup'] ?? ''),
    tags: (x['tags'] ?? []) as string[],
    alertId: x['alert_id'] == null ? null : String(x['alert_id']),
    entryDate: String(x['entry_date']),
    entryPrice: Number(x['entry_price']),
    shares: Number(x['shares']),
    stop: n(x['stop']),
    target: n(x['target']),
    exitDate: x['exit_date'] == null ? null : String(x['exit_date']),
    exitPrice: n(x['exit_price']),
    checklist: (x['checklist'] ?? {}) as JournalTrade['checklist'],
    followed: (x['followed'] ?? {}) as JournalTrade['followed'],
    notes: String(x['notes'] ?? ''),
    screenshots: (x['screenshots'] ?? []) as string[],
  };
}

/**
 * The weekly review (ADR 0029), Sundays: the past 7 days of trades, behavior, alerts, feedback and the scorecard,
 * from templates. Stored as a brief of kind `weekly-review` (with its inputs, for replay) and emailed when
 * configured.
 */
export async function runWeeklyReviewJob(deps: WeeklyReviewJobDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'weekly-review',
    async () => {
      const at = now();
      const weekEnding = at.toISOString().slice(0, 10);
      const since = new Date(Date.parse(`${weekEnding}T00:00:00Z`) - 6 * 86_400_000).toISOString();
      const trades = (await store.exportRows('trades')).map(toTrade);
      const alerts = (await store.getRecentAlerts(since)).map((a) => ({
        kind: a.key.split('|')[0] ?? '',
        decision: a.decision,
      }));
      const feedback = (await store.exportRows('alert_feedback'))
        .filter((f) => String(f['created_at'] ?? '') >= since)
        .map((f) => ({ verdict: String(f['verdict']) }));
      const scored = await store.getAlertsForScoring(
        new Date(at.getTime() - 120 * 86_400_000).toISOString(),
      );
      const outcomes = await store.getOutcomes(scored.map((a) => a.id));
      const scorecard = summarize(scored, outcomes).filter((r) => r.horizon === '5d');
      const regimeRow = (await store.latest('regime_daily', 'date, label', 'date', 1))[0];
      const inputs = {
        weekEnding,
        trades,
        alerts,
        feedback,
        scorecard,
        regime: regimeRow ? String(regimeRow['label']) : null,
      };
      const brief = weeklyReview(inputs);
      let email = 'not-configured';
      if (deps.sendEmail) {
        await deps.sendEmail(brief.title, briefText(brief));
        email = 'sent';
      }
      await store.saveBrief(brief, inputs, { email, push: 'pending', telegram: 'pending' });
      return {
        rows: 1,
        details: { weekEnding, trades: trades.length, alerts: alerts.length, email },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
