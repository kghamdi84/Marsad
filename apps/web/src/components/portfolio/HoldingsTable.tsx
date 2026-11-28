import type { ReactNode } from 'react';
import {
  dayMoves,
  daysUntil,
  dividendYield,
  periodReturns,
  priceVsAverages,
  toFixedHalfUp,
  trailingDividends,
  mergeDividends,
  type BookPosition,
  type PeriodKey,
} from '@marsad/core';
import { Card, Segmented, useRemembered } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { StatTile } from '../journal/shared';
import { tauricDividends } from '../../lib/portfolio';
import { MixChart } from './MixChart';
import {
  Chg,
  MiniTable,
  Source,
  ViewState,
  arrowPct,
  arrowUsd,
  bookOf,
  nextEarnings,
  newestDate,
  p,
  pct1,
  price2,
  shortDate,
  tone,
  usd,
  usePortfolio,
  type Portfolio,
} from './shared';

const SETS = ['holdings', 'performance', 'dividends', 'earnings', 'technicals'] as const;
type ColumnSet = (typeof SETS)[number];
const h = p.table;

/** Value, day change, open result, cash and the day's top movers, one line each (squeeze: summary first). */
function Summary({ x, book }: { x: Portfolio; book: ReturnType<typeof bookOf> }) {
  const day = dayMoves(x.holdings, x.bars);
  const date = newestDate(x.bars, x.tickers);
  const open = book.value - book.cost;
  const openPct = book.cost > 0 ? book.value / book.cost - 1 : null;
  return (
    <section
      aria-label={p.summary.label}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5"
    >
      <StatTile
        label={p.summary.value}
        value={usd(book.value)}
        sub={
          book.unpriced.length > 0
            ? p.summary.unpriced(book.unpriced.join(', '))
            : p.summary.asOf(shortDate(date))
        }
      />
      <StatTile
        label={p.summary.day}
        value={arrowUsd(day.usd)}
        tone={tone(day.usd)}
        sub={day.pct === null ? p.na : arrowPct(day.pct, 2)}
      />
      <StatTile
        label={p.summary.open}
        value={arrowUsd(open)}
        tone={tone(open)}
        sub={openPct === null ? p.na : p.summary.onCost(arrowPct(openPct), usd(book.cost))}
      />
      <StatTile
        label={p.summary.cash}
        value={p.notTracked}
        tone="text-ink3"
        sub={p.summary.cashSub}
      />
      <StatTile
        label={p.summary.movers}
        value={
          <span className="text-sm">
            {day.gainers.length > 0 && (
              <span className="text-up">
                {'▲'} {day.gainers.join(', ')}
              </span>
            )}
            {day.gainers.length > 0 && day.losers.length > 0 && ' '}
            {day.losers.length > 0 && (
              <span className="text-down">
                {'▼'} {day.losers.join(', ')}
              </span>
            )}
            {day.gainers.length + day.losers.length === 0 && p.summary.noMoves}
          </span>
        }
        sub={
          day.rows[0]
            ? p.summary.dayOf(shortDate(day.rows[0].prevDate), shortDate(day.rows[0].date))
            : undefined
        }
      />
    </section>
  );
}

interface RowCtx {
  x: Portfolio;
  pos: BookPosition;
  weight: number;
}

const PERIODS: readonly PeriodKey[] = ['w1', 'm1', 'm3', 'ytd', 'y1'];

/** The columns of each set: header and cell. Every cell either has a number or says why it has none. */
function columns(set: ColumnSet): { head: string; cell: (c: RowCtx) => ReactNode }[] {
  if (set === 'holdings')
    return [
      { head: h.shares, cell: (c) => toFixedHalfUp(c.pos.shares, c.pos.shares % 1 ? 2 : 0) },
      { head: h.avgCost, cell: (c) => price2(c.pos.costBasis) },
      {
        head: h.last,
        cell: (c) => `${price2(c.pos.price)} (${shortDate(c.pos.priceDate)})`,
      },
      {
        head: h.dayUsd,
        cell: (c) => {
          const b = c.x.bars[c.pos.ticker] ?? [];
          const prev = b.at(-2)?.close;
          if (prev === undefined) return <span className="text-ink3">{p.na}</span>;
          const v = c.pos.shares * (c.pos.price - prev);
          return <span className={tone(v)}>{arrowUsd(v)}</span>;
        },
      },
      {
        head: h.dayPct,
        cell: (c) => {
          const prev = (c.x.bars[c.pos.ticker] ?? []).at(-2)?.close;
          return <Chg v={prev ? c.pos.price / prev - 1 : null} digits={2} />;
        },
      },
      { head: h.weight, cell: (c) => pct1(c.weight) },
      { head: h.value, cell: (c) => usd(c.pos.value) },
      {
        head: h.gainUsd,
        cell: (c) => <span className={tone(c.pos.usd)}>{arrowUsd(c.pos.usd)}</span>,
      },
      { head: h.gainPct, cell: (c) => <Chg v={c.pos.pct} /> },
      {
        head: h.opened,
        cell: (c) =>
          shortDate(
            c.x.holdings
              .filter((y) => y.ticker === c.pos.ticker)
              .map((y) => y.openedOn)
              .sort()[0],
          ),
      },
      {
        head: h.horizon,
        cell: (c) => {
          const hz = [
            ...new Set(
              c.x.holdings
                .filter((y) => y.ticker === c.pos.ticker)
                .map((y) => (y.horizon ? h.horizons[y.horizon] : h.horizonNone)),
            ),
          ];
          return hz.join(', ');
        },
      },
    ];
  if (set === 'performance')
    return PERIODS.map((k) => ({
      head: h.periods[k],
      cell: (c: RowCtx) => {
        const r = periodReturns(c.x.bars[c.pos.ticker] ?? [], c.x.bars['SPY'] ?? null)[k];
        return <Chg v={r?.stock ?? null} why={h.shortBars} />;
      },
    }));
  if (set === 'dividends') {
    const rows = (c: RowCtx) =>
      mergeDividends(
        (c.x.data?.dividends ?? []).filter((d) => d.ticker === c.pos.ticker),
        tauricDividends(c.x.data?.research ?? {}).filter((d) => d.ticker === c.pos.ticker),
      );
    const ttm = (c: RowCtx) => trailingDividends(rows(c), c.pos.priceDate ?? c.x.today);
    return [
      {
        head: h.ttm,
        cell: (c) => {
          const t = ttm(c);
          return t.payments === 0 ? (
            <span className="text-ink3">{h.noDividends}</span>
          ) : (
            price2(t.perShare)
          );
        },
      },
      {
        head: h.yield,
        cell: (c) => {
          const t = ttm(c);
          const y = t.payments === 0 ? null : dividendYield(t.perShare, c.pos.price);
          return y === null ? <span className="text-ink3">{p.na}</span> : pct1(y);
        },
      },
      {
        head: h.exDate,
        cell: (c) => {
          const t = ttm(c);
          const d = t.next ?? t.latest;
          if (!d) return <span className="text-ink3">{p.na}</span>;
          return `${t.next ? h.next : h.latest} ${shortDate(d.exDate)} (${price2(d.amount)}, ${h.src[d.source]})`;
        },
      },
      {
        head: h.income,
        cell: (c) => {
          const t = ttm(c);
          return t.payments === 0 ? (
            <span className="text-ink3">{h.noDividends}</span>
          ) : (
            usd(t.perShare * c.pos.shares)
          );
        },
      },
    ];
  }
  if (set === 'earnings') {
    const next = (c: RowCtx) => nextEarnings(c.x, c.pos.ticker);
    return [
      {
        head: h.nextEarnings,
        cell: (c) => {
          const n = next(c);
          if (!n) return <span className="text-ink3">{h.noEarnings}</span>;
          return `${shortDate(n.date)}${n.estimated ? ` ${h.estimated}` : ''}`;
        },
      },
      {
        head: h.days,
        cell: (c) => {
          const n = next(c);
          return n ? (
            String(daysUntil(c.x.today, n.date))
          ) : (
            <span className="text-ink3">{p.na}</span>
          );
        },
      },
      {
        head: h.eps,
        cell: (c) => {
          const n = next(c);
          return n?.eps === null || n?.eps === undefined ? (
            <span className="text-ink3">{p.na}</span>
          ) : (
            toFixedHalfUp(n.eps, 2)
          );
        },
      },
      {
        head: h.source,
        cell: (c) => {
          const n = next(c);
          return n ? h.src[n.source] : <span className="text-ink3">{p.na}</span>;
        },
      },
    ];
  }
  {
    const t = (c: RowCtx) => priceVsAverages((c.x.bars[c.pos.ticker] ?? []).map((b) => b.close));
    return [
      { head: h.vs50, cell: (c) => <Chg v={t(c).vs50} why={h.shortBars} /> },
      { head: h.vs200, cell: (c) => <Chg v={t(c).vs200} why={h.shortBars} /> },
      {
        head: h.rsi,
        cell: (c) => {
          const r = t(c).rsi14;
          return r === null ? (
            <span className="text-ink3">{h.shortBars}</span>
          ) : (
            toFixedHalfUp(r, 0)
          );
        },
      },
    ];
  }
}

const SOURCES: Record<ColumnSet, string> = {
  holdings: h.sources.holdings,
  performance: h.sources.performance,
  dividends: h.sources.dividends,
  earnings: h.sources.earnings,
  technicals: h.sources.technicals,
};

/**
 * Holdings table: one table with switchable column sets (Holdings, Performance, Dividends, Earnings, Technicals),
 * above it the summary row and the "Portfolio vs SPY" chart. Every column comes from stored data.
 */
export function HoldingsTable() {
  const x = usePortfolio();
  const [set, setSet] = useRemembered<ColumnSet>('marsad.portfolio.columns', SETS, 'holdings');
  const book = bookOf(x);
  const cols = columns(set);
  return (
    <div className="flex flex-col gap-4">
      <ViewState x={x}>
        <Summary x={x} book={book} />
        <Card id="portfolio-table-h" title={p.tableTitle} aside={<Info>{p.tableInfo}</Info>}>
          <MixChart
            holdings={x.holdings}
            bars={x.bars}
            storageKey="marsad.portfolio.mixRange"
            fallback="m3"
          />
          <Segmented
            label={h.setLabel}
            options={SETS.map((k) => ({ key: k, label: h.sets[k] }))}
            value={set}
            onChange={setSet}
          />
          <MiniTable
            label={h.aria(h.sets[set])}
            head={[h.ticker, ...cols.map((c) => c.head)]}
            rows={book.positions.map((pos) => [
              <TickerLink key="t" ticker={pos.ticker} />,
              ...cols.map((c) => c.cell({ x, pos, weight: pos.weight })),
            ])}
          />
          {book.unpriced.length > 0 && (
            <Source>{p.summary.unpriced(book.unpriced.join(', '))}</Source>
          )}
          <Source>{SOURCES[set]}</Source>
        </Card>
      </ViewState>
    </div>
  );
}
