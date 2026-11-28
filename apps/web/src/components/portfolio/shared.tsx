/**
 * What every portfolio view shares: one data hook (holdings and bars, Tauric research, stored dividends, Marsad's
 * earnings estimates), the book lots with their resolved sector and beta, and small formatting pieces. Each view
 * calls the hook itself, so a view can move to another page by moving one import; React Query reads each table
 * once.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  SECTOR_ETFS,
  beta,
  bookPositions,
  etDate,
  exitReview,
  limitBreaches,
  portfolioCheck,
  resolveLimits,
  toFixedHalfUp,
  type BookLot,
  type CheckRow,
  type DailyBar,
  type LimitState,
  type MixSeries,
  type PortfolioCheck,
} from '@marsad/core';
import { Pill } from '../ui/kit';
import { loadHoldings, type BarsByTicker, type StoredHolding } from '../../lib/journal';
import { loadLimitsRole, loadPortfolioData, type PortfolioData } from '../../lib/portfolio';
import { loadPortfolioLimits } from '../../lib/settings';
import { loadCalendar } from '../../lib/watch';
import { dayMonth, dayMonthYear } from '../../lib/dates';
import { t } from '../../strings';

export const p = t.portfolio;

/** The holdings and everything stored about them. `ready` is false until the holdings have loaded. */
export function usePortfolio() {
  const today = etDate(new Date());
  const hq = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const tickers = [...new Set((hq.data?.holdings ?? []).map((h) => h.ticker))].sort();
  const dq = useQuery({
    queryKey: ['portfolio-data', tickers, today],
    queryFn: () => loadPortfolioData(tickers, today),
    enabled: hq.isSuccess,
  });
  const cq = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar, enabled: hq.isSuccess });
  return {
    today,
    holdings: hq.data?.holdings ?? [],
    bars: hq.data?.bars ?? ({} as BarsByTicker),
    vix: hq.data?.vix ?? [],
    tickers,
    data: dq.data,
    calendar: cq.data,
    error: hq.error ?? dq.error ?? null,
    pending: hq.isPending || (hq.isSuccess && tickers.length > 0 && dq.isPending),
    empty: hq.isSuccess && hq.data.holdings.length === 0,
  };
}

export type Portfolio = ReturnType<typeof usePortfolio>;

const sectorOfEtf = (etf: string | null) =>
  etf === null ? null : (SECTOR_ETFS.find((s) => s.ticker === etf)?.sector ?? null);

/** Sector label: the holding's own sector fund, else Tauric's GICS sector, else null (Unclassified). */
export function sectorLabel(h: StoredHolding, data: PortfolioData | undefined): string | null {
  return sectorOfEtf(h.sectorEtf) ?? data?.research[h.ticker]?.profile?.sector ?? null;
}

/** Group label for the Groups view: the holding's own sector, else Tauric's sub-industry, else null. */
export function groupLabel(h: StoredHolding, data: PortfolioData | undefined): string | null {
  return sectorOfEtf(h.sectorEtf) ?? data?.research[h.ticker]?.profile?.sub_industry ?? null;
}

/** Each lot priced at its last stored close, with beta to SPY from stored bars (exposure-1) and its sector. */
export function lotsOf(
  holdings: readonly StoredHolding[],
  bars: BarsByTicker,
  data: PortfolioData | undefined,
  label: (h: StoredHolding, d: PortfolioData | undefined) => string | null = sectorLabel,
): BookLot[] {
  const spy = bars['SPY'] ?? [];
  return holdings.map((h) => {
    const b = bars[h.ticker] ?? [];
    const last = b.at(-1);
    return {
      ticker: h.ticker,
      shares: h.shares,
      costBasis: h.costBasis,
      price: last?.close ?? null,
      priceDate: last?.date ?? null,
      beta: beta(b, spy)?.slope ?? null,
      sector: label(h, data),
    };
  });
}

export const bookOf = (x: Portfolio) => bookPositions(lotsOf(x.holdings, x.bars, x.data));

/**
 * The limits that apply to the signed-in person: their stored row from Settings (`portfolio_limits`; the owner's
 * is seeded with the council's values), else the council's values for the owner and none for a member. When a
 * read fails it falls back to "No limit set" rather than waiting forever: the facts still show, and no limit is
 * assumed.
 */
export function useLimits() {
  const q = useQuery({ queryKey: ['limits-role'], queryFn: loadLimitsRole });
  const stored = useQuery({ queryKey: ['portfolio-limits'], queryFn: loadPortfolioLimits });
  if (q.isError || stored.isError) return resolveLimits({ role: 'member' });
  if (q.data && stored.isSuccess) return resolveLimits({ role: q.data, stored: stored.data });
  return null;
}
export type Limits = NonNullable<ReturnType<typeof useLimits>>;

/** The review and the check together: the check's open-risk row comes from the review. */
export function checkOf(x: Portfolio, limits: Limits, mix: MixSeries | null) {
  const earnings = Object.fromEntries(
    x.tickers.map((tk) => {
      const n = nextEarnings(x, tk);
      return [tk, n ? { date: n.date, estimated: n.estimated } : null];
    }),
  );
  const review = exitReview({ lots: x.holdings, bars: x.bars, earnings });
  const check = portfolioCheck({
    lots: lotsOf(x.holdings, x.bars, x.data),
    mix,
    cash: null,
    limits: limits.limits,
    openRisk: { pct: review.openRiskPct, unknown: review.noStop },
  });
  return { review, check };
}

/** A check row's figure: beta to two places, the rest as a percentage (a fall as its size). */
export const rowFigure = (r: CheckRow, v: number | null = r.value) =>
  v === null
    ? p.na
    : r.id === 'beta'
      ? toFixedHalfUp(v, 2)
      : pct1(r.id === 'drawdown' ? Math.abs(v) : v);

export function StatePill({ s }: { s: LimitState }) {
  if (s === 'above') return <Pill tone="down">{p.above}</Pill>;
  if (s === 'within') return <Pill tone="neutral">{p.within}</Pill>;
  return <Pill tone="neutral">{s === 'unset' ? p.limits.unset : p.na}</Pill>;
}

/**
 * The person's limits against the book: each with its figure, the limit (or "No limit set") and its state, then
 * every breach as one line of text with the figures. Never a block, never advice.
 */
export function LimitsList({ check, limits }: { check: PortfolioCheck; limits: Limits }) {
  const rows = check.rows.filter((r) => r.kind === 'limit');
  const breaches = limitBreaches(check);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col" aria-label={p.limits.label}>
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0"
          >
            <span className="text-ink2">
              {p.limits.name[r.id]}
              {r.subject && <span className="text-ink3"> {r.subject}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-2 tabular-nums">
              <span className="font-semibold text-ink">
                {r.id === 'cash' && r.value === null ? p.notTracked : rowFigure(r)}
              </span>
              <span className="text-xs text-ink3">
                {r.limit === null
                  ? p.limits.unset
                  : p.limits.limit(rowFigure(r, r.limit), r.minimum)}
              </span>
              <StatePill s={r.state} />
            </span>
          </li>
        ))}
      </ul>
      {breaches.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-ink2" aria-label={p.limits.breachesLabel}>
          {breaches.map((r) => (
            <li key={r.id}>
              {p.limits.breach(
                p.limits.name[r.id],
                r.subject,
                rowFigure(r),
                rowFigure(r, r.limit),
                r.minimum,
                r.id !== 'beta',
              )}
            </li>
          ))}
        </ul>
      )}
      {check.risk.openRisk && check.risk.openRisk.unknown.length > 0 && (
        <p className="text-xs text-ink3">
          {p.limits.riskUnknown(
            check.risk.openRisk.unknown.length,
            check.risk.openRisk.unknown.join(', '),
          )}
        </p>
      )}
      <p className="text-xs text-ink3">
        {limits.source === 'user' && limits.setOn
          ? p.limits.setByYou(dayMonthYear(limits.setOn))
          : p.limits.source[limits.source]}{' '}
        <Link
          to="/settings"
          search={{ view: 'prefs' }}
          className="inline-flex min-h-11 items-center text-link underline-offset-4 hover:underline"
        >
          {p.limits.edit}
        </Link>
      </p>
    </div>
  );
}

/**
 * The next earnings date of a ticker: Tauric's stated date when it is today or later, else Marsad's estimate from
 * results filings (never a confirmed date), else null.
 */
export function nextEarnings(
  x: Pick<Portfolio, 'data' | 'calendar' | 'today'>,
  ticker: string,
): {
  date: string;
  eps: number | null;
  source: 'tauric-calendar' | 'marsad-estimate';
  estimated: boolean;
} | null {
  const cal = x.data?.research[ticker]?.calendar?.earnings;
  if (cal?.earnings_date && cal.earnings_date >= x.today)
    return {
      date: cal.earnings_date,
      eps: cal.eps_estimate,
      source: 'tauric-calendar',
      estimated: false,
    };
  const est = x.calendar?.earnings?.estimates.find((e) => e.ticker === ticker);
  return est ? { date: est.date, eps: null, source: 'marsad-estimate', estimated: true } : null;
}

/** Newest close date across the holdings. */
export const newestDate = (bars: BarsByTicker, tickers: readonly string[]) =>
  tickers.map((tk) => bars[tk]?.at(-1)?.date ?? '').reduce((a, b) => (b > a ? b : a), '');

export const lastBar = (bars: BarsByTicker, tk: string): DailyBar | null =>
  bars[tk]?.at(-1) ?? null;

/** "60.0%" from a fraction. */
export const pct1 = (v: number) => `${v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;

/** "▲ +5.0%" or "▼ −3.2%" from a fraction: sign and arrow with the colour (never colour alone). */
export const arrowPct = (v: number, digits = 1) =>
  `${v >= 0 ? '▲ +' : '▼ −'}${toFixedHalfUp(Math.abs(v) * 100, digits)}%`;

/** "$1,234" (whole dollars). */
export const usd = (v: number) =>
  `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;

/** "▲ +$1,234" or "▼ −$408". */
export const arrowUsd = (v: number) =>
  `${v >= 0 ? '▲ +' : '▼ −'}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;

export const price2 = (v: number) => toFixedHalfUp(v, 2);

export const tone = (v: number | null | undefined) =>
  v === null || v === undefined ? 'text-ink3' : v >= 0 ? 'text-up' : 'text-down';

export const shortDate = (iso: string | null | undefined) =>
  iso ? dayMonth(iso.slice(0, 10)) : '';
export const longDate = (iso: string | null | undefined) =>
  iso ? dayMonthYear(iso.slice(0, 10)) : '';

/** A change as text with its colour; "data unavailable" (with the reason when given) when null. */
export function Chg({ v, digits = 1, why }: { v: number | null; digits?: number; why?: string }) {
  if (v === null) return <span className="text-ink3">{why ?? p.na}</span>;
  return <span className={`tabular-nums ${tone(v)}`}>{arrowPct(v, digits)}</span>;
}

/** The small source and as-of line under a view. */
export function Source({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink3">{children}</p>;
}

/** The shared empty and loading states of a portfolio view. */
export function ViewState({ x, children }: { x: Portfolio; children: ReactNode }) {
  if (x.error) return <p className="text-sm text-down">{x.error.message}</p>;
  if (x.pending) return <p className="text-sm text-ink3">{t.loading}</p>;
  if (x.empty) return <p className="text-sm text-ink3">{p.noHoldings}</p>;
  return <>{children}</>;
}

/** A compact table: header row, then rows; wide tables scroll inside their own region. */
export function MiniTable({
  label,
  head,
  rows,
  align,
}: {
  label: string;
  head: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  /** 'end' for numeric columns; the first column defaults to start. */
  align?: readonly ('start' | 'end')[];
}) {
  const a = (i: number) =>
    (align?.[i] ?? (i === 0 ? 'start' : 'end')) === 'end' ? 'text-end' : 'text-start';
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="overflow-x-auto focus:outline focus:outline-focus"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink3">
            {head.map((h, i) => (
              <th key={i} scope="col" className={`px-2 py-2 font-medium whitespace-nowrap ${a(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {r.map((c, j) =>
                j === 0 ? (
                  <th
                    key={j}
                    scope="row"
                    className={`px-2 py-2 font-semibold whitespace-nowrap text-ink ${a(j)}`}
                  >
                    {c}
                  </th>
                ) : (
                  <td key={j} className={`px-2 py-2 whitespace-nowrap tabular-nums ${a(j)}`}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
