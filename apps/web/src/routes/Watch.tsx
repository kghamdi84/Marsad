import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  DEFAULT_LOCAL_ZONE,
  clusterNews,
  dualClock,
  etDate,
  etWallToUtc,
  tickerSummary,
  toFixedHalfUp,
  type EconEvent,
} from '@marsad/core';
import { num, td, th, thNum } from '../components/study/Panel';
import {
  STRIP_BARS,
  STRIP_SERIES,
  loadBriefs,
  loadCalendar,
  loadWatch,
  type CalendarData,
  type StoredBrief,
  type WatchData,
} from '../lib/watch';
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

const w = t.watch;

/** A change as text with its sign and an arrow, coloured blue up and orange down (never colour alone). */
function Change({ v, digits = 1 }: { v: number | null; digits?: number }) {
  if (v === null) return <span className="text-muted">{t.regime.noData}</span>;
  const p = toFixedHalfUp(v * 100, digits);
  const up = Number(p) > 0;
  const down = Number(p) < 0;
  return (
    <span className={up ? 'text-up' : down ? 'text-down' : ''}>
      <span aria-hidden="true">{up ? '\u25B2 ' : down ? '\u25BC ' : ''}</span>
      {up ? '+' : ''}
      {p}%
    </span>
  );
}

function StripSection({ data }: { data: WatchData }) {
  const tiles = [
    ...STRIP_BARS.map((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return {
        key: tk,
        value: s ? toFixedHalfUp(s.close, 2) : null,
        change: s?.change1d ?? null,
        date: s?.date,
        pts: null as string | null,
      };
    }),
    ...STRIP_SERIES.map((id) => {
      const o = data.series[id] ?? [];
      const last = o.at(-1);
      const prev = o.at(-2);
      const isRate = id === 'DGS10';
      return {
        key: id,
        value: last ? toFixedHalfUp(last.value, 2) : null,
        change: !isRate && last && prev && prev.value !== 0 ? last.value / prev.value - 1 : null,
        date: last?.date,
        pts: isRate && last && prev ? toFixedHalfUp(last.value - prev.value, 2) : null,
      };
    }),
  ];
  return (
    <Section id="strip" title={w.strip.title}>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((x) => (
          <li key={x.key} className="flex flex-col rounded-sm border border-line p-2 text-sm">
            <span className="text-muted">{w.strip.names[x.key] ?? x.key}</span>
            <span className="text-lg font-medium tabular-nums">{x.value ?? t.regime.noData}</span>
            {x.value === null ? null : x.pts !== null ? (
              <span className="tabular-nums">
                {w.strip.points(`${Number(x.pts) > 0 ? '+' : ''}${x.pts}`)}
              </span>
            ) : (
              <Change v={x.change} />
            )}
            {x.date && <span className="text-xs text-muted">{x.date}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{w.strip.source}</p>
    </Section>
  );
}

function WatchlistSection({ data }: { data: WatchData }) {
  const l = w.list;
  return (
    <Section id="watchlist" title={l.title}>
      {data.defaultList && <p className="text-sm text-muted">{l.defaultNote}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{l.colTicker}</th>
              <th className={thNum}>{l.colClose}</th>
              <th className={thNum}>{l.col1d}</th>
              <th className={thNum}>{l.col5d}</th>
              <th className={thNum}>{l.col1m}</th>
              <th className={thNum}>{l.colHigh}</th>
              <th className={thNum}>{l.colVolume}</th>
              <th className={th}>{l.colDate}</th>
            </tr>
          </thead>
          <tbody>
            {data.tickers.map((tk) => {
              const s = tickerSummary(data.bars[tk] ?? []);
              return (
                <tr key={tk}>
                  <td className={`${td} font-medium`}>
                    <Link
                      to="/study/$ticker"
                      params={{ ticker: tk }}
                      className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2"
                    >
                      {tk}
                    </Link>
                  </td>
                  {s ? (
                    <>
                      <td className={`${td} ${num}`}>{toFixedHalfUp(s.close, 2)}</td>
                      <td className={`${td} ${num}`}>
                        <Change v={s.change1d} />
                      </td>
                      <td className={`${td} ${num}`}>
                        <Change v={s.change5d} />
                      </td>
                      <td className={`${td} ${num}`}>
                        <Change v={s.change21d} />
                      </td>
                      <td className={`${td} ${num}`}>
                        <Change v={s.fromHigh252} />
                      </td>
                      <td className={`${td} ${num}`}>
                        {s.volumeRatio20 === null
                          ? t.regime.noData
                          : l.times(toFixedHalfUp(s.volumeRatio20, 1))}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{s.date}</td>
                    </>
                  ) : (
                    <td className={`${td} text-muted`} colSpan={7}>
                      {t.regime.noData}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{l.source}</p>
    </Section>
  );
}

function SectorSection({ data }: { data: WatchData }) {
  const m = data.movers;
  return (
    <Section id="sectors" title={w.sectors.title}>
      {!m ? (
        <p className="text-muted">{w.sectors.none}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{w.sectors.asOf(m.date)}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {m.sectors.map((x) => {
              const tone =
                x.change === null || x.change === 0
                  ? 'border-line'
                  : x.change > 0
                    ? 'border-up/60 bg-up/10'
                    : 'border-down/60 bg-down/10';
              return (
                <li
                  key={x.ticker}
                  className={`flex flex-col rounded-sm border p-2 text-sm ${tone}`}
                >
                  <span>{x.sector}</span>
                  <span className="text-xs text-muted">{x.ticker}</span>
                  <Change v={x.change} digits={2} />
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">{w.sectors.source}</p>
        </>
      )}
    </Section>
  );
}

function MoversSection({ data }: { data: WatchData }) {
  const m = data.movers;
  const list = (title: string, xs: NonNullable<WatchData['movers']>['gainers']) => (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {xs.map((x) => (
            <tr key={x.ticker}>
              <td className={`${td} font-medium`}>{x.ticker}</td>
              <td className={`${td} ${num}`}>{toFixedHalfUp(x.close, 2)}</td>
              <td className={`${td} ${num}`}>
                <Change v={x.change} />
              </td>
              <td className={`${td} ${num} text-xs text-muted`}>
                {w.movers.dollarVolume(
                  Math.round(x.dollarVolume / 1e6).toLocaleString('en-US') + ' million',
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Section id="movers" title={w.movers.title}>
      {!m ? (
        <p className="text-muted">{w.movers.none}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{w.movers.asOf(m.date, m.n)}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {list(w.movers.gainers, m.gainers)}
            {list(w.movers.losers, m.losers)}
          </div>
        </>
      )}
    </Section>
  );
}

function GapSection({ data }: { data: WatchData }) {
  const rows = [...new Set([...data.tickers, ...STRIP_BARS])]
    .flatMap((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return s && s.gap !== null ? [{ tk, gap: s.gap, date: s.date }] : [];
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return (
    <Section id="gaps" title={w.gaps.title}>
      <p className="text-sm text-muted">{w.gaps.intro}</p>
      {rows.length === 0 ? (
        <p className="text-muted">{w.gaps.none}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((x) => (
              <tr key={x.tk}>
                <td className={`${td} font-medium`}>{x.tk}</td>
                <td className={`${td} ${num}`}>
                  <Change v={x.gap} digits={2} />
                </td>
                <td className={`${td} whitespace-nowrap text-muted`}>{x.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function NewsSection({ data }: { data: WatchData }) {
  const clusters = useMemo(() => clusterNews(data.news).slice(0, 12), [data.news]);
  return (
    <Section id="watch-news" title={w.news.title}>
      {clusters.length === 0 ? (
        <p className="text-muted">{w.news.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clusters.map((c) => {
            const first = c.articles[0];
            if (!first) return null;
            const when = new Date(c.earliest);
            return (
              <li key={c.id} className="text-sm">
                {/^https:\/\//.test(first.url) ? (
                  <a
                    href={first.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    {first.title}
                  </a>
                ) : (
                  <span className="font-medium">{first.title}</span>
                )}
                <span className="block text-xs text-muted">
                  {first.tickers.slice(0, 4).join(', ')} | {first.publisher} | {etDate(when)}{' '}
                  {dualClock(when, DEFAULT_LOCAL_ZONE).label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function BriefSection({ briefs }: { briefs: StoredBrief[] }) {
  const b = briefs[0];
  return (
    <Section id="brief" title={w.brief.title}>
      {!b ? (
        <p className="text-muted">{w.brief.none}</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
          <h3 className="font-semibold">{b.title}</h3>
          {b.sections.map((s) => (
            <div key={s.heading}>
              <h4 className="text-sm font-medium text-muted">{s.heading}</h4>
              <ul className="list-disc ps-5 text-sm">
                {s.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted">
            {w.brief.made(b.createdAt.slice(0, 16).replace('T', ' ') + ' UTC')}{' '}
            {w.brief.email(b.delivery['email'] ?? 'not-configured')}
          </p>
        </div>
      )}
    </Section>
  );
}

export function Watch() {
  const q = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const bq = useQuery({ queryKey: ['briefs'], queryFn: loadBriefs });
  const now = useNow();
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t.watch.title}</h1>
        <p className="text-sm text-muted">{t.watch.intro}</p>
        <p className="text-xs text-muted">{w.endOfDay}</p>
      </div>
      {bq.data && <BriefSection briefs={bq.data} />}
      {bq.isError && (
        <p role="alert" className="text-down">
          {bq.error.message}
        </p>
      )}
      {wq.isPending && <p className="text-muted">{t.loading}</p>}
      {wq.isError && (
        <p role="alert" className="text-down">
          {wq.error.message}
        </p>
      )}
      {wq.data && (
        <>
          <StripSection data={wq.data} />
          <WatchlistSection data={wq.data} />
          <SectorSection data={wq.data} />
          <MoversSection data={wq.data} />
          <GapSection data={wq.data} />
        </>
      )}
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
      {wq.data && <NewsSection data={wq.data} />}
    </section>
  );
}
