import { runJob, thesisDraftPrompt, type JobRunRecord } from '@marsad/core';
import { AiSession, NOT_CONFIGURED } from './anthropic.js';
import {
  aiDetails,
  aiTickers,
  generateForTickers,
  newTally,
  type AiJobDeps,
  type AiStore,
} from './ai-summaries-job.js';

export interface ThesisStore extends AiStore {
  /** Tickers with at least one saved thesis card (any owner). */
  getThesisTickers(): Promise<string[]>;
}

export interface ThesisJobDeps extends AiJobDeps {
  store: ThesisStore;
  /** Tickers Khaled asked for a draft of (workflow input), drafted even when their sources are unchanged. */
  requested?: readonly string[];
}

/** Most drafts in one run. */
export const MAX_DRAFTS_PER_RUN = 5;

/** The tickers of a request such as "NVDA, rklb": valid symbols only, each once. */
export function parseRequested(raw: string | undefined): string[] {
  return aiTickers((raw ?? '').split(/[\s,]+/).filter(Boolean));
}

/**
 * Thesis card drafts (checklist 2.10, ADR 0007): for each open holding without a saved thesis, and for any ticker
 * asked for, a draft by `thesis-draft@2` on Claude Sonnet 5.5 from the same cited filings as the summary. The bull
 * case, a bear case as specific as the bull case, key risks and what would change the view are required; the
 * verifier checks every figure. A draft is never saved as Khaled's thesis: the card offers it as a starting point
 * for the form he edits and saves himself.
 */
export async function runAiThesisJob(deps: ThesisJobDeps): Promise<JobRunRecord> {
  const run = await runJob(
    'ai-thesis-drafts',
    async () => {
      if (!deps.client) return { skipped: NOT_CONFIGURED, details: { calls: 0, usd: 0 } };
      const session = new AiSession({
        client: deps.client,
        ledger: deps.store,
        job: 'ai-thesis-drafts',
        now: deps.now,
        ...(deps.randomHex ? { randomHex: deps.randomHex } : {}),
      });
      const withThesis = new Set(await deps.store.getThesisTickers());
      const holdings = aiTickers(await deps.store.getHoldingTickers()).filter(
        (t) => !withThesis.has(t),
      );
      const requested = aiTickers(deps.requested ?? []);
      const tickers = aiTickers(requested, holdings);
      const tally = newTally();
      await generateForTickers({
        deps,
        session,
        kind: 'thesis-draft',
        def: thesisDraftPrompt,
        tickers,
        force: new Set(requested),
        maxPerRun: MAX_DRAFTS_PER_RUN,
        tally,
      });
      return {
        rows: tally.written,
        details: aiDetails(tally, session, {
          holdingsWithoutThesis: holdings.length,
          requested: requested.length,
        }),
      };
    },
    () => deps.now().getTime(),
  );
  await deps.store.recordRun(run);
  return run;
}
