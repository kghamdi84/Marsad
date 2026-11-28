import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  annualizedPayment,
  dividendYield,
  etDate,
  mergeDividends,
  toFixedHalfUp,
  trailingDividends,
  type DailyBar,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { loadPortfolioData, tauricDividends } from '../../lib/portfolio';
import { dayMonth, dayMonthYear, weekdayDayMonth } from '../../lib/dates';
import { t } from '../../strings';

const d = t.portfolio.divCal;
const BACK = 7;
const AHEAD = 14;

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Ex-dividend dates for the watchlist and holdings, 7 days back to 14 ahead, from stored Massive dividends and
 * Tauric's calendar. Marsad's tickers only: the market-wide list is a later idea (docs/IDEAS.md).
 */
export function DividendCalendar({
  tickers,
  bars,
  names,
  now,
}: {
  tickers: readonly string[];
  bars: Readonly<Record<string, readonly DailyBar[]>>;
  names: Record<string, string>;
  now: Date;
}) {
  const today = etDate(now);
  const list = [...new Set(tickers)].sort();
  const q = useQuery({
    queryKey: ['portfolio-data', list, today],
    queryFn: () => loadPortfolioData(list, today),
  });
  const [day, setDay] = useState(today);
  const days = Array.from({ length: BACK + AHEAD + 1 }, (_x, i) => shift(today, i - BACK));
  const rows = q.data ? mergeDividends(q.data.dividends, tauricDividends(q.data.research)) : [];
  const onDay = (x: string) => rows.filter((r) => r.exDate === x);
  const chosen = onDay(day);
  return (
    <Card id="dividend-cal-h" title={d.title} aside={<Info>{d.info}</Info>}>
      {q.isError && <p className="text-sm text-down">{q.error.message}</p>}
      <div
        role="group"
        aria-label={d.stripLabel}
        className="flex w-0 min-w-full gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {days.map((x) => {
          const n = onDay(x).length;
          return (
            <button
              key={x}
              type="button"
              aria-pressed={x === day}
              onClick={() => setDay(x)}
              className={`relative flex min-h-11 min-w-12 flex-none flex-col items-center justify-center rounded-lg border px-2 py-1 text-xs ${
                x === day ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink2'
              }`}
            >
              <span className="font-semibold tabular-nums">{dayMonth(x)}</span>
              <span aria-hidden="true" className="tabular-nums">
                {x === today ? d.today : n > 0 ? String(n) : '\u00B7'}
              </span>
              <span className="sr-only">{d.dayAria(x === today, n)}</span>
            </button>
          );
        })}
      </div>
      <h3 className="text-[13px] font-semibold text-ink3">{weekdayDayMonth(day)}</h3>
      {q.data && chosen.length === 0 && <p className="text-sm text-ink3">{d.none}</p>}
      {chosen.length > 0 && (
        <ul className="flex flex-col gap-2">
          {chosen.map((r) => {
            const b = bars[r.ticker] ?? [];
            const last = b.at(-1) ?? null;
            const annual = annualizedPayment(r.amount, r.frequency);
            const ttm = trailingDividends(
              rows.filter((y) => y.ticker === r.ticker),
              last?.date ?? today,
            );
            const y = dividendYield(annual ?? ttm.perShare, last?.close ?? null);
            return (
              <li
                key={`${r.ticker}-${r.exDate}`}
                className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev px-3 py-2.5"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <TickerLink ticker={r.ticker} />
                    <span className="text-xs text-ink3">{names[r.ticker] ?? ''}</span>
                  </span>
                  <span className="text-sm font-semibold text-ink tabular-nums">
                    {d.amount(toFixedHalfUp(r.amount, 4).replace(/0{1,2}$/, ''))}
                  </span>
                </span>
                <span className="text-xs text-ink2 tabular-nums">
                  {d.dates(dayMonthYear(r.exDate), r.payDate ? dayMonthYear(r.payDate) : null)}
                  {' · '}
                  {d.frequency(r.frequency)}
                  {' · '}
                  {y === null || !last
                    ? d.noYield
                    : d.yieldAt(toFixedHalfUp(y * 100, 2), dayMonth(last.date), annual !== null)}
                </span>
                <span className="text-xs text-ink3">{d.source[r.source]}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-ink3">{d.scope}</p>
    </Card>
  );
}
