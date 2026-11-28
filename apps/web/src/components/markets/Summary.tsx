import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { currentRun, etDate, etWallToUtc } from '@marsad/core';
import { Card } from '../Card';
import { arrowPct } from '../regime/format';
import { weekdayDayMonth } from '../../lib/dates';
import { loadRegime } from '../../lib/regime';
import { loadCalendar, loadWatch } from '../../lib/watch';
import { t } from '../../strings';
import type { MarketsView } from './SeeAll';

const s = t.markets.summary;
/** How far ahead the summary and the calendar view look. */
export const CALENDAR_DAYS = 30;

/** One row: the topic on the start side, the answer and its date on one line; the row opens that view. */
function Row({
  label,
  value,
  sub,
  onGo,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onGo: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onGo}
        className="grid min-h-11 w-full min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-2 py-2 text-start text-ink hover:bg-elev"
      >
        <span className="pt-0.5 text-xs text-ink3">{label}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-semibold">{value}</span>
          {sub && <span className="text-xs text-ink3">{sub}</span>}
        </span>
      </button>
    </li>
  );
}

const muted = (text: string) => <span className="font-normal text-ink3">{text}</span>;

/** "XLK ▲ +1.2%": the ticker with its signed change and arrow (colour is never the only signal). */
const move = (ticker: string, change: number) => `${ticker} ${arrowPct(change)}`;

/**
 * Markets today (ADR 0048: summary first): the regime label and its run, the leading and lagging sector fund, the
 * Marsad universe's top gainer and loser, and the next high-impact release with the count of estimated earnings.
 * Each row reads the same stored rows as its view (the queries are shared) and opens that view; a missing input
 * reads "Data unavailable", never a guess.
 */
export function MarketsSummary({ go, now }: { go: (v: MarketsView) => void; now: Date }) {
  const rq = useQuery({ queryKey: ['regime'], queryFn: loadRegime });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const cq = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const pending = (q: { isPending: boolean }) => (q.isPending ? muted(s.loading) : null);

  const days = rq.data?.days ?? [];
  const run = currentRun(days);
  const last = days.at(-1);
  const regime =
    pending(rq) ??
    (run && last ? s.regimeValue(t.regime.labels[run.label] ?? run.label, run.sessions) : null);

  const mv = wq.data?.movers ?? null;
  const sectors = (mv?.sectors ?? []).flatMap((x) =>
    x.change === null ? [] : [{ ticker: x.ticker, change: x.change }],
  );
  const sorted = [...sectors].sort(
    (a, b) => b.change - a.change || a.ticker.localeCompare(b.ticker),
  );
  const lead = sorted[0];
  const lag = sorted.at(-1);
  const up = mv?.gainers[0];
  const down = mv?.losers[0];

  const today = etDate(now);
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + CALENDAR_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const econ = cq.data?.econ;
  const nextHigh = (econ?.events ?? [])
    .filter((e) => e.impact === 'high' && e.date <= end)
    .map((e) => {
      const [h, m] = e.timeEt.split(':').map(Number) as [number, number];
      return { e, at: etWallToUtc(e.date, h, m) };
    })
    .filter((x) => x.at.getTime() >= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const earnings = (cq.data?.earnings?.estimates ?? []).filter(
    (x) => x.date >= today && x.date <= end,
  ).length;

  return (
    <Card id="markets-summary-h" title={s.title}>
      <ul className="flex flex-col">
        <Row
          label={s.regime}
          value={regime ?? muted(s.unavailable)}
          sub={
            run && last
              ? s.regimeSub(weekdayDayMonth(last.date), last.ruleVersion)
              : rq.isError
                ? rq.error.message
                : undefined
          }
          onGo={() => go('regime')}
        />
        <Row
          label={s.sectors}
          value={
            pending(wq) ??
            (lead && lag && lead.ticker !== lag.ticker
              ? s.sectorsValue(move(lead.ticker, lead.change), move(lag.ticker, lag.change))
              : muted(s.unavailable))
          }
          sub={mv ? s.sectorsSub(weekdayDayMonth(mv.date)) : wq.error?.message}
          onGo={() => go('sectors')}
        />
        <Row
          label={s.movers}
          value={
            pending(wq) ??
            (up && down
              ? s.moversValue(move(up.ticker, up.change), move(down.ticker, down.change))
              : muted(s.unavailable))
          }
          sub={mv ? s.moversSub(weekdayDayMonth(mv.date), mv.n) : wq.error?.message}
          onGo={() => go('movers')}
        />
        <Row
          label={s.calendar}
          value={
            pending(cq) ??
            (!econ
              ? muted(s.unavailable)
              : nextHigh
                ? s.nextHigh(
                    nextHigh.e.name,
                    s.when(weekdayDayMonth(nextHigh.e.date), nextHigh.e.timeEt),
                  )
                : s.noHigh)
          }
          sub={cq.data ? s.calendarSub(earnings) : cq.error?.message}
          onGo={() => go('calendar')}
        />
      </ul>
    </Card>
  );
}
