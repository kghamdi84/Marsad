import {
  CALENDAR_VERSION,
  economicCalendar,
  estimateNextEarnings,
  fetchReleaseDates,
  runJob,
  type FredConfig,
  type HttpClient,
  type JobRunRecord,
} from '@marsad/core';
import type { EarningsEstimateRow, Store } from './store.js';

export interface CalendarJobDeps {
  http: HttpClient;
  fred: FredConfig;
  store: Store;
  now: () => Date;
  /** Days ahead the economic calendar covers. */
  aheadDays?: number;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Writes one snapshot of the economic calendar (FRED release dates plus FOMC statements) and one of the estimated
 * next results release for each watchlist company (from its stored 8-K item 2.02 filings), ADR 0013.
 */
export async function runCalendarJob(deps: CalendarJobDeps): Promise<JobRunRecord> {
  const { http, fred, store, now } = deps;
  const run = await runJob(
    'calendar-daily',
    async () => {
      const at = now();
      const today = iso(at.getTime());
      const to = iso(at.getTime() + (deps.aheadDays ?? 60) * DAY);
      const r = await fetchReleaseDates(http, fred, today, to);
      if (!r.ok) throw new Error(`FRED release dates: ${r.display} (${r.kind}: ${r.message})`);
      const events = economicCalendar(r.data.value ?? [], today, to);
      await store.saveEconCalendar(at, CALENDAR_VERSION, today, to, events);

      const instruments = await store.getInstruments();
      const filings = await store.getResultsFilingDates();
      const byCik = new Map<string, string[]>();
      for (const f of filings) byCik.set(f.cik, [...(byCik.get(f.cik) ?? []), f.date]);
      const estimates: EarningsEstimateRow[] = instruments.flatMap((i) => {
        const e = estimateNextEarnings(byCik.get(i.cik) ?? [], today);
        return e ? [{ ...e, ticker: i.ticker, cik: i.cik }] : [];
      });
      estimates.sort((a, b) => a.date.localeCompare(b.date));
      await store.saveEarningsEstimates(at, CALENDAR_VERSION, estimates);
      return {
        rows: events.length + estimates.length,
        details: {
          events: events.length,
          next: events[0] ? `${events[0].date} ${events[0].name}` : null,
          estimates: estimates.length,
          withoutHistory: instruments.length - estimates.length,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
