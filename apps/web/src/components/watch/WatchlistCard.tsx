import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  daysBetween,
  etDate,
  tickerSummary,
  toFixedHalfUp,
  traderMetrics,
  type TickerSummary,
} from '@marsad/core';
import { Card, Segmented, Sparkline, useRemembered } from '../Card';
import { Spark } from '../ui/kit';
import { num, th, thNum } from '../study/Panel';
import { WatchlistEditor } from '../WatchlistEditor';
import { useQuickLook } from '../QuickLook';
import { loadCalendar, type WatchData } from '../../lib/watch';
import { useQuotePoll } from '../../lib/refresh';
import { loadQuoteView, quoteStatus, type QuoteView } from '../../lib/quotes';
import { t } from '../../strings';
import { Change, ChangePill, toneText, u, useNow, v, w } from './shared';

const tr = t.trader;
const l = w.list;
const vl = v.list;

/** Cell padding: rows at least 56 px tall as designed, soft dividers. */
const cell = 'border-t border-line px-1.5 py-1.5 align-middle';
const pct1 = (x: number) => `${toFixedHalfUp(x * 100, 1)}%`;
const signed1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(x), 1)}`;
const fmtPct = (x: number, d = 1) => `${x > 0 ? '+' : ''}${toFixedHalfUp(x * 100, d)}%`;

export const PERIODS = ['1d', '5d', '1m'] as const;
type Period = (typeof PERIODS)[number];
const changeOf = (s: TickerSummary | null, p: Period) =>
  !s ? null : p === '1d' ? s.change1d : p === '5d' ? s.change5d : s.change21d;

/** Where the last close sits in the 52-week closing range: a track with a mark and the percent. */
function RangePosition({ s }: { s: TickerSummary }) {
  const r = s.range252;
  if (!r || s.fromHigh252 === null) return <span className="text-xs text-ink3">{u.rangeNone}</span>;
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
      className="flex items-center gap-2"
    >
      <span className="relative h-1.5 w-20 flex-none rounded-[3px] bg-sub">
        <span
          className="absolute -top-[3px] -ms-[3px] h-3 w-1.5 rounded-[3px] bg-ink"
          style={{ insetInlineStart: `${pos}%` }}
        />
      </span>
      <span className="text-xs text-ink2 tabular-nums">{vl.position(pos)}</span>
    </div>
  );
}

function VolumeRatio({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-xs text-ink3">{v.noData}</span>;
  const hot = ratio >= 1.5;
  return (
    <span className={`text-[13px] font-semibold tabular-nums ${hot ? 'text-warn' : 'text-ink2'}`}>
      {l.times(toFixedHalfUp(ratio, 1))}
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
    return <span className="text-xs text-ink3">{noLatest(latest)}</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-semibold text-ink">{latest.price}</span>
      <span className="text-xs whitespace-nowrap">
        <Change v={latest.change} digits={2} />
      </span>
      <span className={`text-[11px] ${latest.stale ? 'text-warn' : 'text-ink3'}`}>
        {latest.label}
      </span>
    </span>
  );
}

function HeldTag() {
  return (
    <span className="inline-flex items-center rounded-full bg-up-soft px-1.5 text-[11px] font-medium text-up">
      {vl.held}
    </span>
  );
}

/** Phones: one row per ticker (close and day change); a tap shows the week, month, range and volume. */
function PhoneRow({
  tk,
  name,
  held,
  bars,
  s,
  stale,
  latest,
  open,
  onToggle,
}: {
  tk: string;
  name: string | undefined;
  held: boolean;
  bars: readonly { close: number }[];
  s: TickerSummary | null;
  stale: boolean;
  /** Set only when the viewer chose Tauric as the quote source. */
  latest?: Latest | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const quickLook = useQuickLook();
  const line = bars.slice(-30).map((b) => b.close);
  const first = line[0];
  const last = line.at(-1);
  const panel = `wl-more-${tk}`;
  return (
    <li className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className={`grid min-h-[60px] w-full grid-cols-[minmax(0,1fr)_56px_auto] items-center gap-3 px-4 py-2 text-start ${
          open ? 'bg-elev' : ''
        }`}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="text-base font-semibold text-ink">{tk}</span>
            {held && <HeldTag />}
          </span>
          {name && <span className="truncate text-xs text-ink3">{name}</span>}
        </span>
        <Sparkline
          values={line}
          className={
            first !== undefined && last !== undefined ? toneText(last - first) : 'text-ink3'
          }
        />
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-base text-ink tabular-nums">
            {s ? toFixedHalfUp(s.close, 2) : v.noData}
          </span>
          {s && (
            <span className="text-[0.8125rem] font-semibold whitespace-nowrap">
              <Change v={s.change1d} />
            </span>
          )}
          {latest !== undefined && (
            <span className="text-xs text-ink3 tabular-nums">
              {latest && latest !== 'not-covered' ? u.latestPhone(latest.price) : noLatest(latest)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div id={panel} className="flex flex-col gap-3 bg-elev px-4 pt-1 pb-4">
          {latest && latest !== 'not-covered' && (
            <p className={`text-[0.8125rem] ${latest.stale ? 'text-warn' : 'text-ink3'}`}>
              {u.latestPhone(latest.price)} <Change v={latest.change} digits={2} /> {'·'}{' '}
              {latest.label}
            </p>
          )}
          {s ? (
            <>
              {stale && <p className="text-[0.8125rem] text-warn">{u.olderDate(s.date)}</p>}
              <div className="grid grid-cols-3 gap-1.5">
                {PERIODS.map((p) => (
                  <span
                    key={p}
                    className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface p-2"
                  >
                    <span className="text-xs text-ink3">{u.periodChips[p]}</span>
                    <span className="font-semibold tabular-nums">
                      <Change v={changeOf(s, p)} />
                    </span>
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink3">{vl.colRange}</span>
                <RangePosition s={s} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink3">{u.colVolume}</span>
                <VolumeRatio ratio={s.volumeRatio20} />
              </div>
            </>
          ) : (
            <p className="text-sm text-ink3">{v.noData}</p>
          )}
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => quickLook(tk)}
            className="flex min-h-11 items-center justify-center rounded-lg border border-line-strong font-semibold text-ink"
          >
            {t.quickLook.button(tk)}
          </button>
          <Link
            to="/study/$ticker"
            params={{ ticker: tk }}
            className="flex min-h-11 items-center justify-center rounded-lg border border-line-strong font-semibold text-ink"
          >
            {u.studyTicker(tk)}
          </Link>
        </div>
      )}
    </li>
  );
}

const button =
  'min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-ink pointer-coarse:min-h-11';

export function WatchlistCard({
  data,
  names,
  held,
}: {
  data: WatchData;
  /** Company names by ticker; missing names are left out, never guessed. */
  names: Record<string, string>;
  /** Tickers with an open holding. */
  held: ReadonlySet<string>;
}) {
  const [period, setPeriod] = useRemembered<Period>('marsad.watch.period', PERIODS, '1d');
  const [sorted, setSorted] = useState(false);
  const [openTk, setOpenTk] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [trader, setTrader] = useRemembered('marsad.watch.trader', ['off', 'on'] as const, 'off');
  const navigate = useNavigate();
  const cal = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
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
  const spyBars = data.bars['SPY'] ?? [];
  const today = etDate(now);
  const rows = data.tickers.map((tk) => {
    const est = cal.data?.earnings?.estimates.find((e) => e.ticker === tk);
    return {
      tk,
      bars: data.bars[tk] ?? [],
      s: tickerSummary(data.bars[tk] ?? []),
      m: traderMetrics(
        data.bars[tk] ?? [],
        spyBars,
        data.sectorOf[tk] ? (data.bars[data.sectorOf[tk] ?? ''] ?? null) : null,
      ),
      sector: data.sectorOf[tk] ?? null,
      rank: data.strength[tk] ?? null,
      days: est ? daysBetween(today, est.date) : null,
    };
  });
  const newest = rows.reduce((d, r) => (r.s && r.s.date > d ? r.s.date : d), '');
  if (sorted)
    rows.sort(
      (a, b) => (changeOf(b.s, period) ?? -Infinity) - (changeOf(a.s, period) ?? -Infinity),
    );
  const on = trader === 'on';
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
          <button type="button" onClick={() => setTrader(on ? 'off' : 'on')} className={button}>
            {on ? vl.hideTrader : vl.showTrader}
          </button>
          <button
            type="button"
            aria-pressed={sorted}
            onClick={() => setSorted(!sorted)}
            className={`${button} ${sorted ? 'bg-elev' : ''}`}
          >
            {u.sortByChange}
          </button>
        </div>
      }
    >
      <p className="-mt-1.5 hidden text-xs text-ink3 tablet:block">{vl.hint}</p>
      <ul className="-mx-[18px] -mb-1 tablet:hidden">
        {rows.map(({ tk, bars, s }) => (
          <PhoneRow
            key={tk}
            tk={tk}
            name={names[tk]}
            held={held.has(tk)}
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
        <table
          className={`w-full border-collapse text-sm ${on ? 'min-w-[1040px]' : 'min-w-[640px]'}`}
        >
          <thead>
            <tr>
              <th className={th}>{vl.colCompany}</th>
              <th className={`${th} w-[88px]`}>{u.colSpark}</th>
              {tauric && <th className={thNum}>{u.latestCol}</th>}
              <th className={`${thNum} w-[84px]`}>{l.colClose}</th>
              <th className={`${thNum} w-[104px]`}>{u.periodLong[period] ?? period}</th>
              <th className={`${th} w-[140px]`}>{vl.colRange}</th>
              <th className={`${thNum} w-[76px]`}>{vl.colVolume}</th>
              {on && (
                <>
                  <th className={thNum}>{tr.atrPct}</th>
                  <th className={thNum}>{tr.stretch50}</th>
                  <th className={thNum}>{tr.rsSpy}</th>
                  <th className={thNum}>{tr.rsSector}</th>
                  <th className={thNum}>{tr.rank}</th>
                  <th className={thNum}>{tr.fromHigh}</th>
                  <th className={thNum}>{tr.earnings}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tk, bars, s, m, days, sector, rank }) => {
              const line = bars.slice(-30).map((b) => b.close);
              return (
                <tr
                  key={tk}
                  onClick={(e) => {
                    // The ticker link and the buttons inside keep their own behaviour.
                    if ((e.target as HTMLElement).closest('a, button')) return;
                    void navigate({ to: '/study/$ticker', params: { ticker: tk } });
                  }}
                  className="cursor-pointer hover:bg-elev"
                >
                  <td className={cell}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <Link
                          to="/study/$ticker"
                          params={{ ticker: tk }}
                          className="inline-flex min-h-8 items-center text-[15px] font-semibold text-ink hover:text-up pointer-coarse:min-h-11"
                        >
                          {tk}
                        </Link>
                        {held.has(tk) && <HeldTag />}
                      </span>
                      {names[tk] && (
                        <span className="max-w-[220px] truncate text-xs text-ink3">
                          {names[tk]}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cell}>
                    <Spark values={line} width={80} height={24} />
                  </td>
                  {tauric && (
                    <td className={`${cell} ${num}`}>
                      <LatestCell latest={latestOf(tk)} />
                    </td>
                  )}
                  {s ? (
                    <>
                      <td className={`${cell} ${num}`}>
                        <span className="font-semibold text-ink">{toFixedHalfUp(s.close, 2)}</span>
                        {s.date !== newest && (
                          <span className="block text-[11px] text-warn">{u.olderDate(s.date)}</span>
                        )}
                      </td>
                      <td className={`${cell} ${num}`}>
                        <ChangePill v={changeOf(s, period)} />
                      </td>
                      <td className={cell}>
                        <RangePosition s={s} />
                      </td>
                      <td className={`${cell} ${num}`}>
                        <VolumeRatio ratio={s.volumeRatio20} />
                      </td>
                    </>
                  ) : (
                    <td className={`${cell} text-ink3`} colSpan={4}>
                      {v.noData}
                    </td>
                  )}
                  {on && (
                    <>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {m?.atrPct == null ? '–' : pct1(m.atrPct)}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {m?.stretch50 == null ? '–' : tr.atrs(signed1(m.stretch50))}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {m?.rsSpy == null ? '–' : <Change v={m.rsSpy} />}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {m?.rsSector == null ? (
                          <span className="text-ink3">{sector ? '–' : tr.noSector}</span>
                        ) : (
                          <>
                            <Change v={m.rsSector} />
                            <span className="block text-[11px] text-ink3">{sector}</span>
                          </>
                        )}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {rank ? (
                          tr.rankValue(Math.round(rank.percentile))
                        ) : (
                          <span className="text-ink3">{tr.notRanked}</span>
                        )}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {m?.fromHigh == null ? '–' : <Change v={m.fromHigh} />}
                      </td>
                      <td className={`${cell} ${num} text-[13px]`}>
                        {days === null ? '–' : tr.inDays(days)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing ? (
        <WatchlistEditor
          tickers={data.tickers}
          sectorOf={data.sectorOf}
          onDone={() => setEditing(false)}
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={`${button} self-start`}>
          {t.watchlist.edit}
        </button>
      )}
      <p className="text-xs text-ink3">{newest ? u.footer(newest) : l.source}</p>
      {tauric && <p className="text-xs text-ink3">{u.latestFooter}</p>}
    </Card>
  );
}
