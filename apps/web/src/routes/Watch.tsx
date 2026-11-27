import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import {
  DEFAULT_LOCAL_ZONE,
  TIER_LABELS,
  clusterNews,
  dualClock,
  etDate,
  etWallToUtc,
  tickerSummary,
  toFixedHalfUp,
  type EconEvent,
  type TickerSummary,
} from '@marsad/core';
import { Card, Segmented, SkeletonCards, Sparkline, useRemembered } from '../components/Card';
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
import { dayMonth, weekdayDayMonth } from '../lib/dates';
import { useQuotePoll } from '../lib/refresh';
import { loadQuoteView, quoteStatus, type QuoteView } from '../lib/quotes';
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
      {up ? '+' : down ? '−' : ''}
      {down ? p.slice(1) : p}%
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
  const clock = dualClock(created, DEFAULT_LOCAL_ZONE);
  const city = (DEFAULT_LOCAL_ZONE.split('/').at(-1) ?? '').replace(/_/g, ' ');
  // Stored titles read "Pre-market brief, Wed 2026-11-25"; the design writes "Pre-market brief · Wed 25 Nov".
  const kind = b.title.split(',')[0] ?? b.title;
  const chip =
    email === 'sent'
      ? 'bg-up/16 text-up'
      : email.startsWith('failed')
        ? 'bg-down/16 text-down'
        : 'bg-faint/16 text-muted';
  return (
    <section
      aria-labelledby="brief-h"
      className="flex flex-col gap-3 rounded-2xl bg-raised p-4 tablet:rounded-xl tablet:p-5"
    >
      <div className="flex items-start justify-between gap-2.5">
        <span className="flex flex-col gap-0.5">
          <h2 id="brief-h" className="text-lg font-bold text-white">
            <span className="sr-only">{w.brief.title}: </span>
            {u.briefTitle(kind, weekdayDayMonth(b.forDate))}
          </h2>
          <span className="text-[0.8125rem] text-muted">
            {u.briefWhen(clock.et, clock.local, city)}
          </span>
          <span className="sr-only">
            {w.brief.made(`${etDate(created)} ${clock.label}`)} {w.brief.email(email)}
          </span>
        </span>
        <span
          title={w.brief.email(email)}
          className={`flex flex-none items-center gap-1 rounded-full px-2 py-[3px] text-xs font-semibold ${chip}`}
        >
          {email === 'sent' && <Check aria-hidden="true" size={12} strokeWidth={2.4} />}
          {email === 'sent' ? u.emailed : email.startsWith('failed') ? u.emailFailed : u.notEmailed}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 tablet:grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] tablet:gap-3">
        {b.sections.map((sec) => (
          <div
            key={sec.heading}
            className="flex min-w-0 flex-col gap-1 rounded-xl bg-bg/50 p-3 tablet:rounded-[10px] tablet:p-3.5"
          >
            <h3 className="text-xs font-normal text-muted">{sec.heading}</h3>
            <ul className="flex flex-col gap-1 text-sm leading-snug text-fg">
              {sec.lines.map((l) => (
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
      <ul className="grid grid-cols-2 gap-2 tablet:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] tablet:gap-3">
        {tiles.map((x) => {
          const first = x.line[0];
          const lastV = x.line.at(-1);
          const lineTone =
            first !== undefined && lastV !== undefined ? toneText(lastV - first) : 'text-muted';
          const name = w.strip.names[x.key] ?? x.key;
          const value = x.value === null ? null : x.key === 'DGS10' ? `${x.value}%` : x.value;
          const pts = x.pts === null ? null : Number(x.pts);
          return (
            <li
              key={x.key}
              aria-label={w.strip.aria(name, value ?? t.regime.noData)}
              className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-3 tablet:p-3.5"
            >
              <span className="flex justify-between gap-1 text-xs">
                <span className="truncate font-semibold text-fg">{name}</span>
                {x.date && <span className="whitespace-nowrap text-muted">{dayMonth(x.date)}</span>}
              </span>
              <span className="text-lg font-semibold text-white tabular-nums">
                {value ?? t.regime.noData}
              </span>
              {value !== null && (
                <span className="flex items-center justify-between gap-1.5">
                  <span className="text-[13px] whitespace-nowrap tabular-nums">
                    {pts !== null ? (
                      <span className={toneText(pts)}>
                        <span aria-hidden="true">{pts > 0 ? '▲ ' : pts < 0 ? '▼ ' : ''}</span>
                        {w.strip.points(
                          `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(pts), 2)}`,
                        )}
                      </span>
                    ) : (
                      <Change v={x.change} />
                    )}
                  </span>
                  <span className="w-[52px] flex-none">
                    <Sparkline values={x.line} className={lineTone} height={20} />
                  </span>
                </span>
              )}
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

/** The selected quote source's latest price (Tauric, ADR 0041), with its age in words by Marsad's clock. */
function useLatest(view: QuoteView | undefined, now: Date) {
  return (tk: string) => {
    const q = view?.source === 'tauric' ? view.quotes[tk] : undefined;
    if (!view) return null;
    if (!q) return view.notCovered.includes(tk) ? ('not-covered' as const) : null;
    const f = quoteStatus(q, view, now);
    return {
      price: toFixedHalfUp(q.price, 2),
      change: q.change,
      label: f.label,
      stale: f.state === 'stale',
    };
  };
}

type Latest = ReturnType<ReturnType<typeof useLatest>>;

const noLatest = (latest: Latest) => (latest === 'not-covered' ? u.latestNotCovered : u.latestNone);

function LatestCell({ latest }: { latest: Latest }) {
  if (!latest || latest === 'not-covered')
    return <span className="text-xs text-muted">{noLatest(latest)}</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-semibold text-white">{latest.price}</span>
      <span className="text-xs whitespace-nowrap">
        <Change v={latest.change} digits={2} />
      </span>
      <span className={`text-[11px] ${latest.stale ? 'text-warn' : 'text-muted'}`}>
        {latest.label}
      </span>
    </span>
  );
}

/** Phones: one row per ticker (close and day change); a tap shows the week, month, range and volume. */
function PhoneRow({
  tk,
  bars,
  s,
  stale,
  latest,
  open,
  onToggle,
}: {
  tk: string;
  bars: readonly { close: number }[];
  s: TickerSummary | null;
  stale: boolean;
  /** Set only when the viewer chose Tauric as the quote source. */
  latest?: Latest | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const line = bars.slice(-30).map((b) => b.close);
  const first = line[0];
  const last = line.at(-1);
  const panel = `wl-more-${tk}`;
  return (
    <li className="border-t border-line/60">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className={`grid min-h-[60px] w-full grid-cols-[minmax(0,1fr)_56px_auto] items-center gap-3 px-4 py-2 text-start ${
          open ? 'bg-raised/40' : ''
        }`}
      >
        <span className="text-base font-bold text-white">{tk}</span>
        <Sparkline
          values={line}
          className={
            first !== undefined && last !== undefined ? toneText(last - first) : 'text-muted'
          }
        />
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-base text-white tabular-nums">
            {s ? toFixedHalfUp(s.close, 2) : t.regime.noData}
          </span>
          {s && (
            <span className="text-[0.8125rem] font-semibold whitespace-nowrap">
              <Change v={s.change1d} />
            </span>
          )}
          {latest !== undefined && (
            <span className="text-xs text-muted tabular-nums">
              {latest && latest !== 'not-covered' ? u.latestPhone(latest.price) : noLatest(latest)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div id={panel} className="flex flex-col gap-3 bg-raised/40 px-4 pt-1 pb-4">
          {latest && latest !== 'not-covered' && (
            <p className={`text-[0.8125rem] ${latest.stale ? 'text-warn' : 'text-muted'}`}>
              {u.latestPhone(latest.price)} <Change v={latest.change} digits={2} /> {'\u00B7'}{' '}
              {latest.label}
            </p>
          )}
          {s ? (
            <>
              {stale && <p className="text-[0.8125rem] text-warn">{u.olderDate(s.date)}</p>}
              <div className="grid grid-cols-3 gap-1.5">
                {PERIODS.map((p) => (
                  <span key={p} className="flex flex-col gap-0.5 rounded-lg bg-bg p-2">
                    <span className="text-xs text-muted">{u.periodChips[p]}</span>
                    <span className="font-semibold tabular-nums">
                      <Change v={changeOf(s, p)} />
                    </span>
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.8125rem] text-muted">{u.colRange}</span>
                <RangeDot s={s} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{u.colVolume}</span>
                <VolumeBar ratio={s.volumeRatio20} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{t.regime.noData}</p>
          )}
          <Link
            to="/study/$ticker"
            params={{ ticker: tk }}
            className="flex min-h-11 items-center justify-center rounded-[10px] border border-muted/40 font-semibold text-white"
          >
            {u.studyTicker(tk)}
          </Link>
        </div>
      )}
    </li>
  );
}

function WatchlistCard({ data }: { data: WatchData }) {
  const l = w.list;
  const [period, setPeriod] = useRemembered<Period>('marsad.watch.period', PERIODS, '1d');
  const [sorted, setSorted] = useState(false);
  const [openTk, setOpenTk] = useState<string | null>(null);
  const quotePoll = useQuotePoll();
  const qv = useQuery({
    queryKey: ['quote-view'],
    queryFn: loadQuoteView,
    // Quotes move only in the session; the rest of the page is end of day (ADR 0042).
    staleTime: 0,
    refetchInterval: quotePoll,
  });
  const now = useNow();
  const tauric = qv.data?.source === 'tauric';
  const latestOf = useLatest(qv.data, now);
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
        <div className="hidden flex-wrap items-center gap-2 tablet:flex">
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
      <ul className="-mx-4 -mb-1 tablet:hidden">
        {rows.map(({ tk, bars, s }) => (
          <PhoneRow
            key={tk}
            tk={tk}
            bars={bars}
            s={s}
            stale={!!s && s.date !== newest}
            latest={tauric ? latestOf(tk) : undefined}
            open={openTk === tk}
            onToggle={() => setOpenTk(openTk === tk ? null : tk)}
          />
        ))}
      </ul>
      <div className="hidden overflow-x-auto tablet:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{l.colTicker}</th>
              <th className={`${th} hidden md:table-cell`}>{u.colSpark}</th>
              {tauric && <th className={thNum}>{u.latestCol}</th>}
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
                      className="inline-flex min-h-11 min-w-11 items-center text-white hover:text-up"
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
                  {tauric && (
                    <td className={`${cell} ${num}`}>
                      <LatestCell latest={latestOf(tk)} />
                    </td>
                  )}
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
      {tauric && <p className="text-xs text-muted">{u.latestFooter}</p>}
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
          <ul className="grid grid-cols-3 gap-1.5 tablet:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] tablet:gap-2">
            {m.sectors.map((x) => (
              <li
                key={x.ticker}
                className="flex min-h-[60px] min-w-0 flex-col justify-between gap-1 rounded-lg p-2 text-white tablet:min-h-[76px] tablet:p-2.5"
                style={{
                  background:
                    x.change === null || x.change === 0 ? 'rgba(138,153,178,0.14)' : tint(x.change),
                }}
              >
                <span className="truncate text-xs leading-tight font-semibold tablet:text-[13px]">
                  {x.sector}
                </span>
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

type MoverList = NonNullable<WatchData['movers']>['gainers'];

const moverMax = (m: NonNullable<WatchData['movers']>) =>
  Math.max(1e-9, ...[...m.gainers, ...m.losers].map((x) => Math.abs(x.change)));

function MoverRows({ xs, max }: { xs: MoverList; max: number }) {
  return (
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
                {toFixedHalfUp(x.close, 2)} {'\u00B7'}{' '}
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
  );
}

function MoversCard({ data }: { data: WatchData }) {
  const m = data.movers;
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
          {[[w.movers.gainers, m.gainers] as const, [w.movers.losers, m.losers] as const].map(
            ([title, xs]) => (
              <div key={title} className="flex flex-col gap-1">
                <h3 className="text-[13px] font-bold text-muted">{title}</h3>
                <MoverRows xs={xs} max={moverMax(m)} />
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

const GAP_ROWS = 10;

interface GapRow {
  tk: string;
  gap: number;
  day: number | null;
  date: string;
}

function gapRows(data: WatchData): GapRow[] {
  return [...new Set([...data.tickers, ...STRIP_BARS])]
    .flatMap((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return s && s.gap !== null ? [{ tk, gap: s.gap, day: s.change1d, date: s.date }] : [];
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, GAP_ROWS);
}

function GapRows({ rows }: { rows: GapRow[] }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.gap)));
  return (
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
              <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-white">{x.tk}</td>
              <td className="py-1.5 align-middle">
                <span aria-hidden="true" className="relative block h-2.5 rounded-sm bg-faint/15">
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
                  {x.day !== null && (
                    <>
                      {' '}
                      {'\u00B7'} {u.dayChange(fmtPct(x.day))}
                    </>
                  )}
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
  );
}

function GapsCard({ data }: { data: WatchData }) {
  const rows = gapRows(data);
  return (
    <Card id="gaps-h" title={w.gaps.title} subtitle={w.gaps.intro}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{w.gaps.none}</p>
      ) : (
        <>
          <GapRows rows={rows} />
          <p className="text-xs text-muted">{u.gapLegend}</p>
        </>
      )}
    </Card>
  );
}

type MgTab = 'up' | 'down' | 'gaps';

/** Phones: movers and gaps share one card, switched with a segmented control (design handoff). */
function MoversGapsPhone({ data }: { data: WatchData }) {
  const [tab, setTab] = useState<MgTab>('up');
  const m = data.movers;
  const gaps = gapRows(data);
  return (
    <Card id="movers-gaps-h" title={u.moversGaps}>
      <Segmented
        label={u.moversGaps}
        options={[
          { key: 'up', label: u.tabUp },
          { key: 'down', label: u.tabDown },
          { key: 'gaps', label: u.tabGaps },
        ]}
        value={tab}
        onChange={setTab}
        stretch
      />
      {tab === 'gaps' ? (
        gaps.length === 0 ? (
          <p className="text-sm text-muted">{w.gaps.none}</p>
        ) : (
          <>
            <GapRows rows={gaps} />
            <p className="text-xs text-muted">{w.gaps.intro}</p>
            <p className="text-xs text-muted">{u.gapLegend}</p>
          </>
        )
      ) : !m ? (
        <p className="text-sm text-muted">{w.movers.none}</p>
      ) : (
        <>
          <MoverRows xs={tab === 'up' ? m.gainers : m.losers} max={moverMax(m)} />
          <p className="text-xs text-muted">{w.movers.asOf(m.date, m.n)}</p>
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
                  <span
                    className="rounded border border-line px-1.5 py-px font-semibold text-fg"
                    title={TIER_LABELS[cl.bestTier]}
                  >
                    {t.study.news.tier(cl.bestTier)}
                  </span>
                  {cl.opinionOnly && <span className="text-warn">{t.study.news.opinion}</span>}
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

const DAYS_AHEAD = 14;
const CITY = (DEFAULT_LOCAL_ZONE.split('/').at(-1) ?? '').replace(/_/g, ' ');

interface AgendaItem {
  key: string;
  date: string;
  /** Sort order within a day: minutes after midnight ET; estimates go last. */
  order: number;
  name: string;
  time: string;
  extra: string | null;
  tag: string;
  dot: string;
  strong: boolean;
  late: boolean;
  countdown: string | null;
}

/** Economic events for the next 14 days and the watchlist's estimated earnings, one list by day, as the design draws it. */
function CalendarCard({ data, now }: { data: CalendarData; now: Date }) {
  const today = etDate(now);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + DAYS_AHEAD * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const items: AgendaItem[] = [];
  for (const e of data.econ?.events ?? []) {
    if (e.date < today || e.date > last) continue;
    const at = instantOf(e);
    const clock = dualClock(at, DEFAULT_LOCAL_ZONE);
    const ms = at.getTime() - now.getTime();
    items.push({
      key: `${e.date}-${e.name}`,
      date: e.date,
      order: Number(clock.et.slice(0, 2)) * 60 + Number(clock.et.slice(3, 5)),
      name: e.name,
      time: u.eventTime(clock.et, clock.local, CITY),
      extra: c.impact[e.impact] ?? null,
      tag: u.tagMacro,
      dot: IMPACT_DOT[e.impact] ?? 'bg-faint',
      strong: e.impact === 'high',
      late: false,
      countdown:
        e.date !== today
          ? null
          : ms <= 0
            ? c.released
            : c.countdownIn(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000)),
    });
  }
  for (const e of data.earnings?.estimates ?? [])
    items.push({
      key: `earn-${e.ticker}`,
      date: e.date,
      order: 24 * 60,
      name: u.earningsName(e.ticker),
      time: e.overdue ? c.overdue : u.earningsWhen(dayMonth(e.from), dayMonth(e.to)),
      extra: c.basis[e.basis] ?? e.basis,
      tag: u.tagWatchlist,
      dot: 'bg-up',
      strong: false,
      late: e.overdue,
      countdown: null,
    });
  items.sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
  const days = [...new Set(items.map((i) => i.date))];
  return (
    <Card id="calendar-h" title={u.calendar}>
      {!data.econ && <p className="text-sm text-muted">{c.none}</p>}
      {(data.earnings?.estimates ?? []).length === 0 && (
        <p className="text-sm text-muted">{c.earningsNone}</p>
      )}
      {days.map((d) => (
        <div key={d} className="flex flex-col gap-1.5">
          <h3 className={`text-[13px] font-semibold ${d === today ? 'text-up' : 'text-muted'}`}>
            {d === today ? c.todayHeading(weekdayDayMonth(d)) : weekdayDayMonth(d)}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {items
              .filter((i) => i.date === d)
              .map((i) => (
                <li
                  key={i.key}
                  className="flex min-h-12 items-center gap-2.5 rounded-[10px] bg-bg px-3 py-2"
                >
                  <span aria-hidden="true" className={`size-2.5 flex-none rounded-full ${i.dot}`} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={i.strong ? 'font-bold text-white' : 'text-fg'}>{i.name}</span>
                    <span className={`text-[13px] ${i.late ? 'text-down' : 'text-muted'}`}>
                      {i.time}
                      {i.countdown && <> · {i.countdown}</>}
                    </span>
                    {i.extra && <span className="sr-only">{i.extra}</span>}
                  </span>
                  <span
                    className={`flex-none rounded-sm px-1.5 py-0.5 text-xs text-fg ${
                      i.tag === u.tagWatchlist ? 'bg-ink' : 'bg-raised'
                    }`}
                  >
                    {i.tag}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-[13px] text-muted">{u.agendaLegend}</p>
      {data.econ && (
        <p className="text-xs text-muted">
          {c.source(data.econ.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC')}
        </p>
      )}
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
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <header className="flex flex-col gap-1">
        {session && <p className="text-[13px] text-muted">{u.lastSession(session)}</p>}
        {/* On a phone the top bar shows the page title. */}
        <h1 className="sr-only text-[28px] leading-tight font-bold text-white tablet:not-sr-only">
          {w.title}
        </h1>
        <p className="text-xs text-muted">{w.endOfDay}</p>
      </header>
      {bq.data && <BriefCard briefs={bq.data} />}
      {bq.isError && <Failure message={bq.error.message} />}
      {wq.isPending && <SkeletonCards />}
      {wq.isError && <Failure message={wq.error.message} />}
      {wq.data && (
        <>
          <StripCard data={wq.data} />
          <WatchlistCard data={wq.data} />
          <div className={pairGrid}>
            <SectorsCard data={wq.data} />
            <div className="hidden tablet:contents">
              <MoversCard data={wq.data} />
            </div>
            <div className="tablet:hidden">
              <MoversGapsPhone data={wq.data} />
            </div>
          </div>
          <div className={pairGrid}>
            <div className="hidden tablet:contents">
              <GapsCard data={wq.data} />
            </div>
            <NewsCard data={wq.data} />
          </div>
        </>
      )}
      {q.isPending && !wq.isPending && <SkeletonCards heights={['14rem']} />}
      {q.isError && <Failure message={q.error.message} />}
      {q.data && <CalendarCard data={q.data} now={now} />}
    </div>
  );
}
