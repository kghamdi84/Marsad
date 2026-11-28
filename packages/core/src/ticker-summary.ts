/**
 * The nightly per-ticker summary (ADR 0048 section 4, ADR 0050; formula `ticker-summary-1`): one row per ticker per
 * session with the figures Watch, the quick look and Portfolio show, so a page reads one row instead of looping over
 * bars. Pure. It calls the engines the pages already use and adds no new math:
 *
 * - `tickerSummary` (`watch-1`): the 1-week return, the 52-week closing range and volume against its 20-day average;
 * - `periodReturn` (`company-brief-1`): the 1-month, 3-month and 1-year returns;
 * - `traderMetrics` (`trader-1`): ATR as a share of the close, the stretch from the 50-day average, strength
 *   against SPY over 63 sessions;
 * - `sma` and `rsi` (`indicators.ts`) for the averages, the RSI and the 20-session volume averages.
 *
 * Every figure that cannot be computed is null, with its reason in `unavailable` (data unavailable, never a guess).
 * Ratios are fractions: 0.12 is +12%, an ATR of 0.025 is 2.5% of the close.
 */
import { BRIEF_PERIODS, COMPANY_BRIEF_VERSION, periodReturn } from './company-brief.js';
import type {
  AnalystRecommendation,
  TauricAnalyst,
  TauricCalendar,
  TauricProfile,
} from './company-research.js';
import { RESEARCH_VERSION } from './company-research.js';
import { FORMULA_VERSIONS, rsi, sma } from './indicators.js';
import type { DailyBar } from './study.js';
import { RS_SESSIONS, TRADER_VERSION, daysBetween, traderMetrics } from './trader.js';
import { WATCH_VERSION, tickerSummary } from './watch.js';

export const TICKER_SUMMARY_VERSION = 'ticker-summary-1';

/** Sessions in each return window: a week (as Watch), then the company brief's month, quarter and year. */
export const SUMMARY_SESSIONS = Object.freeze({
  w1: 5,
  m1: BRIEF_PERIODS.m1,
  m3: BRIEF_PERIODS.m3,
  y1: BRIEF_PERIODS.y1,
});
/** The 52-week range covers this many sessions (as Watch's `range252`). */
export const RANGE_SESSIONS = 252;
/** Volume averages cover the sessions before the newest one (as Watch's volume ratio and `rvol`). */
export const VOLUME_SESSIONS = 20;
/** Dividends with an ex-date in the 365 calendar days ending on the close date count as trailing 12 months. */
export const DIVIDEND_DAYS = 365;
/** The year-to-date base must be a close in the last week of the previous year. */
export const YTD_BASE_DAYS = 7;

/** 'tracked': holdings, watchlists, SPY and sector funds, every column. 'market': price fields only. */
export type SummaryCoverage = 'tracked' | 'market';

/** The Select Sector SPDR for each GICS sector (the funds track GICS sectors one to one). */
export const GICS_SECTOR_FUNDS: Readonly<Record<string, string>> = Object.freeze({
  information_technology: 'XLK',
  financials: 'XLF',
  energy: 'XLE',
  health_care: 'XLV',
  industrials: 'XLI',
  consumer_discretionary: 'XLY',
  consumer_staples: 'XLP',
  utilities: 'XLU',
  materials: 'XLB',
  real_estate: 'XLRE',
  communication_services: 'XLC',
});

/** The fund for a GICS sector key or name ("Information Technology" or `information_technology`); null if unknown. */
export function sectorFundOf(sector: string | null | undefined): string | null {
  if (!sector) return null;
  const key = sector
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '');
  return GICS_SECTOR_FUNDS[key] ?? null;
}

export type ResultsDateSource = 'tauric' | 'marsad-estimate';

/**
 * The next results date after `session`: Tauric's stated date (`calendar.earnings.earnings_date`) when it is after
 * the session, else Marsad's `calendar-1` estimate when that is; null when neither is. The summary row and the
 * earnings guard (ADR 0052) both choose through this, so they never disagree on the date or its source.
 */
export function nextResultsDate(
  stated: string | null,
  estimated: string | null,
  session: string,
): { date: string; source: ResultsDateSource } | null {
  if (stated !== null && stated > session) return { date: stated, source: 'tauric' };
  if (estimated !== null && estimated > session)
    return { date: estimated, source: 'marsad-estimate' };
  return null;
}

/** The stored company research of one ticker (ADR 0047), as validated by `tauric-research-1`. */
export interface SummaryResearch {
  analyst: TauricAnalyst | null;
  profile: TauricProfile | null;
  calendar: TauricCalendar | null;
  analystRefreshedAt: string | null;
  profileRefreshedAt: string | null;
  calendarRefreshedAt: string | null;
  /** Why a part is missing, per part, as stored (`not_registered`, `temporarily_unavailable`, ...). */
  errors: Readonly<Record<string, string>>;
}

/** A cash dividend on today's share basis (split-adjusted by the caller). */
export interface SummaryDividend {
  exDividendDate: string;
  cashAmount: number;
  currency: string;
}

export interface TickerSummaryInput {
  ticker: string;
  /** The session the row is for (the last completed session). Bars after it are not used. */
  date: string;
  coverage: SummaryCoverage;
  /** Ascending daily bars, split-adjusted. */
  bars: readonly DailyBar[];
  /** SPY's ascending bars; null when not loaded. */
  spy: readonly DailyBar[] | null;
  /** Null: no research stored for the ticker. Ignored for 'market' rows. */
  research?: SummaryResearch | null;
  /** Null: dividends are not fetched for this ticker. An empty list: fetched, none paid. */
  dividends?: readonly SummaryDividend[] | null;
  /** Marsad's estimated next results date (`calendar-1`), the fallback when Tauric states none. */
  earningsEstimate?: { date: string } | null;
}

/** One `public.ticker_daily_summary` row, without `computed_at` (the writer's clock). */
export interface TickerSummaryRow {
  version: string;
  date: string;
  ticker: string;
  coverage: SummaryCoverage;
  close: number | null;
  close_date: string | null;
  return_1w: number | null;
  return_1m: number | null;
  return_3m: number | null;
  return_ytd: number | null;
  return_1y: number | null;
  high_52w: number | null;
  low_52w: number | null;
  range_position_52w: number | null;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  above_sma_50: boolean | null;
  above_sma_200: boolean | null;
  rsi_14: number | null;
  atr_14_pct: number | null;
  stretch_50_atr: number | null;
  avg_volume_20: number | null;
  volume_ratio_20: number | null;
  avg_dollar_volume_20: number | null;
  rs_spy_63: number | null;
  dividends_ttm: number | null;
  dividend_yield_ttm: number | null;
  next_earnings_date: string | null;
  next_earnings_source: ResultsDateSource | null;
  analyst_count: number | null;
  analyst_target_mean: number | null;
  analyst_recommendation: AnalystRecommendation | null;
  pe_ratio: number | null;
  beta: number | null;
  sector_etf: string | null;
  /** Why each null figure is null. */
  unavailable: Record<string, string>;
  /** Where each group of figures came from, with its as-of time. */
  sources: Record<string, Record<string, unknown>>;
  formula_versions: Record<string, string>;
}

/** The figure columns, in table order. */
export const SUMMARY_FIELDS = [
  'close',
  'close_date',
  'return_1w',
  'return_1m',
  'return_3m',
  'return_ytd',
  'return_1y',
  'high_52w',
  'low_52w',
  'range_position_52w',
  'sma_20',
  'sma_50',
  'sma_200',
  'above_sma_50',
  'above_sma_200',
  'rsi_14',
  'atr_14_pct',
  'stretch_50_atr',
  'avg_volume_20',
  'volume_ratio_20',
  'avg_dollar_volume_20',
  'rs_spy_63',
  'dividends_ttm',
  'dividend_yield_ttm',
  'next_earnings_date',
  'next_earnings_source',
  'analyst_count',
  'analyst_target_mean',
  'analyst_recommendation',
  'pe_ratio',
  'beta',
  'sector_etf',
] as const;
export type SummaryField = (typeof SUMMARY_FIELDS)[number];

/** The figures a 'market' row carries; every other column is null there. */
export const MARKET_FIELDS: ReadonlySet<SummaryField> = new Set([
  'close',
  'close_date',
  'return_1w',
  'return_1m',
  'return_3m',
  'return_ytd',
  'return_1y',
  'high_52w',
  'low_52w',
  'range_position_52w',
]);

const fewer = (n: number) => `fewer than ${n} bars`;
const lastOf = <T>(a: readonly T[]): T | null => (a.length > 0 ? (a[a.length - 1] as T) : null);

/** The summary row of one ticker for one session. Throws on bars out of date order (indicators would be wrong). */
export function tickerDailySummary(x: TickerSummaryInput): TickerSummaryRow {
  for (let i = 1; i < x.bars.length; i += 1)
    if ((x.bars[i] as DailyBar).date <= (x.bars[i - 1] as DailyBar).date)
      throw new RangeError(
        `${x.ticker}: bars are not in ascending date order at ${x.bars[i]?.date}`,
      );
  const bars = x.bars.filter((b) => b.date <= x.date); // point in time: nothing after the row's session
  const spy = x.spy ? x.spy.filter((b) => b.date <= x.date) : null;
  const n = bars.length;
  const last = lastOf(bars);
  const unavailable: Record<string, string> = {};
  const row: TickerSummaryRow = {
    version: TICKER_SUMMARY_VERSION,
    date: x.date,
    ticker: x.ticker,
    coverage: x.coverage,
    close: null,
    close_date: null,
    return_1w: null,
    return_1m: null,
    return_3m: null,
    return_ytd: null,
    return_1y: null,
    high_52w: null,
    low_52w: null,
    range_position_52w: null,
    sma_20: null,
    sma_50: null,
    sma_200: null,
    above_sma_50: null,
    above_sma_200: null,
    rsi_14: null,
    atr_14_pct: null,
    stretch_50_atr: null,
    avg_volume_20: null,
    volume_ratio_20: null,
    avg_dollar_volume_20: null,
    rs_spy_63: null,
    dividends_ttm: null,
    dividend_yield_ttm: null,
    next_earnings_date: null,
    next_earnings_source: null,
    analyst_count: null,
    analyst_target_mean: null,
    analyst_recommendation: null,
    pe_ratio: null,
    beta: null,
    sector_etf: null,
    unavailable,
    sources: {},
    formula_versions: {
      summary: TICKER_SUMMARY_VERSION,
      watch: WATCH_VERSION,
      returns: COMPANY_BRIEF_VERSION,
    },
  };
  /** Sets a figure, or records why it is null. */
  const put = <K extends SummaryField>(
    k: K,
    v: TickerSummaryRow[K] | null | undefined,
    why: string,
  ) => {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) {
      unavailable[k] = why;
      return;
    }
    (row as unknown as Record<string, unknown>)[k] = v;
  };

  // Prices (both coverages).
  if (!last) {
    for (const k of MARKET_FIELDS) unavailable[k] = 'no stored bars';
  } else {
    row.close = last.close;
    row.close_date = last.date;
    const w = tickerSummary(bars);
    put('return_1w', w?.change5d, fewer(SUMMARY_SESSIONS.w1 + 1));
    put('return_1m', periodReturn(bars, SUMMARY_SESSIONS.m1, null, null)?.stock, fewer(22));
    put('return_3m', periodReturn(bars, SUMMARY_SESSIONS.m3, null, null)?.stock, fewer(64));
    put('return_1y', periodReturn(bars, SUMMARY_SESSIONS.y1, null, null)?.stock, fewer(253));
    const yearStart = `${last.date.slice(0, 4)}-01-01`;
    const base = [...bars].reverse().find((b) => b.date < yearStart);
    put(
      'return_ytd',
      base && daysBetween(base.date, yearStart) <= YTD_BASE_DAYS && base.close > 0
        ? last.close / base.close - 1
        : null,
      base
        ? `no close in the last ${YTD_BASE_DAYS} days before ${yearStart}`
        : `no bar before ${yearStart}`,
    );
    const r = w?.range252 ?? null;
    put('high_52w', r?.high, fewer(RANGE_SESSIONS));
    put('low_52w', r?.low, fewer(RANGE_SESSIONS));
    put('range_position_52w', r?.position, fewer(RANGE_SESSIONS));
    row.sources['bars'] = {
      source: 'massive',
      table: 'daily_bars',
      plan_tier: 'end-of-day',
      as_of: last.date,
      sessions: n,
    };
  }

  if (x.coverage === 'market') {
    for (const k of SUMMARY_FIELDS)
      if (!MARKET_FIELDS.has(k)) unavailable[k] = 'not computed for market coverage';
    return row;
  }
  row.formula_versions['trader'] = TRADER_VERSION;
  row.formula_versions['sma'] = FORMULA_VERSIONS.sma;
  row.formula_versions['rsi'] = FORMULA_VERSIONS.rsi;
  row.formula_versions['atr'] = FORMULA_VERSIONS.atr;

  // Averages and indicators.
  const close = bars.map((b) => b.close);
  const s20 = lastOf(sma(close, 20));
  const s50 = lastOf(sma(close, 50));
  const s200 = lastOf(sma(close, 200));
  put('sma_20', s20, fewer(20));
  put('sma_50', s50, fewer(50));
  put('sma_200', s200, fewer(200));
  put('above_sma_50', last && s50 !== null ? last.close > s50 : null, fewer(50));
  put('above_sma_200', last && s200 !== null ? last.close > s200 : null, fewer(200));
  put('rsi_14', lastOf(rsi(close, 14)), fewer(15));
  const t = traderMetrics(bars, spy ?? []);
  put('atr_14_pct', t?.atrPct, fewer(14));
  put('stretch_50_atr', t?.stretch50, t?.atr14 === 0 ? 'ATR 14 is zero' : fewer(50));
  put(
    'rs_spy_63',
    t?.rsSpy,
    spy === null || spy.length === 0
      ? 'SPY bars not loaded'
      : `fewer than ${RS_SESSIONS + 1} sessions shared with SPY`,
  );
  if (spy && spy.length > 0) row.sources['spy'] = { table: 'daily_bars', as_of: lastOf(spy)?.date };

  // Volume: averages of the 20 sessions before the newest, the base of Watch's volume ratio.
  const prior = n >= VOLUME_SESSIONS + 1 ? n - 2 : -1;
  const avgVol =
    prior >= 0
      ? sma(
          bars.map((b) => b.volume),
          VOLUME_SESSIONS,
        )[prior]
      : null;
  const avgDollar =
    prior >= 0
      ? sma(
          bars.map((b) => b.close * b.volume),
          VOLUME_SESSIONS,
        )[prior]
      : null;
  put('avg_volume_20', avgVol, fewer(VOLUME_SESSIONS + 1));
  put('avg_dollar_volume_20', avgDollar, fewer(VOLUME_SESSIONS + 1));
  put(
    'volume_ratio_20',
    tickerSummary(bars)?.volumeRatio20,
    n < VOLUME_SESSIONS + 1 ? fewer(VOLUME_SESSIONS + 1) : 'no volume in the 20 sessions before',
  );

  // Dividends over the trailing 12 months.
  if (x.dividends === null || x.dividends === undefined) {
    unavailable['dividends_ttm'] = 'dividends not fetched for this ticker';
    unavailable['dividend_yield_ttm'] = 'dividends not fetched for this ticker';
  } else if (!last) {
    unavailable['dividends_ttm'] = 'no stored bars';
    unavailable['dividend_yield_ttm'] = 'no stored bars';
  } else {
    const inWindow = x.dividends.filter((d) => {
      const age = daysBetween(d.exDividendDate, last.date);
      return age >= 0 && age < DIVIDEND_DAYS;
    });
    const foreign = inWindow.find((d) => d.currency !== 'USD');
    if (foreign) {
      unavailable['dividends_ttm'] = `dividend in ${foreign.currency}`;
      unavailable['dividend_yield_ttm'] = `dividend in ${foreign.currency}`;
    } else {
      const ttm = inWindow.reduce((s, d) => s + d.cashAmount, 0);
      row.dividends_ttm = ttm;
      put('dividend_yield_ttm', last.close > 0 ? ttm / last.close : null, 'close is not positive');
    }
    row.sources['dividends'] = {
      source: 'massive',
      table: 'dividends',
      counted: inWindow.length,
      window_days: DIVIDEND_DAYS,
    };
  }

  // Research (Tauric, ADR 0047) and the next results date.
  const res = x.research ?? null;
  const partWhy = (part: 'analyst' | 'profile' | 'calendar') =>
    res === null
      ? 'no company research stored'
      : `no Tauric ${part}${res.errors[part] ? ` (${res.errors[part]})` : ''}`;
  const fieldWhy = (
    part: 'analyst' | 'profile',
    v: { field_states: Record<string, { reason: string }> } | null,
    field: string,
  ) =>
    v === null
      ? partWhy(part)
      : `Tauric ${part} has no ${field}${v.field_states[field] ? ` (${v.field_states[field]?.reason})` : ''}`;
  const a = res?.analyst ?? null;
  put('analyst_count', a?.number_of_analysts, fieldWhy('analyst', a, 'number_of_analysts'));
  put('analyst_target_mean', a?.target_mean_price, fieldWhy('analyst', a, 'target_mean_price'));
  put('analyst_recommendation', a?.recommendation, fieldWhy('analyst', a, 'recommendation'));
  const p = res?.profile ?? null;
  put('pe_ratio', p?.pe_ratio, fieldWhy('profile', p, 'pe_ratio'));
  put('beta', p?.beta, fieldWhy('profile', p, 'beta'));
  put(
    'sector_etf',
    sectorFundOf(p?.sector_key) ?? sectorFundOf(p?.sector),
    p === null ? partWhy('profile') : 'no GICS sector in the Tauric profile',
  );
  if (res !== null) {
    row.formula_versions['research'] = RESEARCH_VERSION;
    row.sources['research'] = {
      source: 'tauric',
      table: 'company_research',
      analyst_refreshed_at: res.analystRefreshedAt,
      profile_refreshed_at: res.profileRefreshedAt,
      calendar_refreshed_at: res.calendarRefreshedAt,
    };
  }
  const stated = res?.calendar?.earnings?.earnings_date ?? null;
  const estimated = x.earningsEstimate?.date ?? null;
  const next = nextResultsDate(stated, estimated, x.date);
  if (next !== null) {
    row.next_earnings_date = next.date;
    row.next_earnings_source = next.source;
    if (next.source === 'marsad-estimate') row.formula_versions['earnings_estimate'] = 'calendar-1';
  } else {
    const why =
      stated !== null || estimated !== null
        ? `no results date after ${x.date}`
        : `${partWhy('calendar')}, and no Marsad estimate`;
    unavailable['next_earnings_date'] = why;
    unavailable['next_earnings_source'] = why;
  }
  return row;
}
