import {
  RESEARCH_NOT_AVAILABLE,
  RESEARCH_PARTS,
  RESEARCH_VERSION,
  fetchTauricDataCredits,
  fetchTauricResearchPart,
  normalizeTicker,
  researchPartAsOf,
  runJob,
  validateResearchPart,
  type HttpClient,
  type JobRunRecord,
  type ResearchPart,
  type ResearchValue,
  type TauricConfig,
} from '@marsad/core';

/** One `public.company_research` write. A part left out keeps its stored value (a passing failure). */
export type CompanyResearchWrite = {
  ticker: string;
  source: 'tauric';
  fetched_at: string;
  errors: Partial<Record<ResearchPart, string>>;
} & Partial<Record<ResearchPart, ResearchValue | null>> &
  Partial<
    Record<
      | 'analyst_refreshed_at'
      | 'profile_refreshed_at'
      | 'thesis_generated_at'
      | 'calendar_refreshed_at',
      string | null
    >
  >;

/** What the research job reads and writes. Implemented over Supabase in tauric-store.ts and by a fake in tests. */
export interface TauricResearchStore {
  /** Tickers of open holdings (first in line). */
  getHoldingTickers(): Promise<string[]>;
  /** Every ticker on any saved watchlist. */
  getWatchlistTickers(): Promise<string[]>;
  upsertResearch(row: CompanyResearchWrite): Promise<void>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface TauricResearchDeps {
  http: HttpClient;
  cfg: TauricConfig;
  store: TauricResearchStore;
  now: () => Date;
}

/** Data credits per ticker at most: one per part that answers 200 (error answers cost none, measured 2026-11-28). */
export const CREDITS_PER_TICKER = RESEARCH_PARTS.length;
/** The most one run may spend: 10% of the Standard tier's 3,000 a day, so 75 tickers. */
export const RESEARCH_RUN_CREDIT_CAP = 300;
/** Credits always left for the quotes and reconcile jobs (about 111 a day, ADR 0041) and manual checks. */
export const RESEARCH_CREDIT_RESERVE = 300;
/** Warn in the run when the day's data pool passes this share of the allowance (integrity rule 18). */
export const CREDIT_WARNING_SHARE = 0.8;

const AS_OF_COLUMN = {
  analyst: 'analyst_refreshed_at',
  profile: 'profile_refreshed_at',
  thesis: 'thesis_generated_at',
  calendar: 'calendar_refreshed_at',
} as const;

/** Holdings first, then watchlists, each ticker once, only tickers Marsad accepts. */
export function researchTickers(
  holdings: readonly string[],
  watchlists: readonly string[],
): string[] {
  const out: string[] = [];
  for (const raw of [...holdings, ...watchlists]) {
    const t = normalizeTicker(raw);
    if (t !== null && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Answers that stop the whole run: the key, the plan or the day's credits. Retrying the next ticker cannot help. */
function fatal(r: { kind: string; message: string }): boolean {
  return (
    r.kind === 'auth-failed' || r.kind === 'not-entitled' || /daily quota exhausted/.test(r.message)
  );
}

type TickerOutcome = 'not covered' | Partial<Record<ResearchPart, string>>;

/**
 * Daily company research (ADR 0047). Reads today's data-credit use (free), spends at most 300 credits and never
 * the last 300 of the day, and fetches the profile, analyst consensus, thesis and calendar of each holding and
 * watchlist ticker. Each part is validated in core; a malformed part is rejected with its reason and the stored
 * value is kept. A ticker Tauric does not carry costs one error answer and no credit.
 */
export async function runTauricResearchJob(deps: TauricResearchDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'tauric-research',
    async () => {
      const tickers = researchTickers(
        await store.getHoldingTickers(),
        await store.getWatchlistTickers(),
      );
      if (tickers.length === 0) return { rows: 0, skipped: 'no holding or watchlist tickers' };
      const credits = await fetchTauricDataCredits(http, cfg);
      const left =
        credits === null ? null : credits.allowance - credits.used - RESEARCH_CREDIT_RESERVE;
      const budget = Math.min(RESEARCH_RUN_CREDIT_CAP, left ?? RESEARCH_RUN_CREDIT_CAP);
      const creditDetails = {
        creditsBefore: credits?.used ?? null,
        allowance: credits?.allowance ?? null,
        budget,
        ...(credits === null
          ? { creditsNote: 'account usage unreadable; spent at most the run cap' }
          : {}),
      };
      if (budget < CREDITS_PER_TICKER)
        return {
          rows: 0,
          skipped: `daily data credits low (${credits?.used ?? '?'} of ${credits?.allowance ?? '?'} used, ${RESEARCH_CREDIT_RESERVE} kept for quotes)`,
          details: creditDetails,
        };

      let spent = 0;
      let rows = 0;
      const outcomes: Record<string, TickerOutcome> = {};
      const deferred: string[] = [];
      const malformed: string[] = [];
      const failed: string[] = [];
      let stored = 0;
      for (const ticker of tickers) {
        if (spent + CREDITS_PER_TICKER > budget) {
          deferred.push(ticker);
          continue;
        }
        const row: CompanyResearchWrite = {
          ticker,
          source: 'tauric',
          fetched_at: now().toISOString(),
          errors: {},
        };
        const parts: Partial<Record<ResearchPart, string>> = {};
        let notCarried: string | null = null;
        for (const part of RESEARCH_PARTS) {
          if (notCarried !== null) {
            row[part] = null;
            row[AS_OF_COLUMN[part]] = null;
            row.errors[part] = notCarried;
            continue;
          }
          const r = await fetchTauricResearchPart(http, cfg, part, ticker);
          if (!r.ok) {
            if (fatal(r)) {
              if (Object.keys(parts).length > 0) await store.upsertResearch(row);
              throw new Error(
                `Tauric research stopped at ${ticker} ${part}: ${r.display} (${r.kind})`,
              );
            }
            const code = r.code ?? r.kind;
            row.errors[part] = code;
            parts[part] = code;
            if (r.code !== null && RESEARCH_NOT_AVAILABLE.has(r.code)) {
              // Settled: Tauric has nothing here, so nothing stale is kept.
              row[part] = null;
              row[AS_OF_COLUMN[part]] = null;
              if (part === 'profile' && (r.code === 'not_registered' || r.code === 'delisted'))
                notCarried = r.code;
            } else {
              failed.push(`${ticker} ${part} (${code})`);
            }
            continue;
          }
          spent += 1;
          const v = validateResearchPart(part, r.json, ticker);
          if (!v.ok) {
            row.errors[part] = v.reason;
            parts[part] = v.reason;
            malformed.push(`${ticker} ${part}: ${v.reason}`);
            continue;
          }
          row[part] = v.value;
          row[AS_OF_COLUMN[part]] = researchPartAsOf(part, v.value);
          parts[part] = 'ok';
          stored += 1;
        }
        await store.upsertResearch(row);
        rows += 1;
        outcomes[ticker] = notCarried !== null ? 'not covered' : parts;
      }

      const usedAfter = credits === null ? null : credits.used + spent;
      const warning =
        credits !== null &&
        usedAfter !== null &&
        usedAfter >= CREDIT_WARNING_SHARE * credits.allowance
          ? `Tauric data credits at ${Math.round((usedAfter / credits.allowance) * 100)}% of today's ${credits.allowance}`
          : null;
      const details = {
        version: RESEARCH_VERSION,
        tickers: tickers.length,
        creditsSpent: spent,
        ...creditDetails,
        ...(warning ? { creditWarning: warning } : {}),
        outcomes,
        notCovered: Object.entries(outcomes)
          .filter(([, o]) => o === 'not covered')
          .map(([t]) => t),
        deferred,
        malformed,
        failed,
      };
      if (stored === 0 && (failed.length > 0 || malformed.length > 0))
        throw new Error(
          `No research part stored: ${[...failed, ...malformed].slice(0, 6).join('; ')}`.slice(
            0,
            480,
          ),
        );
      return { rows, details };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
