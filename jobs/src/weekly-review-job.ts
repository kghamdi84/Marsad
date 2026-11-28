import {
  checklistVersionOf,
  factsTemplate,
  groundedGenerate,
  promptKey,
  summarize,
  weeklyPayload,
  weeklyReview,
  weeklyReviewPrompt,
  runJob,
  type JobRunRecord,
  type JournalTrade,
  type WeeklyInputs,
} from '@marsad/core';
import { AiSession, NOT_CONFIGURED, type AiLedger, type MessagesClient } from './anthropic.js';
import { aiDetails, newTally, outputRow, type AiStore } from './ai-summaries-job.js';
import { briefText } from './brief-job.js';
import type { Store } from './store.js';

export interface WeeklyReviewJobDeps {
  store: Store;
  now: () => Date;
  sendEmail?: (subject: string, text: string) => Promise<void>;
  /** The Opus prose (checklist 7.8). Null or absent client: the review stays template-only, nothing is spent. */
  ai?: {
    client: MessagesClient | null;
    store: AiLedger & Pick<AiStore, 'insertOutput'>;
    randomHex?: () => string;
  };
}

/** The label the prose carries in the email and on the Journal page. */
export const AI_PROSE_LABEL =
  'AI-written from the figures above (Claude Opus 5.5, every number checked)';

/**
 * Prose by `weekly-review@1` on Claude Opus 5.5 over the review's own figures (weeklyReviewFacts), verified
 * against them, one regeneration, then the template. Stored in ai_outputs either way; only verified model text is
 * shown. Returns the prose to add to the email, or null.
 */
async function weeklyProse(
  deps: WeeklyReviewJobDeps,
  inputs: WeeklyInputs,
): Promise<{ prose: string | null; details: Record<string, unknown> }> {
  const ai = deps.ai;
  if (!ai?.client) return { prose: null, details: { status: `skipped: ${NOT_CONFIGURED}` } };
  const session = new AiSession({
    client: ai.client,
    ledger: ai.store,
    job: 'weekly-review',
    now: deps.now,
    ...(ai.randomHex ? { randomHex: ai.randomHex } : {}),
  });
  try {
    const built = weeklyPayload(inputs, promptKey(weeklyReviewPrompt));
    const generate = session.generator(
      weeklyReviewPrompt,
      built.payload,
      `weekly review ${inputs.weekEnding}`,
    );
    let served: string | null = null;
    const result = await groundedGenerate({
      payload: built.payload,
      template: () => factsTemplate(built.payload),
      check: weeklyReviewPrompt.check,
      generate: async (req) => {
        const text = await generate(req);
        served = session.lastServedModel;
        return text;
      },
    });
    await ai.store.insertOutput(
      outputRow(
        'weekly-review',
        null,
        inputs.weekEnding,
        weeklyReviewPrompt,
        built,
        result,
        served,
      ),
    );
    const tally = newTally();
    tally.written = 1;
    if (result.source === 'model') tally.verified = 1;
    else tally.templates[result.reason] = 1;
    return {
      prose: result.source === 'model' ? result.text : null,
      details: {
        status: result.source === 'model' ? 'verified' : `template (${result.reason})`,
        ...aiDetails(tally, session),
      },
    };
  } catch (e) {
    // The template review is still written and sent; the failure is in the run's details.
    return {
      prose: null,
      details: {
        status: 'error',
        error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        calls: session.stats.calls,
      },
    };
  }
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
    checklistVersion: checklistVersionOf(x['checklist_version']),
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
      const ai = await weeklyProse(deps, inputs);
      let email = 'not-configured';
      if (deps.sendEmail) {
        const text = briefText(brief);
        await deps.sendEmail(
          brief.title,
          ai.prose ? `${text}\n\n${AI_PROSE_LABEL}\n${ai.prose}` : text,
        );
        email = 'sent';
      }
      await store.saveBrief(brief, inputs, { email, push: 'pending', telegram: 'pending' });
      return {
        rows: 1,
        details: {
          weekEnding,
          trades: trades.length,
          alerts: alerts.length,
          email,
          ai: ai.details,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
