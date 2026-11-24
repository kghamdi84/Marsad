/**
 * Massive endpoints behind the Study page: news, short interest, short volume and dividends. Shapes confirmed on
 * real NVIDIA responses recorded 2026-11-24 (fixtures/massive). All four work on the free plan.
 * Short interest comes twice a month and lags; short volume is daily and is not short interest.
 */
import type { NewsItem } from '../news.js';
import { HttpClient } from '../http.js';
import { massiveCall, type MassiveConfig } from './massive.js';
import type { AdapterResult } from './result.js';

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkTicker(t: string): void {
  if (!TICKER.test(t)) throw new RangeError(`Bad ticker: ${t}`);
}
function checkDate(d: string): void {
  if (!DATE.test(d)) throw new RangeError('date must be YYYY-MM-DD');
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export interface NewsArticle extends NewsItem {
  author: string | null;
  /** The vendor's one-line description. Untrusted text: wrap it before giving it to a model. */
  description: string | null;
  /** The vendor's own sentiment label per ticker. An opinion of the vendor's model, not a fact. */
  sentiment: { ticker: string; label: string; reasoning: string | null }[];
}

export function fetchNews(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  limit = 30,
): Promise<AdapterResult<NewsArticle[]>> {
  checkTicker(ticker);
  const path = `/v2/reference/news?ticker=${ticker}&limit=${limit}&order=desc&sort=published_utc`;
  return massiveCall(http, cfg, path, '/v2/reference/news', 1800_000, (items) => {
    const out: NewsArticle[] = [];
    for (const it of items) {
      const r = it as Record<string, unknown>;
      const publisher = (r['publisher'] as { name?: unknown } | undefined)?.name;
      const id = str(r['id']);
      const title = str(r['title']);
      const when = str(r['published_utc']);
      const url = str(r['article_url']);
      if (
        !id ||
        !title ||
        !when ||
        !url ||
        typeof publisher !== 'string' ||
        Number.isNaN(Date.parse(when))
      )
        return null;
      const insights = Array.isArray(r['insights'])
        ? (r['insights'] as Record<string, unknown>[])
        : [];
      out.push({
        id,
        publisher,
        title,
        publishedAt: new Date(when).toISOString(),
        url,
        tickers: Array.isArray(r['tickers'])
          ? (r['tickers'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        author: str(r['author']),
        description: str(r['description']),
        sentiment: insights
          .filter((i) => typeof i['ticker'] === 'string' && typeof i['sentiment'] === 'string')
          .map((i) => ({
            ticker: i['ticker'] as string,
            label: i['sentiment'] as string,
            reasoning: str(i['sentiment_reasoning']),
          })),
      });
    }
    const newest = out.reduce((m, a) => (a.publishedAt > m ? a.publishedAt : m), '');
    return { value: out, asOf: newest ? new Date(newest) : cfg.now() };
  });
}

export interface ShortInterestRow {
  ticker: string;
  settlementDate: string;
  shortInterest: number;
  avgDailyVolume: number | null;
  daysToCover: number | null;
}

export function fetchShortInterest(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  from: string,
): Promise<AdapterResult<ShortInterestRow[]>> {
  checkTicker(ticker);
  checkDate(from);
  const path = `/stocks/v1/short-interest?ticker=${ticker}&settlement_date.gte=${from}&sort=settlement_date.asc&limit=100`;
  return massiveCall(http, cfg, path, '/stocks/v1/short-interest', 6 * 3600_000, (items) => {
    const out: ShortInterestRow[] = [];
    for (const it of items) {
      const r = it as Record<string, unknown>;
      const date = str(r['settlement_date']);
      const si = num(r['short_interest']);
      if (!date || !DATE.test(date) || si === null || typeof r['ticker'] !== 'string') return null;
      out.push({
        ticker: r['ticker'],
        settlementDate: date,
        shortInterest: si,
        avgDailyVolume: num(r['avg_daily_volume']),
        daysToCover: num(r['days_to_cover']),
      });
    }
    const last = out.at(-1);
    return { value: out, asOf: last ? new Date(`${last.settlementDate}T00:00:00Z`) : cfg.now() };
  });
}

export interface ShortVolumeRow {
  ticker: string;
  date: string;
  totalVolume: number;
  shortVolume: number;
  /** Percent of the day's off-exchange-reported volume that was short sales, as the vendor computes it. */
  shortVolumeRatio: number | null;
  exemptVolume: number | null;
}

export function fetchShortVolume(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  from: string,
): Promise<AdapterResult<ShortVolumeRow[]>> {
  checkTicker(ticker);
  checkDate(from);
  const path = `/stocks/v1/short-volume?ticker=${ticker}&date.gte=${from}&sort=date.asc&limit=100`;
  return massiveCall(http, cfg, path, '/stocks/v1/short-volume', 6 * 3600_000, (items) => {
    const out: ShortVolumeRow[] = [];
    for (const it of items) {
      const r = it as Record<string, unknown>;
      const date = str(r['date']);
      const total = num(r['total_volume']);
      const short = num(r['short_volume']);
      if (
        !date ||
        !DATE.test(date) ||
        total === null ||
        short === null ||
        typeof r['ticker'] !== 'string'
      )
        return null;
      out.push({
        ticker: r['ticker'],
        date,
        totalVolume: total,
        shortVolume: short,
        shortVolumeRatio: num(r['short_volume_ratio']),
        exemptVolume: num(r['exempt_volume']),
      });
    }
    const last = out.at(-1);
    return { value: out, asOf: last ? new Date(`${last.date}T00:00:00Z`) : cfg.now() };
  });
}

export interface DividendRow {
  id: string;
  ticker: string;
  exDividendDate: string;
  recordDate: string | null;
  payDate: string | null;
  declarationDate: string | null;
  cashAmount: number;
  currency: string;
  frequency: number | null;
  distributionType: string | null;
  splitAdjustedCashAmount: number | null;
}

export function fetchDividends(
  http: HttpClient,
  cfg: MassiveConfig,
  ticker: string,
  from: string,
): Promise<AdapterResult<DividendRow[]>> {
  checkTicker(ticker);
  checkDate(from);
  const path = `/stocks/v1/dividends?ticker=${ticker}&ex_dividend_date.gte=${from}&sort=ex_dividend_date.asc&limit=100`;
  return massiveCall(http, cfg, path, '/stocks/v1/dividends', 6 * 3600_000, (items) => {
    const out: DividendRow[] = [];
    const date = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) ? v : null);
    for (const it of items) {
      const r = it as Record<string, unknown>;
      const ex = date(r['ex_dividend_date']);
      const cash = num(r['cash_amount']);
      const id = str(r['id']);
      if (!ex || cash === null || !id || typeof r['ticker'] !== 'string') return null;
      out.push({
        id,
        ticker: r['ticker'],
        exDividendDate: ex,
        recordDate: date(r['record_date']),
        payDate: date(r['pay_date']),
        declarationDate: date(r['declaration_date']),
        cashAmount: cash,
        currency: str(r['currency']) ?? 'USD',
        frequency: num(r['frequency']),
        distributionType: str(r['distribution_type']),
        splitAdjustedCashAmount: num(r['split_adjusted_cash_amount']),
      });
    }
    const last = out.at(-1);
    return { value: out, asOf: last ? new Date(`${last.exDividendDate}T00:00:00Z`) : cfg.now() };
  });
}
