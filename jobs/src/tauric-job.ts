import {
  STARTING_TICKERS,
  TAURIC_MAX_BATCH,
  buildCalendar,
  buildReport,
  fetchTauricQuotes,
  lastRegularClose,
  quoteFreshness,
  reconcileSessionClose,
  runJob,
  sessionInfo,
  worstState,
  type CheckResult,
  type HttpClient,
  type JobRunRecord,
  type TauricConfig,
  type TauricQuote,
  type UpcomingRow,
} from '@marsad/core';
import type { SourceStatusUpdate } from './store.js';

/** What the Tauric jobs read and write. Implemented over Supabase in tauric-store.ts and by a fake in tests. */
export interface TauricStore {
  getHolidays(exchange: string): Promise<UpcomingRow[]>;
  /** Every ticker on any saved watchlist. */
  getWatchlistTickers(): Promise<string[]>;
  upsertQuotes(quotes: readonly TauricQuote[], fetchedAt: Date): Promise<number>;
  /** Massive's newest stored daily bar for a ticker, or null. */
  getLatestDailyBar(
    ticker: string,
  ): Promise<{ date: string; close: number; volume: number } | null>;
  recordRun(run: JobRunRecord): Promise<void>;
  updateSourceStatus(update: SourceStatusUpdate): Promise<void>;
}

export interface TauricJobDeps {
  http: HttpClient;
  cfg: TauricConfig;
  store: TauricStore;
  now: () => Date;
}

/** Minutes after the regular close in which one more poll still runs, to catch the closing price. */
const AFTER_CLOSE_MINUTES = 15;

/** The starting list first (benchmarks included), then saved watchlists, at most one batch. */
export function quoteTickers(watchlists: readonly string[]): { tickers: string[]; left: number } {
  const all = [...new Set([...STARTING_TICKERS, ...watchlists])];
  return {
    tickers: all.slice(0, TAURIC_MAX_BATCH),
    left: Math.max(0, all.length - TAURIC_MAX_BATCH),
  };
}

/**
 * Polls Tauric for the latest quotes (ADR 0041). Runs in the regular session and for 15 minutes after the close;
 * outside that it records a skipped run and spends no credit. A failed call writes nothing and leaves the
 * source's last message where it was, so the health job sees the silence.
 */
export async function runTauricQuotesJob(deps: TauricJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'tauric-quotes',
    async () => {
      const at = now();
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const info = sessionInfo(at, calendar);
      const close = lastRegularClose(at, calendar);
      const justClosed =
        close !== null &&
        at.getTime() >= close.getTime() &&
        at.getTime() - close.getTime() <= AFTER_CLOSE_MINUTES * 60_000;
      if (info.calendarCovered && info.state !== 'regular' && !justClosed)
        return { rows: 0, skipped: `outside the regular session (${info.state})` };
      const { tickers, left } = quoteTickers(await store.getWatchlistTickers());
      const r = await fetchTauricQuotes(http, cfg, tickers);
      if (!r.ok) throw new Error(`Tauric quotes unavailable: ${r.display} (${r.kind})`);
      const got = r.data.value;
      if (got === null || got.quotes.length === 0)
        throw new Error(`Tauric returned no usable quote for ${tickers.length} tickers`);
      const fetchedAt = new Date(r.data.provenance.fetchedAt);
      const rows = await store.upsertQuotes(got.quotes, fetchedAt);
      const states = got.quotes.map((q) => quoteFreshness(q, at, calendar).state);
      const missing = got.missing.map((m) => `${m.key} (${m.code})`);
      await store.updateSourceStatus({
        source: 'tauric',
        lastMessageAt: fetchedAt,
        latencyMs: r.latencyMs,
        planTier: 'unknown',
        state: worstState(states),
        note:
          `${got.quotes.length} of ${tickers.length} quotes; delay not confirmed (ADR 0041)` +
          (missing.length > 0 ? `; no quote: ${missing.slice(0, 5).join(', ')}` : '') +
          (left > 0 ? `; ${left} watchlist tickers over the 50-ticker batch` : ''),
      });
      return {
        rows,
        details: { tickers: tickers.length, quotes: got.quotes.length, missing, overLimit: left },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}

/**
 * Nightly second-source check (ADR 0041, integrity rule 5): Tauric's price for the finished session against
 * Massive's daily bar for every starting ticker. Any disagreement beyond tolerance, a session one vendor lacks,
 * or nothing compared at all fails the run, so it shows on the Status page and the health job reports it.
 */
export async function runTauricReconcileJob(deps: TauricJobDeps): Promise<JobRunRecord> {
  const { store, now, http, cfg } = deps;
  const run = await runJob(
    'tauric-reconcile',
    async () => {
      const tickers = [...STARTING_TICKERS];
      const r = await fetchTauricQuotes(http, cfg, tickers);
      if (!r.ok) throw new Error(`Tauric quotes unavailable: ${r.display} (${r.kind})`);
      const quotes = new Map((r.data.value?.quotes ?? []).map((q) => [q.ticker, q]));
      const checks: CheckResult[] = [];
      for (const t of tickers) {
        const q = quotes.get(t);
        const bar = await store.getLatestDailyBar(t);
        if (!q) {
          checks.push({
            name: `${t} close`,
            ok: false,
            left: { label: 'Tauric close', value: null },
            right: { label: 'Massive close', value: bar?.close ?? null },
            diff: null,
            tolerance: 0,
            detail: 'Tauric gave no quote, cannot verify',
          });
          continue;
        }
        checks.push(...reconcileSessionClose(t, q, bar));
      }
      const report = buildReport(checks, now());
      if (report.failed.length > 0) {
        throw new Error(
          `Tauric and Massive disagree: ${report.failed.map((c) => `${c.name} (${c.detail})`).join('; ')}`.slice(
            0,
            480,
          ),
        );
      }
      return { rows: checks.length, details: { checks: checks.length, tickers: tickers.length } };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
