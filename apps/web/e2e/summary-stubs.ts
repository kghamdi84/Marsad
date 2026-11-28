import type { Page, Route } from '@playwright/test';
import { TICKER_SUMMARY_VERSION, tickerDailySummary, type TickerSummaryRow } from '@marsad/core';

/**
 * Stubs for `daily_bars` and `ticker_daily_summary` shared by the specs that read the nightly summary (ADR 0050).
 * The bars are synthetic (not market data): weekdays ending on `end`, oldest first, each ticker its own gentle
 * line so the figures differ. The summary rows are computed from the same bars by core's `tickerDailySummary`,
 * the function the nightly job runs, so a page reading the row and a page computing from bars must agree.
 */

export const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** `n` weekdays ending on `end` (inclusive), oldest first. */
export function weekdays(end: string, n: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${end}T00:00:00Z`); out.length < n; t -= 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

/** A ticker's synthetic bars: a base from its letters, a slow drift and a small wave, rounded to cents. */
export function syntheticSeries(ticker: string, dates: readonly string[]): Bar[] {
  const seed = [...ticker].reduce((s, c) => s + c.charCodeAt(0), 0);
  const base = 20 + (seed % 180);
  return dates.map((date, i) => {
    const close = Math.round((base * (1 + 0.0008 * i) + 2 * Math.sin(i / 7 + seed)) * 100) / 100;
    return {
      date,
      open: close,
      high: Math.round((close + 0.8) * 100) / 100,
      low: Math.round((close - 0.8) * 100) / 100,
      close,
      volume: 1_000_000 + ((seed * 7919 + i * 104_729) % 900_000),
      vwap: null,
    };
  });
}

/** The tickers a PostgREST filter names: `eq.X` or `in.(X,Y)`. */
export function tickersOf(route: Route): string[] {
  const v = new URL(route.request().url()).searchParams.get('ticker') ?? '';
  if (v.startsWith('eq.')) return [v.slice(3)];
  const m = /^in\.\((.*)\)$/.exec(v);
  return m ? (m[1] ?? '').split(',').map((s) => s.replace(/^"|"$/g, '')) : [];
}

/**
 * Answers `daily_bars` reads from `series` (by ticker): one ticker (`eq.`) returns its rows without a ticker
 * column, newest first unless ascending; several (`in.`) return rows with the ticker, newest first, cut to the
 * request's limit as PostgREST would.
 */
export async function routeBars(page: Page, series: (tk: string) => readonly Bar[]) {
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const url = new URL(r.request().url());
    const tks = tickersOf(r);
    const asc = url.searchParams.get('order')?.includes('date.asc') ?? false;
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    if ((url.searchParams.get('ticker') ?? '').startsWith('eq.')) {
      const rows = [...series(tks[0] ?? '')];
      return r.fulfill(json((asc ? rows : rows.reverse()).slice(0, limit)));
    }
    const rows = tks
      .flatMap((tk) => series(tk).map((b) => ({ ticker: tk, ...b })))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, limit);
    return r.fulfill(json(rows));
  });
}

export type StoredRow = TickerSummaryRow & { computed_at: string };

/** A summary row from bars, as the job writes it (no research, no dividends), with overrides. */
export function summaryRow(
  ticker: string,
  bars: readonly Bar[],
  spy: readonly Bar[],
  over: Partial<StoredRow> = {},
): StoredRow {
  const date = bars.at(-1)?.date ?? '2026-11-27';
  return {
    ...tickerDailySummary({
      ticker,
      date,
      coverage: 'tracked',
      bars,
      spy,
      research: null,
      dividends: null,
      earningsEstimate: null,
    }),
    computed_at: `${date}T11:25:00+00:00`,
    ...over,
  };
}

/** Answers `ticker_daily_summary` reads with the stored rows of the tickers asked for; counts the reads. */
export async function routeSummary(
  page: Page,
  rows: readonly StoredRow[],
  seen?: { urls: string[] },
) {
  await page.route('**/rest/v1/ticker_daily_summary**', (r) => {
    seen?.urls.push(decodeURIComponent(r.request().url()));
    const url = new URL(r.request().url());
    const asked = new Set(tickersOf(r));
    const cov = url.searchParams.get('coverage')?.replace(/^eq\./, '');
    const out = rows
      .filter((x) => x.version === TICKER_SUMMARY_VERSION)
      .filter((x) => asked.size === 0 || asked.has(x.ticker))
      .filter((x) => !cov || x.coverage === cov)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return r.fulfill(json(out));
  });
}
