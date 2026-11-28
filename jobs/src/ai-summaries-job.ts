import {
  filingPayload,
  filingSummaryPrompt,
  citationsFor,
  factsTemplate,
  groundedGenerate,
  normalizeTicker,
  promptKey,
  runJob,
  summarizeFinancials,
  AI_PAYLOAD_VERSION,
  type BuiltPayload,
  type CitationRef,
  type FilingSources,
  type FinancialFact,
  type GroundedReason,
  type GroundedResult,
  type JobRunRecord,
  type PromptDef,
  type StoredAnnualSection,
  type StoredEightK,
  type StoredQuarterlySection,
} from '@marsad/core';
import { AiSession, NOT_CONFIGURED, type AiLedger, type MessagesClient } from './anthropic.js';

export type AiOutputKind = 'filing-summary' | 'thesis-draft' | 'weekly-review';

/** One `public.ai_outputs` row as written. */
export interface AiOutputRow {
  kind: AiOutputKind;
  ticker: string | null;
  for_date: string | null;
  source_ids: string[];
  source_key: string;
  prompt_id: string;
  prompt_version: number;
  model: string;
  served_model: string | null;
  text: string;
  citations: CitationRef[];
  verified: boolean;
  source: 'model' | 'template';
  fallback_reason: Exclude<GroundedReason, 'verified'> | null;
  attempts: number;
  failures: GroundedResult['failures'];
  input_snapshot: Record<string, unknown>;
}

/** The newest stored output per source key, for deciding whether a source changed. */
export interface StoredOutputKey {
  ticker: string | null;
  sourceKey: string;
  source: 'model' | 'template';
  reason: string | null;
}

/** What the AI jobs read and write. Implemented over Supabase in ai-store.ts, by a fake in tests. */
export interface AiStore extends AiLedger {
  getWatchlistTickers(): Promise<string[]>;
  getHoldingTickers(): Promise<string[]>;
  /** Issuer CIK by ticker, for the tickers that have one stored. */
  getCiks(tickers: readonly string[]): Promise<Map<string, string>>;
  getFinancialFacts(cik: string): Promise<FinancialFact[]>;
  /** The newest stored 10-K risk factor section. */
  getAnnualRiskSection(cik: string): Promise<StoredAnnualSection | null>;
  /** The newest stored 10-Q risk factor section. */
  getQuarterlySection(cik: string): Promise<StoredQuarterlySection | null>;
  /** 8-K filings filed on or after `since` (YYYY-MM-DD). */
  getEightKs(cik: string, since: string): Promise<StoredEightK[]>;
  /** Stored outputs of one kind for these tickers (every source key seen). */
  getOutputKeys(kind: AiOutputKind, tickers: readonly string[]): Promise<StoredOutputKey[]>;
  insertOutput(row: AiOutputRow): Promise<void>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface AiJobDeps {
  store: AiStore;
  /** Null without ANTHROPIC_API_KEY: the job records `skipped` and spends nothing. */
  client: MessagesClient | null;
  now: () => Date;
  /** For tests: the per-call tag id. */
  randomHex?: () => string;
}

/**
 * Outcomes that settle a source: the same filings with the same prompt are not sent again. A cost-cap or
 * generation failure is retried on the next run.
 */
export const SETTLED: ReadonlySet<string | null> = new Set([
  null,
  'verification-failed',
  'refusal',
]);

/** Most summaries written in one run, so a first run over a long watchlist spreads over days. */
export const MAX_SUMMARIES_PER_RUN = 10;

const DAY = 86_400_000;

/** Every stored source for one ticker, as the payload builder reads it. */
export async function loadFilingSources(
  store: AiStore,
  ticker: string,
  cik: string,
  today: string,
): Promise<FilingSources> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 130 * DAY).toISOString().slice(0, 10);
  const [facts, annual, quarterly, eightKs] = await Promise.all([
    store.getFinancialFacts(cik),
    store.getAnnualRiskSection(cik),
    store.getQuarterlySection(cik),
    store.getEightKs(cik, since),
  ]);
  return {
    ticker,
    cik,
    financials: facts.length > 0 ? summarizeFinancials(facts, today) : null,
    annual,
    quarterly,
    eightKs,
    today,
  };
}

/** Holdings first, then watchlists; each ticker once, only symbols Marsad accepts. */
export function aiTickers(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const list of lists)
    for (const raw of list) {
      const t = normalizeTicker(raw);
      if (t && !out.includes(t)) out.push(t);
    }
  return out;
}

/** The stored row for one grounded result. */
export function outputRow(
  kind: AiOutputKind,
  ticker: string | null,
  forDate: string | null,
  def: PromptDef,
  built: BuiltPayload,
  result: GroundedResult,
  servedModel: string | null,
  extraSnapshot: Record<string, unknown> = {},
): AiOutputRow {
  return {
    kind,
    ticker,
    for_date: forDate,
    source_ids: built.sourceIds.slice(0, 50),
    source_key: built.sourceKey,
    prompt_id: def.id,
    prompt_version: def.version,
    model: def.model,
    served_model: result.source === 'model' ? servedModel : null,
    text: result.text.slice(0, 20_000),
    citations: citationsFor(built.refs, result.citations),
    verified: result.source === 'model' || result.templateVerified,
    source: result.source,
    fallback_reason: result.reason === 'verified' ? null : result.reason,
    attempts: result.attempts,
    failures: result.failures,
    input_snapshot: {
      payloadVersion: AI_PAYLOAD_VERSION,
      prompt: promptKey(def),
      payload: built.payload,
      notes: built.notes,
      ...extraSnapshot,
    },
  };
}

export interface GenerationTally {
  written: number;
  verified: number;
  templates: Record<string, number>;
  unchanged: number;
  noData: number;
  deferred: number;
}

export function newTally(): GenerationTally {
  return { written: 0, verified: 0, templates: {}, unchanged: 0, noData: 0, deferred: 0 };
}

/** The run's details: what was written, why any template was used, spend and the budget. */
export function aiDetails(tally: GenerationTally, session: AiSession, extra = {}) {
  return {
    ...extra,
    ...tally,
    calls: session.stats.calls,
    usd: Math.round(session.stats.usd * 1e6) / 1e6,
    budget: session.stats.budget
      ? {
          state: session.stats.budget.state,
          dailyPct: session.stats.budget.dailyPct,
          monthlyPct: session.stats.budget.monthlyPct,
          message: session.stats.budget.message,
        }
      : null,
    warnings: session.stats.warnings,
  };
}

/**
 * One grounded output per ticker whose sources changed: build the payload, skip a settled source key, generate
 * (verify, regenerate once, template), store. Shared by the summaries and the thesis drafts.
 */
export async function generateForTickers(opts: {
  deps: AiJobDeps;
  session: AiSession;
  kind: 'filing-summary' | 'thesis-draft';
  def: PromptDef;
  tickers: readonly string[];
  /** Tickers to draft again even when their sources are unchanged (an explicit request). */
  force?: ReadonlySet<string>;
  maxPerRun: number;
  tally: GenerationTally;
}): Promise<void> {
  const { deps, session, def, kind, tally } = opts;
  const today = deps.now().toISOString().slice(0, 10);
  const ciks = await deps.store.getCiks(opts.tickers);
  const seen = await deps.store.getOutputKeys(kind, opts.tickers);
  for (const ticker of opts.tickers) {
    const cik = ciks.get(ticker);
    if (!cik) {
      tally.noData += 1;
      continue;
    }
    const built = filingPayload(
      await loadFilingSources(deps.store, ticker, cik, today),
      promptKey(def),
    );
    if (!built) {
      tally.noData += 1;
      continue;
    }
    const prior = seen.filter((s) => s.ticker === ticker && s.sourceKey === built.sourceKey);
    const forced = opts.force?.has(ticker) ?? false;
    if (!forced && prior.some((p) => SETTLED.has(p.reason))) {
      tally.unchanged += 1;
      continue;
    }
    if (tally.written >= opts.maxPerRun) {
      tally.deferred += 1;
      continue;
    }
    // At the cap with a template already stored for these sources: nothing new to write.
    if (prior.length > 0 && (await session.wouldCap(def, built.payload))) {
      tally.deferred += 1;
      continue;
    }
    let served: string | null = null;
    const generate = session.generator(def, built.payload, `${kind} ${ticker}`);
    const result = await groundedGenerate({
      payload: built.payload,
      template: () => factsTemplate(built.payload),
      check: def.check,
      generate: async (req) => {
        const text = await generate(req);
        served = session.lastServedModel;
        return text;
      },
    });
    await deps.store.insertOutput(outputRow(kind, ticker, null, def, built, result, served));
    tally.written += 1;
    if (result.source === 'model') tally.verified += 1;
    else tally.templates[result.reason] = (tally.templates[result.reason] ?? 0) + 1;
  }
}

/**
 * The daily filing summaries (checklist 2.9, ADR 0007): for each holding and watchlist ticker, a summary of the
 * newest stored filings (quarterly figures, the 10-Q and 10-K risk factor sections, recent 8-K items) by
 * `filing-summary@1` on Claude Sonnet 5.5, every figure verified, one regeneration, then the template. A ticker is
 * summarized again only when its sources change. Without a key the run is `skipped` and nothing is spent.
 */
export async function runAiSummariesJob(deps: AiJobDeps): Promise<JobRunRecord> {
  const run = await runJob(
    'ai-summaries',
    async () => {
      if (!deps.client) return { skipped: NOT_CONFIGURED, details: { calls: 0, usd: 0 } };
      const session = new AiSession({
        client: deps.client,
        ledger: deps.store,
        job: 'ai-summaries',
        now: deps.now,
        ...(deps.randomHex ? { randomHex: deps.randomHex } : {}),
      });
      const tickers = aiTickers(
        await deps.store.getHoldingTickers(),
        await deps.store.getWatchlistTickers(),
      );
      const tally = newTally();
      await generateForTickers({
        deps,
        session,
        kind: 'filing-summary',
        def: filingSummaryPrompt,
        tickers,
        maxPerRun: MAX_SUMMARIES_PER_RUN,
        tally,
      });
      return {
        rows: tally.written,
        details: aiDetails(tally, session, { tickers: tickers.length }),
      };
    },
    () => deps.now().getTime(),
  );
  await deps.store.recordRun(run);
  return run;
}
