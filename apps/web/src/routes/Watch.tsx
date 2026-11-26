import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import {
  DEFAULT_LOCAL_ZONE,
  clusterNews,
  dualClock,
  etDate,
  etWallToUtc,
  tickerSummary,
  toFixedHalfUp,
  type EconEvent,
  type TickerSummary,
} from '@marsad/core';
import { Card, Segmented, Sparkline } from '../components/Card';
import { num, th, thNum } from '../components/study/Panel';
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
const w = t.watch;
const u = w.ui;

/** Cell padding for the redesigned tables: rows at least 44 points tall, soft dividers. */
const cell = 'border-b border-line/60 px-2 py-2.5 align-middle';
const pairGrid = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4';

function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A choice remembered in this browser only; storage can be missing or blocked, so every access is guarded. */
function useRemembered<K extends string>(key: string, allowed: readonly K[], fallback: K) {
  const [v, setV] = useState<K>(() => {
    try {
      const s = localStorage.getItem(key);
      return s && (allowed as readonly string[]).includes(s) ? (s as K) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (k: K) => {
    setV(k);
    try {
      localStorage.setItem(key, k);
    } catch {
      // Not remembered; the choice still applies to this visit.
    }
  };
  return [v, set] as const;
}

const toneText = (v: number | null) =>
  v === null || v === 0 ? 'text-muted' : v > 0 ? 'text-up' : 'text-down';

/** A change as text with its sign and an arrow, blue up and orange down (never colour alone). */
function Change({
  v,
  digits = 1,
  plain = false,
}: {
  v: number | null;
  digits?: number;
  /** Inherit the text colour (on a tinted tile the tint carries the colour). */
  plain?: boolean;
}) {
  if (v === null) return <span className="text-muted">{t.regime.noData}</span>;
  const p = toFixedHalfUp(v * 100, digits);
  const up = Number(p) > 0;
  const down = Number(p) < 0;
  return (
    <span className={plain ? '' : up ? 'text-up' : down ? 'text-down' : ''}>
      <span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>
      {up ? '+' : ''}
      {p}%
    </span>
  );
}

const fmtPct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, d)}%`;

// ---------------------------------------------------------------------------------------------------------------
// Brief

function BriefCard({ briefs }: { briefs: StoredBrief[] }) {
  const b = briefs[0];
  if (!b)
    return (
      <section
        aria-label={w.brief.title}
        className="flex flex-col gap-1 rounded-xl border border-dashed border-line p-4"
      >
        <h2 className="text-[17px] font-semibold text-white">{u.noBriefTitle}</h2>
        <p className="text-sm text-muted">{w.brief.none}</p>
        <p className="text-sm text-muted">{u.membersNote}</p>
      </section>
    );
  const created = new Date(b.createdAt);
  const email = b.delivery['email'] ?? 'not-configured';
  return (
    <section aria-label={w.brief.title} className="flex flex-col gap-4 rounded-xl bg-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">
            {w.brief.title}
          </span>
          <h2 className="text-lg font-semibold text-white">{b.title}</h2>
          <p className="text-xs text-muted">
            {w.brief.made(`${etDate(created)} ${dualClock(created, DEFAULT_LOCAL_ZONE).label}`)}
          </p>
        </div>
        {email === 'sent' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-up/15 px-3 py-1 text-sm font-semibold text-up">
            <Mail aria-hidden="true" size={16} />
            {u.emailed}
          </span>
        ) : (
          <span
            className={`max-w-xs text-xs ${email.startsWith('failed') ? 'text-down' : 'text-muted'}`}
          >
            {w.brief.email(email)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {b.sections.map((s) => (
          <div key={s.heading} className="flex flex-col gap-2 rounded-[10px] bg-bg/45 p-3.5">
            <h3 className="text-[13px] font-bold text-muted">{s.heading}</h3>
            <ul className="flex flex-col gap-1.5 text-sm leading-snug text-fg">
              {s.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Market strip

function StripCard({ data }: { data: WatchData }) {
  const tiles = [
    ...STRIP_BARS.map((tk) => {
      const bars = data.bars[tk] ?? [];
      const s = tickerSummary(bars);
      return {
        key: tk,
        value: s ? toFixedHalfUp(s.close, 2) : null,
        change: s?.change1d ?? null,
        date: s?.date,
        pts: null as string | null,
        line: bars.slice(-30).map((b) => b.close),
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
        line: o.slice(-30).map((x) => x.value),
      };
    }),
  ];
  return (
    <section aria-labelledby="strip-h" className="flex flex-col gap-2">
      <h2 id="strip-h" className="sr-only">
        {w.strip.title}
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {tiles.map((x) => {
          const first = x.line[0];
          const lastV = x.line.at(-1);
          const lineTone =
            first !== undefined && lastV !== undefined ? toneText(lastV - first) : 'text-muted';
          return (
            <li
              key={x.key}
              className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-fg">
                  {w.strip.names[x.key] ?? x.key}
                </span>
              </div>
              {x.date && <span className="text-[11px] text-muted">{x.date}</span>}
              <span className="text-xl font-semibold text-white tabular-nums">
                {x.value ?? t.regime.noData}
              </span>
              <span className="text-[13px] tabular-nums">
                {x.value === null ? null : x.pts !== null ? (
                  <span className={toneText(Number(x.pts))}>
                    {w.strip.points(`${Number(x.pts) > 0 ? '+' : ''}${x.pts}`)}
                  </span>
                ) : (
                  <Change v={x.change} />
                )}
              </span>
              <Sparkline values={x.line} className={lineTone} height={28} />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{w.strip.source}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Watchlist

const PERIODS = ['1d', '5d', '1m'] as const;
type Period = (typeof PERIODS)[number];
const changeOf = (s: TickerSummary | null, p: Period) =>
  !s ? null : p === '1d' ? s.change1d : p === '5d' ? s.change5d : s.change21d;

function RangeDot({ s }: { s: TickerSummary }) {
  const r = s.range252;
  if (!r || s.fromHigh252 === null)
    return <span className="text-xs text-muted">{u.rangeNone}</span>;
  const pos = toFixedHalfUp(r.position * 100, 0);
  return (
    <div
      role="img"
      aria-label={u.rangeAria(
        toFixedHalfUp(r.low, 2),
        toFixedHalfUp(r.high, 2),
        pos,
        fmtPct(s.fromHigh252),
      )}
      className="flex items-center gap-2 text-[11px] text-muted tabular-nums"
    >
      <span>{toFixedHalfUp(r.low, 0)}</span>
      <span className="relative h-1 min-w-16 flex-1 rounded-sm bg-faint/30">
        <span
          className="absolute -top-1 -ms-1.5 size-3 rounded-full border-2 border-surface bg-white"
          style={{ insetInlineStart: `${pos}%` }}
        />
      </span>
      <span>{toFixedHalfUp(r.high, 0)}</span>
    </div>
  );
}

function VolumeBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-muted">{t.regime.noData}</span>;
  const hot = ratio >= 1.5;
  return (
    <div className="flex items-center justify-end gap-2">
      <span aria-hidden="true" className="relative h-2 w-14 rounded-sm bg-faint/20">
        <span
          className={`absolute inset-y-0 start-0 rounded-sm ${hot ? 'bg-warn' : 'bg-faint'}`}
          style={{ width: `${toFixedHalfUp(Math.min(ratio / 3, 1) * 100, 1)}%` }}
        />
      </span>
      <span className={`tabular-nums ${hot ? 'font-semibold text-warn' : ''}`}>
        {w.list.times(toFixedHalfUp(ratio, 1))}
      </span>
    </div>
  );
}

function ChangePill({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted">{t.regime.noData}</span>;
  const tint = v > 0 ? 'bg-up/15' : v < 0 ? 'bg-down/15' : 'bg-faint/15';
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 font-semibold whitespace-nowrap ${tint}`}>
      <Change v={v} />
    </span>
  );
}

function WatchlistCard({ data }: { data: WatchData }) {
  const l = w.list;
  const [period, setPeriod] = useRemembered<Period>('marsad.watch.period', PERIODS, '1d');
  const [sorted, setSorted] = useState(false);
  const rows = data.tickers.map((tk) => ({
    tk,
    bars: data.bars[tk] ?? [],
    s: tickerSummary(data.bars[tk] ?? []),
  }));
  const newest = rows.reduce((d, r) => (r.s && r.s.date > d ? r.s.date : d), '');
  if (sorted)
    rows.sort(
      (a, b) => (changeOf(b.s, period) ?? -Infinity) - (changeOf(a.s, period) ?? -Infinity),
    );
  return (
    <Card
      id="watchlist-h"
      title={l.title}
      subtitle={data.defaultList ? l.defaultNote : undefined}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={u.period}
            options={PERIODS.map((p) => ({ key: p, label: u.periods[p] ?? p }))}
            value={period}
            onChange={setPeriod}
          />
          <button
            type="button"
            aria-pressed={sorted}
            onClick={() => setSorted(!sorted)}
            className={`min-h-11 rounded-[10px] border border-muted/35 px-3 text-sm text-white ${
              sorted ? 'bg-raised' : ''
            }`}
          >
            {u.sortByChange}
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{l.colTicker}</th>
              <th className={`${th} hidden md:table-cell`}>{u.colSpark}</th>
              <th className={thNum}>{l.colClose}</th>
              <th className={thNum}>{u.colChange(u.periodLong[period] ?? period)}</th>
              <th className={`${th} hidden lg:table-cell`}>{u.colRange}</th>
              <th className={thNum}>{u.colVolume}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tk, bars, s }) => {
              const line = bars.slice(-30).map((b) => b.close);
              const first = line[0];
              const last = line.at(-1);
              return (
                <tr key={tk} className="hover:bg-raised/40">
                  <td className={`${cell} font-semibold`}>
                    <Link
                      to="/study/$ticker"
                      params={{ ticker: tk }}
                      className="inline-flex min-h-11 min-w-11 items-center text-white underline decoration-faint underline-offset-4 hover:decoration-up"
                    >
                      {tk}
                    </Link>
                  </td>
                  <td className={`${cell} hidden w-32 md:table-cell`}>
                    <Sparkline
                      values={line}
                      className={
                        first !== undefined && last !== undefined
                          ? toneText(last - first)
                          : 'text-muted'
                      }
                    />
                  </td>
                  {s ? (
                    <>
                      <td className={`${cell} ${num}`}>
                        <span className="font-semibold text-white">
                          {toFixedHalfUp(s.close, 2)}
                        </span>
                        {s.date !== newest && (
                          <span className="block text-[11px] text-warn">{u.olderDate(s.date)}</span>
                        )}
                      </td>
                      <td className={`${cell} ${num}`}>
                        <ChangePill v={changeOf(s, period)} />
                      </td>
                      <td className={`${cell} hidden w-48 lg:table-cell`}>
                        <RangeDot s={s} />
                      </td>
                      <td className={`${cell} ${num}`}>
                        <VolumeBar ratio={s.volumeRatio20} />
                      </td>
                    </>
                  ) : (
                    <td className={`${cell} text-muted`} colSpan={4}>
                      {t.regime.noData}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{newest ? u.footer(newest) : l.source}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sectors, movers, gaps, news

/** The tile tint grows with the size of the move: 0.1 at zero, 0.6 at 1.5% or more. */
const tint = (change: number) => {
  const a = toFixedHalfUp(0.1 + Math.min(Math.abs(change * 100) / 1.5, 1) * 0.5, 3);
  return change > 0 ? `rgba(127,168,255,${a})` : `rgba(255,159,90,${a})`;
};

function SectorsCard({ data }: { data: WatchData }) {
  const m = data.movers;
  return (
    <Card id="sectors-h" title={w.sectors.title} subtitle={m ? w.sectors.asOf(m.date) : undefined}>
      {!m ? (
        <p className="text-sm text-muted">{w.sectors.none}</p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
            {m.sectors.map((x) => (
              <li
                key={x.ticker}
                className="flex min-h-[76px] flex-col justify-between gap-1 rounded-lg p-2.5 text-white"
                style={{
                  background:
                    x.change === null || x.change === 0 ? 'rgba(138,153,178,0.14)' : tint(x.change),
                }}
              >
                <span className="text-[13px] leading-tight font-semibold">{x.sector}</span>
                <span className="text-[11px]">{x.ticker}</span>
                <span className="text-sm font-bold tabular-nums">
                  <Change v={x.change} digits={2} plain />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{w.sectors.source}</p>
        </>
      )}
    </Card>
  );
}

function MoversCard({ data }: { data: WatchData }) {
  const m = data.movers;
  const max = m ? Math.max(1e-9, ...[...m.gainers, ...m.losers].map((x) => Math.abs(x.change))) : 1;
  const list = (title: string, xs: NonNullable<WatchData['movers']>['gainers']) => (
    <div className="flex flex-col gap-1">
      <h3 className="text-[13px] font-bold text-muted">{title}</h3>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {xs.map((x) => (
            <tr key={x.ticker}>
              <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-white">{x.ticker}</td>
              <td className="py-1.5 align-middle">
                <span aria-hidden="true" className="block h-2.5 rounded-sm bg-faint/15">
                  <span
                    className={`block h-full rounded-sm ${x.change > 0 ? 'bg-up' : 'bg-down'}`}
                    style={{ width: `${toFixedHalfUp((Math.abs(x.change) / max) * 100, 1)}%` }}
                  />
                </span>
                <span className="text-[11px] text-muted">
                  {toFixedHalfUp(x.close, 2)} ·{' '}
                  {w.movers.dollarVolume(
                    Math.round(x.dollarVolume / 1e6).toLocaleString('en-US') + ' million',
                  )}
                </span>
              </td>
              <td className={`w-20 py-1.5 ps-2 align-middle font-semibold ${num}`}>
                <Change v={x.change} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card
      id="movers-h"
      title={w.movers.title}
      subtitle={m ? w.movers.asOf(m.date, m.n) : undefined}
    >
      {!m ? (
        <p className="text-sm text-muted">{w.movers.none}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {list(w.movers.gainers, m.gainers)}
          {list(w.movers.losers, m.losers)}
        </div>
      )}
    </Card>
  );
}

const GAP_ROWS = 10;

function GapsCard({ data }: { data: WatchData }) {
  const rows = [...new Set([...data.tickers, ...STRIP_BARS])]
    .flatMap((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return s && s.gap !== null ? [{ tk, gap: s.gap, day: s.change1d, date: s.date }] : [];
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, GAP_ROWS);
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.gap)));
  return (
    <Card id="gaps-h" title={w.gaps.title} subtitle={w.gaps.intro}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{w.gaps.none}</p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map((x) => {
                // What the close kept: the day's change in the gap's direction, capped at the gap.
                const kept =
                  x.day === null || Math.sign(x.day) !== Math.sign(x.gap)
                    ? 0
                    : Math.min(Math.abs(x.day), Math.abs(x.gap));
                const bg = x.gap > 0 ? 'bg-up' : 'bg-down';
                return (
                  <tr key={x.tk}>
                    <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-white">
                      {x.tk}
                    </td>
                    <td className="py-1.5 align-middle">
                      <span
                        aria-hidden="true"
                        className="relative block h-2.5 rounded-sm bg-faint/15"
                      >
                        <span
                          className={`absolute inset-y-0 start-0 rounded-sm opacity-45 ${bg}`}
                          style={{ width: `${toFixedHalfUp((Math.abs(x.gap) / max) * 100, 1)}%` }}
                        />
                        <span
                          className={`absolute inset-y-0 start-0 rounded-sm ${bg}`}
                          style={{ width: `${toFixedHalfUp((kept / max) * 100, 1)}%` }}
                        />
                      </span>
                      <span className="text-[11px] text-muted">
                        {x.date}
                        {x.day !== null && <> · {u.dayChange(fmtPct(x.day))}</>}
                      </span>
                    </td>
                    <td className={`w-20 py-1.5 ps-2 align-middle font-semibold ${num}`}>
                      <Change v={x.gap} digits={2} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted">{u.gapLegend}</p>
        </>
      )}
    </Card>
  );
}

function NewsCard({ data }: { data: WatchData }) {
  const clusters = useMemo(() => clusterNews(data.news).slice(0, 12), [data.news]);
  return (
    <Card id="watch-news-h" title={w.news.title}>
      {clusters.length === 0 ? (
        <p className="text-sm text-muted">{w.news.none}</p>
      ) : (
        <ul className="flex flex-col">
          {clusters.map((cl) => {
            const first = cl.articles[0];
            if (!first) return null;
            const when = new Date(cl.earliest);
            return (
              <li
                key={cl.id}
                className="flex flex-col gap-1 border-b border-line/60 py-2 last:border-0"
              >
                {/^https:\/\//.test(first.url) ? (
                  <a
                    href={first.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-sm leading-snug font-medium text-fg underline decoration-faint underline-offset-4 hover:decoration-up"
                  >
                    {first.title}
                  </a>
                ) : (
                  <span className="text-sm leading-snug font-medium text-fg">{first.title}</span>
                )}
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {first.tickers.slice(0, 4).map((tk) => (
                    <span key={tk} className="rounded bg-raised px-1.5 py-px font-semibold text-fg">
                      {tk}
                    </span>
                  ))}
                  <span>
                    {first.publisher} · {etDate(when)} {dualClock(when, DEFAULT_LOCAL_ZONE).label}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar

const IMPACT_DOT: Record<string, string> = {
  high: 'bg-[#ED1C24]',
  medium: 'bg-warn',
  low: 'bg-faint',
};

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
      <td className={`${cell} w-4 pe-0`}>
        <span
          aria-hidden="true"
          className={`block size-2.5 rounded-full ${IMPACT_DOT[e.impact] ?? 'bg-faint'}`}
        />
      </td>
      <td className={cell}>
        <span className={`text-sm ${e.impact === 'high' ? 'font-semibold text-white' : 'text-fg'}`}>
          {e.name}
        </span>
        <span className="block text-xs text-muted">
          {c.time(clock.et, clock.local)} · {c.impact[e.impact]}
        </span>
      </td>
      <td className={`${cell} text-end text-xs whitespace-nowrap`}>
        {today && (
          <span
            className={`rounded-md px-2 py-0.5 font-semibold ${ms <= 0 ? 'text-muted' : 'bg-raised text-fg'}`}
          >
            {countdown}
          </span>
        )}
      </td>
    </tr>
  );
}

const DAYS_AHEAD = 14;

function EconPart({ data, now }: { data: CalendarData; now: Date }) {
  const head = (
    <h3 id="econ-h" className="text-[15px] font-semibold text-white">
      {c.title}
    </h3>
  );
  if (!data.econ)
    return (
      <section aria-labelledby="econ-h" className="flex flex-col gap-2">
        {head}
        <p className="text-sm text-muted">{c.none}</p>
      </section>
    );
  const today = etDate(now);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + DAYS_AHEAD * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const events = data.econ.events.filter((e) => e.date >= today && e.date <= last);
  const days = [...new Set(events.map((e) => e.date))];
  return (
    <section aria-labelledby="econ-h" className="flex flex-col gap-2">
      {head}
      <p className="text-xs text-muted">{c.daysAhead(DAYS_AHEAD)}</p>
      {days.map((d) => (
        <div key={d} className="flex flex-col">
          <h4 className={`pt-2 text-[13px] font-bold ${d === today ? 'text-up' : 'text-muted'}`}>
            {d === today ? c.todayHeading(d) : d}
          </h4>
          <table className="w-full border-collapse">
            <tbody>
              {events
                .filter((e) => e.date === d)
                .map((e) => (
                  <EventRow key={`${e.date}-${e.name}`} e={e} now={now} />
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-xs text-muted">
        {c.source(data.econ.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC')}
      </p>
    </section>
  );
}

function EarningsPart({ data }: { data: CalendarData }) {
  const list = data.earnings?.estimates ?? [];
  return (
    <section aria-labelledby="earnings-h" className="flex flex-col gap-2">
      <h3 id="earnings-h" className="text-[15px] font-semibold text-white">
        {c.earningsTitle}
      </h3>
      <p className="text-xs text-muted">{c.earningsIntro}</p>
      {list.length === 0 ? (
        <p className="text-sm text-muted">{c.earningsNone}</p>
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
                  <td className={`${cell} font-semibold text-white`}>
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="size-2.5 rounded-full bg-up" />
                      {e.ticker}
                    </span>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {e.date}
                    {e.overdue && <span className="block text-xs text-down">{c.overdue}</span>}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-muted`}>
                    {c.range(e.from, e.to)}
                  </td>
                  <td className={`${cell} text-muted`}>{c.basis[e.basis] ?? e.basis}</td>
                  <td className={`${cell} whitespace-nowrap text-muted`}>{e.lastRelease}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const CAL_TYPES = ['all', 'economy', 'earnings'] as const;
type CalType = (typeof CAL_TYPES)[number];

function CalendarCard({ data, now }: { data: CalendarData; now: Date }) {
  const [type, setType] = useRemembered<CalType>('marsad.watch.calendar', CAL_TYPES, 'all');
  return (
    <Card
      id="calendar-h"
      title={u.calendar}
      aside={
        <Segmented
          label={u.calType}
          options={[
            { key: 'all', label: u.calAll },
            { key: 'economy', label: u.calEconomy },
            { key: 'earnings', label: u.calEarnings },
          ]}
          value={type}
          onChange={setType}
        />
      }
    >
      {type !== 'earnings' && <EconPart data={data} now={now} />}
      {type !== 'economy' && <EarningsPart data={data} />}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-[#ED1C24]" />
          {u.legendHigh}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
          {u.legendMedium}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-up" />
          {u.legendEarnings}
        </li>
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function Failure({ message }: { message: string }) {
  return (
    <p role="alert" className="text-down">
      {message}
    </p>
  );
}

export function Watch() {
  const q = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const wq = useQuery({ queryKey: ['watch'], queryFn: loadWatch });
  const bq = useQuery({ queryKey: ['briefs'], queryFn: loadBriefs });
  const now = useNow();
  const session = wq.data ? tickerSummary(wq.data.bars['SPY'] ?? [])?.date : undefined;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        {session && <p className="text-[13px] text-muted">{u.lastSession(session)}</p>}
        <h1 className="text-[28px] leading-tight font-bold text-white">{w.title}</h1>
        <p className="text-sm text-muted">{w.intro}</p>
        <p className="text-xs text-muted">{w.endOfDay}</p>
      </header>
      {bq.data && <BriefCard briefs={bq.data} />}
      {bq.isError && <Failure message={bq.error.message} />}
      {wq.isPending && <p className="text-muted">{t.loading}</p>}
      {wq.isError && <Failure message={wq.error.message} />}
      {wq.data && (
        <>
          <StripCard data={wq.data} />
          <WatchlistCard data={wq.data} />
          <div className={pairGrid}>
            <SectorsCard data={wq.data} />
            <MoversCard data={wq.data} />
          </div>
          <div className={pairGrid}>
            <GapsCard data={wq.data} />
            <NewsCard data={wq.data} />
          </div>
        </>
      )}
      {q.isPending && <p className="text-muted">{t.loading}</p>}
      {q.isError && <Failure message={q.error.message} />}
      {q.data && <CalendarCard data={q.data} now={now} />}
    </div>
  );
}
