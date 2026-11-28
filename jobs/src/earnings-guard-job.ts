import {
  EARNINGS_GUARD_LOOKBACK_DAYS,
  EARNINGS_GUARD_RULE,
  EARNINGS_GUARD_SESSIONS,
  EARNINGS_GUARD_VERSION,
  buildCalendar,
  earningsGuardAlert,
  earningsGuardScan,
  lastCompletedTradingDay,
  parseEarningsGuardEventId,
  runJob,
  type EarningsDateInputs,
  type GuardClose,
  type JobRunRecord,
  type PriorGuardAlert,
} from '@marsad/core';
import { alertContext, pipelineAndStore } from './alert-writer.js';
import type { Store } from './store.js';
import { researchOf, type StoredResearchRow } from './ticker-summary-job.js';

/** The newest stored `calendar-1` estimates snapshot. */
export interface StoredEstimates {
  computedAt: string;
  rows: { ticker: string; date: string; from: string; to: string }[];
}

/** What the earnings guard reads and writes. Over Supabase in earnings-guard-store.ts; a fake in tests. */
export type EarningsGuardStore = Pick<
  Store,
  | 'getHolidays'
  | 'getOpenHoldings'
  | 'getDailyBars'
  | 'getBarsFetchedAt'
  | 'getAlertPreferences'
  | 'getRecentAlerts'
  | 'insertAlerts'
  | 'latest'
  | 'recordRun'
> & {
  /** Stored company research rows (ADR 0047) of these tickers. */
  getResearch(tickers: readonly string[]): Promise<StoredResearchRow[]>;
  /** The newest estimates snapshot, or null when none is stored. */
  getEarningsEstimates(): Promise<StoredEstimates | null>;
  /** Alerts of one rule created since an instant: id, creation time and event id. */
  getRuleAlerts(
    ruleId: string,
    since: string,
  ): Promise<{ id: string; createdAt: string; eventId: string | null }[]>;
};

export interface EarningsGuardDeps {
  store: EarningsGuardStore;
  now: () => Date;
}

/**
 * The earnings guard (ADR 0052): every open holding against its next results date (Tauric's stated date, else
 * Marsad's estimate); a holding whose date is within 5 trading sessions of the last completed session gets one
 * factual alert per date through the alert pipeline, with its input snapshot. Runs after the research and summary
 * jobs. A holding with no stored date is listed in the run, not alerted. A holding whose date source is older than a
 * week is named and the run fails after storing the rest: a silent gap must never look like "no earnings".
 */
export async function runEarningsGuardJob(deps: EarningsGuardDeps): Promise<JobRunRecord> {
  const { store, now } = deps;
  const run = await runJob(
    'earnings-guard',
    async () => {
      const at = now();
      const calendar = buildCalendar(await store.getHolidays('NYSE'), 'NYSE');
      const session = lastCompletedTradingDay(at, calendar);
      if (session === null)
        throw new Error('No completed trading day found, so sessions cannot be counted');
      const holdings = await store.getOpenHoldings();
      const tickers = [...new Set(holdings.map((h) => h.ticker))];

      const research = new Map(
        (tickers.length > 0 ? await store.getResearch(tickers) : []).map((r) => [r.ticker, r]),
      );
      const estimates = await store.getEarningsEstimates();
      const dates: Record<string, EarningsDateInputs> = {};
      const malformed: string[] = [];
      for (const t of tickers) {
        const row = research.get(t);
        const r = row ? researchOf(row) : null;
        if (r?.errors['calendar']?.startsWith('malformed'))
          malformed.push(`${t} (${r.errors['calendar']})`);
        const stated = r?.calendar?.earnings?.earnings_date ?? null;
        const est = estimates?.rows.find((e) => e.ticker === t);
        dates[t] = {
          tauric:
            stated === null
              ? null
              : {
                  date: stated,
                  // The earnings dataset's own refresh time, else the stored calendar's.
                  asOf:
                    r?.calendar?.earnings_status?.refreshed_at ?? r?.calendarRefreshedAt ?? null,
                },
          estimate:
            est && estimates
              ? { date: est.date, from: est.from, to: est.to, computedAt: estimates.computedAt }
              : null,
        };
      }

      const closes: Record<string, GuardClose | null> = {};
      for (const t of tickers) {
        const last = (await store.getDailyBars(t)).at(-1);
        const fetchedAt = await store.getBarsFetchedAt(t);
        closes[t] = last && fetchedAt ? { date: last.date, close: last.close, fetchedAt } : null;
      }

      const since = new Date(at.getTime() - EARNINGS_GUARD_LOOKBACK_DAYS * 86_400_000);
      const prior: PriorGuardAlert[] = (
        await store.getRuleAlerts(EARNINGS_GUARD_RULE, since.toISOString())
      ).flatMap((a) => {
        const p = a.eventId === null ? null : parseEarningsGuardEventId(a.eventId);
        return p ? [{ alertId: a.id, createdAt: a.createdAt, ...p }] : [];
      });

      const scan = earningsGuardScan({ at, session, calendar, holdings, dates, closes, prior });
      const context = await alertContext(store);
      const items = scan.snapshots.map((s) => ({
        input: earningsGuardAlert(s, context),
        sourceAt: s.earnings.asOf,
      }));
      const { rows, decisions } = await pipelineAndStore(store, items, at);
      const noClose = scan.snapshots.filter((s) => s.close === null).map((s) => s.holding.ticker);
      if (scan.stale.length > 0)
        throw new Error(
          `Earnings dates not checked for ${scan.stale.join('; ')}. ${rows} alert(s) stored for the rest.`.slice(
            0,
            480,
          ),
        );
      return {
        rows,
        details: {
          version: EARNINGS_GUARD_VERSION,
          session,
          windowSessions: EARNINGS_GUARD_SESSIONS,
          holdingsChecked: holdings.length,
          alerts: rows,
          noDate: scan.noDate.length,
          deduped: scan.deduped.length,
          later: scan.later,
          noDateTickers: scan.noDate,
          dedupedTickers: scan.deduped,
          ...(noClose.length > 0 ? { noClose } : {}),
          ...(malformed.length > 0 ? { malformedCalendar: malformed } : {}),
          ...(estimates === null ? { estimatesNote: 'no stored earnings estimates' } : {}),
          decisions,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
