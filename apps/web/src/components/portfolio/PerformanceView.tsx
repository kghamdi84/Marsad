import { useQuery } from '@tanstack/react-query';
import {
  MIN_CASES,
  PERIOD_SESSIONS,
  closedTradeSummary,
  currentMix,
  monthlyReturns,
  rPerformance,
  recentActivity,
  toFixedHalfUp,
  ytdSessions,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { loadTrades } from '../../lib/journal';
import { ActualResult } from './ActualResult';
import { monthYear } from '../../lib/dates';
import {
  Chg,
  MiniTable,
  Source,
  ViewState,
  bookOf,
  longDate,
  p,
  pct1,
  shortDate,
  tone,
  usePortfolio,
  type Portfolio,
} from './shared';

const f = p.performance;
const r1 = (v: number | null) =>
  v === null ? p.na : `${v >= 0 ? '+' : '−'}${toFixedHalfUp(Math.abs(v), 2)}R`;
const d1 = (v: number | null) => (v === null ? p.na : toFixedHalfUp(v, 1));

/** Closed trades in R. Below 30 closed trades: counts only, never a percentage or a mean. */
function Trades() {
  const q = useQuery({ queryKey: ['trades'], queryFn: loadTrades });
  if (q.isError) return <p className="text-sm text-down">{q.error.message}</p>;
  if (!q.data) return <p className="text-sm text-ink3">{p.loading}</p>;
  const s = closedTradeSummary(q.data.trades);
  const r = rPerformance(q.data.trades);
  const ad = r.adherence;
  const rows: [string, string][] = s.insufficient
    ? [
        [f.profitable, f.profitableCount(s.profitable, s.closed)],
        [f.winLoss, f.winLossCount(r.winners, r.losers, r.flat)],
        [f.withStop, f.withStopCount(r.withR, r.closed)],
        [f.adherenceSplit, f.adherenceCount(ad.high.n, ad.low.n)],
      ]
    : [
        [f.winRate, pct1(s.winRate as number)],
        [f.meanReturn, s.meanReturn === null ? p.na : pct1(s.meanReturn)],
        [f.expectancy, r1(r.expectancyR)],
        [f.avgWinLoss, `${r1(r.avgWinR)} / ${r1(r.avgLossR)}`],
        [f.daysHeld, `${d1(r.winnerDays)} / ${d1(r.loserDays)}`],
        [
          f.adherenceSplit,
          ad.insufficient
            ? f.adherenceCount(ad.high.n, ad.low.n)
            : `${r1(ad.high.meanR)} / ${r1(ad.low.meanR)}`,
        ],
      ];
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold text-ink3">{f.tradesTitle}</h3>
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0"
          >
            <dt className="text-ink2">{k}</dt>
            <dd className="font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {s.insufficient && <p className="text-xs text-ink3">{f.insufficient(s.closed, MIN_CASES)}</p>}
      <Source>{f.tradesSource}</Source>
    </div>
  );
}

function Activity({ x }: { x: Portfolio }) {
  const q = useQuery({ queryKey: ['trades'], queryFn: loadTrades });
  if (!q.data) return null;
  const book = bookOf(x);
  const rows = recentActivity(q.data.trades, x.holdings).slice(0, 12);
  if (rows.length === 0) return <p className="text-sm text-ink3">{f.noActivity}</p>;
  return (
    <MiniTable
      label={f.activityTitle}
      head={[p.table.ticker, p.table.weight, f.ret, f.transactions, f.lastAction]}
      rows={rows.map((a) => {
        const pos = book.positions.find((y) => y.ticker === a.ticker);
        return [
          <TickerLink key="t" ticker={a.ticker} />,
          pos ? pct1(pos.weight) : f.notHeld,
          pos ? <Chg key="c" v={pos.pct} /> : <Chg key="c" v={a.lastClosedReturn} />,
          String(a.transactions),
          `${f.actions[a.lastAction]} ${shortDate(a.lastDate)}`,
        ];
      })}
    />
  );
}

/**
 * Performance: closed trades in R (ADR 0048), the current holdings' returns and monthly bars against SPY (labelled
 * as today's weights, not the account's result), and the recent activity from the Journal.
 */
export function PerformanceView() {
  const x = usePortfolio();
  const spy = x.bars['SPY'] ?? [];
  const ytd = ytdSessions(spy);
  const periods = [
    ['m1', PERIOD_SESSIONS.m1],
    ['m6', PERIOD_SESSIONS.m6],
    ['y1', PERIOD_SESSIONS.y1],
    ['ytd', ytd],
  ] as const;
  const year = currentMix(x.holdings, x.bars, PERIOD_SESSIONS.y1);
  const months = year ? monthlyReturns(year).slice(-12) : [];
  const span = Math.max(0.0001, ...months.flatMap((m) => [Math.abs(m.portfolio), Math.abs(m.spy)]));
  return (
    <Card id="portfolio-performance-h" title={f.title} aside={<Info>{f.info}</Info>}>
      <ActualResult />
      <ViewState x={x}>
        <Trades />
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink3">{f.holdingsTitle}</h3>
          <p className="text-xs text-ink3">{p.mix.label}</p>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-2">
            {periods.map(([k, n]) => {
              const m = n === null || n === 0 ? null : currentMix(x.holdings, x.bars, n);
              const full = m !== null && m.sessions === n;
              const last = m?.points.at(-1);
              return (
                <div
                  key={k}
                  className="flex flex-col rounded-[10px] border border-line bg-elev p-2.5"
                >
                  <dt className="text-xs text-ink3">{p.table.periods[k]}</dt>
                  <dd className="text-sm font-semibold">
                    <Chg v={full && last ? last.portfolio : null} why={p.table.shortBars} />
                  </dd>
                  <dd className="text-xs text-ink3">
                    {full && last
                      ? f.spyLine(last.spy >= 0 ? `+${pct1(last.spy)}` : pct1(last.spy))
                      : ''}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink3">{f.monthlyTitle}</h3>
          {months.length === 0 ? (
            <p className="text-sm text-ink3">{p.mix.none}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={f.monthlyTitle}>
              {months.map((m) => (
                <li
                  key={m.month}
                  className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-xs"
                >
                  <span className="text-ink2">
                    {monthYear(`${m.month}-01`)}
                    {m.partial && (
                      <span className="block text-ink3">
                        {f.partial(shortDate(m.from), shortDate(m.to))}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col gap-1">
                    {(
                      [
                        [f.mine, m.portfolio, 'bg-accent'],
                        [p.mix.spy, m.spy, 'bg-ink3'],
                      ] as const
                    ).map(([lbl, v, cls]) => (
                      <span
                        key={lbl}
                        className="grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2"
                      >
                        <span className="text-ink3">{lbl}</span>
                        <span className="h-1.5 rounded-full bg-sub">
                          <span
                            className={`block h-full rounded-full ${cls}`}
                            style={{ width: `${(Math.abs(v) / span) * 100}%` }}
                          />
                        </span>
                        <span className={`text-end tabular-nums ${tone(v)}`}>
                          <Chg v={v} />
                        </span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {year && <Source>{f.monthlySource(longDate(year.from), longDate(year.to))}</Source>}
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink3">{f.activityTitle}</h3>
          <Activity x={x} />
          <Source>{f.activitySource}</Source>
        </div>
      </ViewState>
    </Card>
  );
}
