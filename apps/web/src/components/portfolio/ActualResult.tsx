import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { portfolioReturn } from '@marsad/core';
import { Details } from '../Card';
import { loadTrades } from '../../lib/journal';
import { loadTradeCloses } from '../../lib/portfolioReturn';
import { Chg, Source, longDate, p, shortDate, usd } from './shared';

const a = p.actual;

function Line({ k, v, note }: { k: string; v: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0">
      <dt className="text-ink2">{k}</dt>
      <dd className="flex flex-col items-end gap-0.5 font-semibold text-ink tabular-nums">
        {v}
        {note && <span className="text-xs font-normal text-ink3">{note}</span>}
      </dd>
    </div>
  );
}

const Why = ({ text }: { text: string }) => <span className="text-ink3">{text}</span>;

/**
 * "Your actual result" (core `portfolio-return-1`): the time-weighted and money-weighted return of the Journal's
 * trades over stored closes, beside SPY bought and sold with the same cash flows. The period, the trade and
 * missing-close counts and the method (what is left out) sit with the figures.
 */
export function ActualResult() {
  const tq = useQuery({ queryKey: ['trades'], queryFn: loadTrades });
  const trades = tq.data?.trades ?? [];
  const first = trades.reduce((m, t) => (m === '' || t.entryDate < m ? t.entryDate : m), '');
  const tickers = [...new Set(trades.map((t) => t.ticker))].sort();
  const cq = useQuery({
    queryKey: ['trade-closes', tickers, first],
    queryFn: () => loadTradeCloses(tickers, first),
    enabled: tq.isSuccess && first !== '',
  });
  const body = () => {
    if (tq.isError) return <p className="text-sm text-down">{tq.error.message}</p>;
    if (tq.isPending) return <p className="text-sm text-ink3">{p.loading}</p>;
    if (trades.length === 0) return <p className="text-sm text-ink3">{a.noTrades}</p>;
    if (cq.isError) return <p className="text-sm text-down">{cq.error.message}</p>;
    if (!cq.data) return <p className="text-sm text-ink3">{p.loading}</p>;
    const r = portfolioReturn({ trades, closes: cq.data.closes, spy: cq.data.spy });
    return (
      <>
        {r.period ? (
          <p className="text-xs text-ink3">
            {a.period(
              longDate(r.period.from),
              longDate(r.period.to),
              r.period.sessions,
              r.period.calendarDays,
            )}
          </p>
        ) : (
          <p className="text-sm text-ink3">{a.noPeriod}</p>
        )}
        <dl className="flex flex-col">
          <Line
            k={a.twr}
            v={r.twr === null ? <Why text={r.twrUnavailable ?? p.na} /> : <Chg v={r.twr} />}
            note={
              r.twrAnnualized !== null ? (
                <>
                  {a.annualized} <Chg v={r.twrAnnualized} />
                </>
              ) : r.twr !== null ? (
                a.notAnnualized
              ) : undefined
            }
          />
          <Line
            k={a.mwr}
            v={
              r.moneyWeighted === null ? (
                <Why text={r.moneyWeightedUnavailable ?? p.na} />
              ) : (
                <Chg v={r.moneyWeighted} />
              )
            }
            note={r.moneyWeighted !== null ? a.mwrNote(r.moneyWeightedMethod ?? '') : undefined}
          />
          <Line
            k={a.spyTwr}
            v={r.spy ? <Chg v={r.spy.twr} /> : <Why text={p.na} />}
            note={r.spy?.negativeBalance ? a.spyNegative : a.spySame}
          />
          <Line
            k={a.spyMwr}
            v={r.spy?.moneyWeighted == null ? <Why text={p.na} /> : <Chg v={r.spy.moneyWeighted} />}
          />
          <Line
            k={a.flows}
            v={a.flowsValue(usd(r.deposits), usd(r.withdrawals))}
            note={a.endValue(
              r.endValue === null ? p.na : usd(r.endValue),
              r.spy ? usd(r.spy.endValue) : p.na,
            )}
          />
          <Line
            k={a.counts}
            v={a.countsValue(r.trades, r.closedTrades, r.cashFlows)}
            note={a.fees(usd(r.fees))}
          />
          <Line
            k={a.missing}
            v={String(r.missingDays)}
            note={a.missingNote(r.missingCloses.length)}
          />
        </dl>
        {r.excluded.length > 0 && (
          <Source>
            {a.excluded(r.excluded.map((e) => `${e.ticker} (${e.reason})`).join('; '))}
          </Source>
        )}
        {r.flowsOffSession > 0 && <Source>{a.offSession(r.flowsOffSession)}</Source>}
        <ul
          className="flex list-disc flex-col gap-0.5 ps-5 text-xs text-ink3"
          aria-label={a.method}
        >
          {r.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
          <li>{a.feesStored}</li>
        </ul>
        {r.missingCloses.length > 0 && (
          <Details>
            <p className="text-xs text-ink3">{a.missingTitle}</p>
            <p className="text-xs text-ink2">
              {r.missingCloses.map((m) => `${m.ticker} ${shortDate(m.date)}`).join(', ')}
            </p>
          </Details>
        )}
        <Source>{a.source(r.formulaVersion)}</Source>
      </>
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold text-ink3">{a.title}</h3>
      {body()}
    </div>
  );
}
