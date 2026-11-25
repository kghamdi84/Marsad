/**
 * Pure helpers behind the Study page: summary statistics from daily bars and the placement of filing and
 * split events on the chart. Point-in-time: a filing accepted after the close belongs to the next bar.
 */
import { describeEightK, type Materiality } from './filings.js';
import { etDate, etWallToUtc } from './calendar.js';
import { atr, rsi, rvol, sma } from './indicators.js';

/** Version of the formulas behind the figures on the page, shown with them (integrity rule 1). */
export const INDICATOR_VERSION = 'indicators-1';

export interface DailyBar {
  /** ET date, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

export type Trend =
  'above-both' | 'above-50-below-200' | 'below-50-above-200' | 'below-both' | 'unknown';

export interface BarSummary {
  asOf: string;
  lastClose: number;
  previousClose: number | null;
  changePct: number | null;
  high52w: number;
  low52w: number;
  /** Sessions the high and low cover: 252 for a full year, fewer when less history exists. */
  rangeSessions: number;
  sessions: number;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  atr14: number | null;
  rvol20: number | null;
  trend: Trend;
  formulaVersion: string;
}

const last = <T>(a: readonly T[]): T | null => (a.length > 0 ? (a[a.length - 1] as T) : null);

/**
 * Summarises ascending daily bars. A figure that needs more history than exists is null (data unavailable),
 * never a number computed from too little. Throws if the dates are not strictly ascending, because
 * indicators over scrambled bars are wrong rather than merely late.
 */
export function summarizeBars(bars: readonly DailyBar[]): BarSummary | null {
  const final = last(bars);
  if (final === null) return null;
  for (let i = 1; i < bars.length; i += 1) {
    if ((bars[i] as DailyBar).date <= (bars[i - 1] as DailyBar).date)
      throw new RangeError(`Bars are not in ascending date order at ${(bars[i] as DailyBar).date}`);
  }
  const close = bars.map((b) => b.close);
  const prev = bars.length > 1 ? (bars[bars.length - 2] as DailyBar).close : null;
  const window = bars.slice(-252);
  const s50 = last(sma(close, 50));
  const s200 = last(sma(close, 200));
  let trend: Trend = 'unknown';
  if (s50 !== null && s200 !== null) {
    const a50 = final.close > s50;
    const a200 = final.close > s200;
    trend =
      a50 && a200
        ? 'above-both'
        : a50
          ? 'above-50-below-200'
          : a200
            ? 'below-50-above-200'
            : 'below-both';
  }
  return {
    asOf: final.date,
    lastClose: final.close,
    previousClose: prev,
    changePct: prev === null || prev === 0 ? null : ((final.close - prev) / prev) * 100,
    high52w: Math.max(...window.map((b) => b.high)),
    low52w: Math.min(...window.map((b) => b.low)),
    rangeSessions: window.length,
    sessions: bars.length,
    sma50: s50,
    sma200: s200,
    rsi14: last(rsi(close, 14)),
    atr14: last(
      atr(
        bars.map((b) => b.high),
        bars.map((b) => b.low),
        close,
        14,
      ),
    ),
    rvol20: last(
      rvol(
        bars.map((b) => b.volume),
        20,
      ),
    ),
    trend,
    formulaVersion: INDICATOR_VERSION,
  };
}

/**
 * The bar an event belongs to. An event accepted before the 16:00 ET close belongs to that day's bar (or the
 * next trading bar if the day has none); one accepted at or after the close belongs to the next bar, because
 * nobody could trade on it during that session. Null when the event falls outside the bars shown.
 * `barDates` must be ascending ET dates.
 */
export function snapToBar(
  barDates: readonly string[],
  acceptedAt: string | null,
  fallbackDate: string,
): string | null {
  let from = fallbackDate;
  let strictlyAfter = false;
  if (acceptedAt !== null) {
    const t = new Date(acceptedAt);
    if (!Number.isNaN(t.getTime())) {
      from = etDate(t);
      strictlyAfter = t.getTime() >= etWallToUtc(from, 16, 0).getTime();
    }
  }
  const found = barDates.find((d) => (strictlyAfter ? d > from : d >= from));
  const lastDate = last(barDates);
  if (found === undefined || (barDates.length > 0 && from < (barDates[0] as string))) return null;
  return lastDate === null ? null : found;
}

export type MarkerKind =
  'high-8k' | 'medium-8k' | 'split' | 'dividend' | 'insider-buy' | 'halt' | 'alert';

export interface ChartMarker {
  /** The bar date the marker sits on. */
  date: string;
  kind: MarkerKind;
  /** Short text for the chart and for the list beneath it. */
  label: string;
  materiality: Materiality | null;
}

export interface FilingEvent {
  form: string;
  filingDate: string;
  acceptedAt: string | null;
  items: readonly string[];
}

/** Filing events from several lists with each filing once (same form, filing date and acceptance time). */
export function mergeFilingEvents(...lists: readonly (readonly FilingEvent[])[]): FilingEvent[] {
  const seen = new Set<string>();
  const out: FilingEvent[] = [];
  for (const f of lists.flat()) {
    const key = `${f.form}|${f.filingDate}|${f.acceptedAt ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export interface SplitEvent {
  executionDate: string;
  splitFrom: number;
  splitTo: number;
}

export interface DividendEvent {
  exDividendDate: string;
  cashAmount: number;
  currency: string;
}

/** An open-market purchase from a Form 4 (code P), placed on the day the filing became public. */
export interface InsiderBuyEvent {
  filedAt: string;
  owner: string;
  valueUsd: number | null;
  /** True when the filing says the trade was under a 10b5-1 plan. */
  plan10b5: boolean | null;
}

export interface HaltEvent {
  haltedAt: string;
  reason: string;
}

export interface AlertEvent {
  createdAt: string;
  headline: string;
}

/**
 * Markers for the chart: 8-Ks of high or medium materiality, splits, dividends (on the ex-dividend date, the
 * first day the stock trades without the dividend), insider open-market purchases (on the session the Form 4
 * became public, never the earlier trade date), trading halts and Marsad's own alerts. Other Form 4s and
 * low-materiality 8-Ks stay in the filings list, because hundreds of markers would hide the price.
 */
export function buildEventMarkers(
  filings: readonly FilingEvent[],
  splits: readonly SplitEvent[],
  barDates: readonly string[],
  dividends: readonly DividendEvent[] = [],
  more: {
    insiderBuys?: readonly InsiderBuyEvent[];
    halts?: readonly HaltEvent[];
    alerts?: readonly AlertEvent[];
  } = {},
): ChartMarker[] {
  const out: ChartMarker[] = [];
  // Insider purchases: one marker a session, with the number of owners and the total value.
  const buys = new Map<string, InsiderBuyEvent[]>();
  for (const b of more.insiderBuys ?? []) {
    const date = snapToBar(barDates, b.filedAt, b.filedAt.slice(0, 10));
    if (date === null) continue;
    buys.set(date, [...(buys.get(date) ?? []), b]);
  }
  for (const [date, list] of buys) {
    const owners = new Set(list.map((b) => b.owner)).size;
    const total = Math.round(list.reduce((a, b) => a + (b.valueUsd ?? 0), 0));
    const planned = list.every((b) => b.plan10b5 === true) ? ' (10b5-1 plan)' : '';
    out.push({
      date,
      kind: 'insider-buy',
      label: `Insider buy: ${owners} owner${owners === 1 ? '' : 's'}, $${total.toLocaleString('en-US')}${planned}`,
      materiality: null,
    });
  }
  for (const h of more.halts ?? []) {
    const date = snapToBar(barDates, h.haltedAt, h.haltedAt.slice(0, 10));
    if (date !== null)
      out.push({ date, kind: 'halt', label: `Halt: ${h.reason}`, materiality: null });
  }
  for (const a of more.alerts ?? []) {
    const date = snapToBar(barDates, a.createdAt, a.createdAt.slice(0, 10));
    if (date !== null)
      out.push({ date, kind: 'alert', label: `Alert: ${a.headline}`, materiality: null });
  }
  for (const f of filings) {
    if (f.form !== '8-K' && f.form !== '8-K/A') continue;
    const d = describeEightK(f.items);
    if (d.materiality !== 'high' && d.materiality !== 'medium') continue;
    const date = snapToBar(barDates, f.acceptedAt, f.filingDate);
    if (date === null) continue;
    const top = d.items.filter((i) => i.materiality === d.materiality).map((i) => i.plain);
    out.push({
      date,
      kind: d.materiality === 'high' ? 'high-8k' : 'medium-8k',
      label: `8-K: ${top.join('; ')}`,
      materiality: d.materiality,
    });
  }
  for (const s of splits) {
    const date = snapToBar(barDates, null, s.executionDate);
    if (date === null) continue;
    out.push({
      date,
      kind: 'split',
      label: `Split ${s.splitTo} for ${s.splitFrom}`,
      materiality: null,
    });
  }
  for (const d of dividends) {
    const date = snapToBar(barDates, null, d.exDividendDate);
    if (date === null) continue;
    out.push({
      date,
      kind: 'dividend',
      label: `Dividend ${d.currency === 'USD' ? '$' : `${d.currency} `}${d.cashAmount}`,
      materiality: null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
