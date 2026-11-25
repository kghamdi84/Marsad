import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, dualClock, etDate, etWallToUtc, type EconEvent } from '@marsad/core';
import { td, th } from '../components/study/Panel';
import { loadCalendar, type CalendarData } from '../lib/watch';
import { t } from '../strings';

const c = t.calendar;

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function instantOf(e: EconEvent): Date {
  const [h, m] = e.timeEt.split(':').map(Number) as [number, number];
  return etWallToUtc(e.date, h, m);
}

function EventRow({ e, now }: { e: EconEvent; now: Date }) {
  const at = instantOf(e);
  const clock = dualClock(at, DEFAULT_LOCAL_ZONE);
  const ms = at.getTime() - now.getTime();
  const today = e.date === etDate(now);
  const countdown =
    ms <= 0
      ? c.released
      : c.countdownIn(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000));
  return (
    <tr>
      <td className={`${td} whitespace-nowrap`}>{c.time(clock.et, clock.local)}</td>
      <td className={td}>
        <span className={e.impact === 'high' ? 'font-semibold' : ''}>{e.name}</span>
        <span className="block text-xs text-muted">{c.impact[e.impact]}</span>
      </td>
      <td className={`${td} whitespace-nowrap text-muted`}>{today ? countdown : ''}</td>
    </tr>
  );
}

const DAYS_AHEAD = 14;

function EconSection({ data, now }: { data: CalendarData; now: Date }) {
  if (!data.econ)
    return (
      <Section id="econ" title={c.title}>
        <p className="text-muted">{c.none}</p>
      </Section>
    );
  const today = etDate(now);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + DAYS_AHEAD * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const events = data.econ.events.filter((e) => e.date >= today && e.date <= last);
  const days = [...new Set(events.map((e) => e.date))];
  return (
    <Section id="econ" title={c.title}>
      <p className="text-sm text-muted">{c.daysAhead(DAYS_AHEAD)}</p>
      {days.map((d) => (
        <div key={d} className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{d === today ? c.todayHeading(d) : d}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {events
                  .filter((e) => e.date === d)
                  .map((e) => (
                    <EventRow key={`${e.date}-${e.name}`} e={e} now={now} />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">
        {c.source(data.econ.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC')}
      </p>
    </Section>
  );
}

function EarningsSection({ data }: { data: CalendarData }) {
  const list = data.earnings?.estimates ?? [];
  return (
    <Section id="earnings" title={c.earningsTitle}>
      <p className="text-sm text-muted">{c.earningsIntro}</p>
      {list.length === 0 ? (
        <p className="text-muted">{c.earningsNone}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{c.colTicker}</th>
                <th className={th}>{c.colExpected}</th>
                <th className={th}>{c.colRange}</th>
                <th className={th}>{c.colBasis}</th>
                <th className={th}>{c.colLast}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.ticker}>
                  <td className={`${td} font-medium`}>{e.ticker}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {e.date}
                    {e.overdue && <span className="block text-xs text-down">{c.overdue}</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{c.range(e.from, e.to)}</td>
                  <td className={td}>{c.basis[e.basis] ?? e.basis}</td>
                  <td className={`${td} whitespace-nowrap`}>{e.lastRelease}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function Watch() {
  const q = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const now = useNow();
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t.watch.title}</h1>
        <p className="text-sm text-muted">{t.watch.intro}</p>
      </div>
      {q.isPending && <p className="text-muted">{t.loading}</p>}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          <EconSection data={q.data} now={now} />
          <EarningsSection data={q.data} />
        </>
      )}
      <p className="text-xs text-muted">{t.watch.more}</p>
    </section>
  );
}
