import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { sma, summarizeBars, toFixedHalfUp, traderMetrics } from '@marsad/core';
import { Sheet } from './Sheet';
import { useWide } from './Card';
import { loadStudy } from '../lib/study';
import { loadHoldings } from '../lib/journal';
import { loadAlerts } from '../lib/alerts';
import { loadCalendar, loadStrength } from '../lib/watch';
import { loadWatchlist, saveWatchlist, withTicker } from '../lib/watchlist';
import { loadQuoteView, quoteStatus } from '../lib/quotes';
import { useQuotePoll } from '../lib/refresh';
import { dayMonth } from '../lib/dates';
import { t } from '../strings';

const x = t.quickLook;

const QuickLookContext = createContext<(ticker: string) => void>(() => undefined);

/** Opens the quick look for a ticker from anywhere under the shell. */
export function useQuickLook() {
  return useContext(QuickLookContext);
}

/**
 * One ticker, tappable everywhere (council batch 1): it opens the quick look, a sheet on a phone and a side panel
 * from 760 px, so the list underneath stays where it was.
 */
export function TickerLink({ ticker, className = '' }: { ticker: string; className?: string }) {
  const open = useQuickLook();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={x.open(ticker)}
      onClick={(e) => {
        e.stopPropagation();
        open(ticker);
      }}
      className={`-mx-1 inline-flex min-h-11 items-center rounded-sm px-1 font-bold text-ink underline decoration-up/50 decoration-1 underline-offset-4 hover:decoration-up tablet:min-h-0 ${className}`}
    >
      {ticker}
    </button>
  );
}

const signed = (v: number, digits = 2) =>
  `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${toFixedHalfUp(Math.abs(v) * 100, digits)}%`;
const money = (v: number) => toFixedHalfUp(v, 2);
const compact = (v: number) =>
  v >= 1e9
    ? `$${toFixedHalfUp(v / 1e9, 1)}B`
    : v >= 1e6
      ? `$${toFixedHalfUp(v / 1e6, 1)}M`
      : `$${toFixedHalfUp(v / 1e3, 0)}K`;

/** Three months of closes with the 50- and 200-day lines, scaled together. */
function MiniChart({ closes }: { closes: readonly number[] }) {
  const n = 63;
  const s50 = sma(closes, 50).slice(-n);
  const s200 = sma(closes, 200).slice(-n);
  const c = closes.slice(-n);
  const all = [...c, ...s50, ...s200].filter((v): v is number => v !== null);
  if (c.length < 2 || all.length === 0) return null;
  const lo = Math.min(...all);
  const span = Math.max(...all) - lo || 1;
  const path = (vals: readonly (number | null)[]) =>
    vals
      .map((v, i) =>
        v === null
          ? null
          : `${((i / (vals.length - 1)) * 100).toFixed(2)},${(38 - ((v - lo) / span) * 36).toFixed(2)}`,
      )
      .filter(Boolean)
      .join(' ');
  return (
    <svg aria-hidden="true" viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full">
      <polyline
        points={path(s200)}
        fill="none"
        stroke="var(--color-warn)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={path(s50)}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={path(c)}
        fill="none"
        stroke="var(--color-up)"
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Fact({ k, v, tone = 'text-ink' }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-bg/50 px-2.5 py-2">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`text-[0.9375rem] font-semibold tabular-nums ${tone}`}>{v}</dd>
    </div>
  );
}

/** What the quick look shows for one ticker, each fact with its freshness in words; anything not stored says so. */
function QuickLookBody({ ticker }: { ticker: string }) {
  const study = useQuery({ queryKey: ['study', ticker], queryFn: () => loadStudy(ticker) });
  const holdings = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const alerts = useQuery({ queryKey: ['alerts', true], queryFn: () => loadAlerts(true) });
  const calendar = useQuery({ queryKey: ['calendar'], queryFn: loadCalendar });
  const spy = useQuery({ queryKey: ['study', 'SPY'], queryFn: () => loadStudy('SPY') });
  const strength = useQuery({
    queryKey: ['strength', ticker],
    queryFn: () => loadStrength([ticker]),
  });
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['watchlist'], queryFn: loadWatchlist });
  const add = useMutation({
    mutationFn: (tickers: string[]) => saveWatchlist(tickers),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['watchlist'] });
      void qc.invalidateQueries({ queryKey: ['watch'] });
    },
  });
  const quotePoll = useQuotePoll();
  const qv = useQuery({
    queryKey: ['quote-view'],
    queryFn: loadQuoteView,
    staleTime: 0,
    refetchInterval: quotePoll,
  });
  if (study.isError) return <p className="text-down">{study.error.message}</p>;
  if (!study.data) return <p className="text-muted">{t.loading}</p>;
  const d = study.data;
  const s = summarizeBars(d.bars);
  const last = d.bars.at(-1);
  const stale = !!s && !!d.lastCompletedDay && s.asOf < d.lastCompletedDay;
  const holding = holdings.data?.holdings.find((h) => h.ticker === ticker);
  const alert = alerts.data?.find((a) => a.ticker === ticker);
  const est = calendar.data?.earnings?.estimates.find((e) => e.ticker === ticker);
  const tq = qv.data?.source === 'tauric' ? qv.data.quotes[ticker] : undefined;
  const latest = tq && qv.data ? quoteStatus(tq, qv.data, new Date()) : null;
  const daysTo = est
    ? Math.round(
        (Date.parse(est.date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000,
      )
    : null;
  const fromHigh = s && s.high52w > 0 ? s.lastClose / s.high52w - 1 : null;
  const filings = d.filings.slice(0, 2);
  const m = traderMetrics(d.bars, spy.data?.bars ?? []);
  const onList = list.data?.tickers.includes(ticker) ?? false;
  const tr = t.trader;
  const signed1 = (v: number) =>
    `${v > 0 ? '+' : v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v), 1)}`;
  return (
    <div className="flex flex-col gap-3">
      {d.company?.name && <p className="-mt-2 text-sm text-muted">{d.company.name}</p>}
      {!s || !last ? (
        <p className="text-muted">{t.study.noBars}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-2xl font-bold text-ink tabular-nums">
                ${money(s.lastClose)}
              </span>
              <span
                className={`text-sm font-semibold tabular-nums ${s.changePct === null ? 'text-muted' : s.changePct >= 0 ? 'text-up' : 'text-down'}`}
              >
                {s.changePct === null ? t.study.unavailable : signed(s.changePct / 100)}
              </span>
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stale ? 'bg-warn/15 text-warn' : 'bg-muted/15 text-fg'}`}
            >
              {stale ? x.stale(dayMonth(s.asOf)) : x.endOfDay(dayMonth(s.asOf))}
            </span>
          </div>
          {latest && tq && (
            <p
              className={`text-xs tabular-nums ${latest.state === 'stale' ? 'text-warn' : 'text-muted'}`}
            >
              {x.tauric(money(tq.price), latest.label)}
            </p>
          )}
          <MiniChart closes={d.bars.map((b) => b.close)} />
          <p className="text-xs text-muted">{x.chartKey}</p>
          <dl className="grid grid-cols-2 gap-1.5">
            <Fact k={x.trend} v={t.study.trendLabels[s.trend] ?? s.trend} />
            <Fact k={x.rsi} v={s.rsi14 === null ? t.regime.noData : toFixedHalfUp(s.rsi14, 1)} />
            <Fact
              k={x.range(s.rangeSessions)}
              v={x.rangeValue(money(s.low52w), money(s.high52w))}
            />
            <Fact
              k={x.fromHigh}
              v={fromHigh === null ? t.regime.noData : signed(fromHigh, 1)}
              tone={fromHigh !== null && fromHigh < 0 ? 'text-down' : 'text-ink'}
            />
            <Fact
              k={x.volume}
              v={s.rvol20 === null ? t.regime.noData : x.times(toFixedHalfUp(s.rvol20, 1))}
            />
            <Fact k={x.dollarVolume} v={compact(last.close * last.volume)} />
            <Fact
              k={tr.atrPct}
              v={m?.atrPct == null ? t.regime.noData : `${toFixedHalfUp(m.atrPct * 100, 1)}%`}
            />
            <Fact
              k={tr.stretch50}
              v={m?.stretch50 == null ? t.regime.noData : tr.atrs(signed1(m.stretch50))}
            />
            <Fact
              k={tr.stretch20}
              v={m?.stretch20 == null ? t.regime.noData : tr.atrs(signed1(m.stretch20))}
            />
            <Fact
              k={tr.rsSpy}
              v={m?.rsSpy == null ? t.regime.noData : signed(m.rsSpy, 1)}
              tone={m?.rsSpy == null ? 'text-ink' : m.rsSpy >= 0 ? 'text-up' : 'text-down'}
            />
            <Fact
              k={tr.rankFact}
              v={(() => {
                const r = strength.data?.[ticker];
                return r
                  ? `${tr.rankValue(Math.round(r.percentile))} · ${tr.rankSub(r.rank, r.members, dayMonth(r.date))}`
                  : tr.notRanked;
              })()}
            />
            <Fact
              k={x.earnings}
              v={est ? (est.overdue ? x.overdue : x.inDays(daysTo ?? 0)) : x.noEstimate}
            />
          </dl>
        </>
      )}
      {(holding || alert) && (
        <section
          aria-label={x.whyTitle}
          className="flex flex-col gap-1 rounded-[10px] border border-line p-3 text-sm"
        >
          <h3 className="text-xs text-muted">{x.whyTitle}</h3>
          {holding && (
            <p>
              {x.holding(
                holding.shares,
                holding.stop === null ? x.none : money(holding.stop),
                holding.targets.length ? holding.targets.map(money).join(', ') : x.none,
              )}{' '}
              <span className="text-muted">
                {x.thesis(
                  t.journal.holdings.thesisStatus[holding.thesisStatus] ?? holding.thesisStatus,
                )}
              </span>
            </p>
          )}
          {alert && (
            <p>
              {x.alert(
                dayMonth(alert.createdAt.slice(0, 10)),
                alert.card[0]?.lines[0] ?? alert.kind,
              )}
            </p>
          )}
        </section>
      )}
      {filings.length > 0 && (
        <section aria-label={x.filingsTitle} className="flex flex-col gap-1">
          <h3 className="text-xs text-muted">{x.filingsTitle}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {filings.map((f) => (
              <li key={f.accession} className="flex justify-between gap-2">
                <span>
                  <span className="me-1.5 rounded-sm bg-fill px-1.5 py-px text-xs">{x.tier1}</span>
                  {f.form}
                  {f.items.length > 0 && (
                    <span className="text-muted"> {x.items(f.items.join(', '))}</span>
                  )}
                </span>
                <span className="whitespace-nowrap text-muted">{dayMonth(f.filingDate)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.data &&
        (onList ? (
          <p className="text-sm text-muted">{t.watchlist.onList}</p>
        ) : (
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              const next = withTicker(list.data.tickers, ticker);
              if (next) add.mutate(next);
            }}
            className="min-h-12 rounded-[14px] border border-muted/40 font-semibold text-ink"
          >
            {t.watchlist.addTo}
          </button>
        ))}
      {add.isError && <p className="text-sm text-down">{add.error.message}</p>}
      <Link
        to="/study/$ticker"
        params={{ ticker }}
        className="flex min-h-12 items-center justify-center rounded-[14px] bg-accent font-bold text-accent-ink"
      >
        {x.openStudy}
      </Link>
    </div>
  );
}

/** Holds which ticker is open and draws the quick look: a sheet on a phone, a side panel from 760 px. */
export function QuickLookProvider({ children }: { children: ReactNode }) {
  const [ticker, setTicker] = useState<string | null>(null);
  const wide = useWide();
  const close = () => setTicker(null);
  useEffect(() => {
    if (!wide || ticker === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTicker(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide, ticker]);
  return (
    <QuickLookContext.Provider value={setTicker}>
      {children}
      {!wide && (
        <Sheet open={ticker !== null} onClose={close} title={ticker ? x.title(ticker) : ''}>
          {ticker && <QuickLookBody ticker={ticker} />}
        </Sheet>
      )}
      {wide && ticker && (
        <aside
          role="dialog"
          aria-modal="false"
          aria-labelledby="quick-look-h"
          className="fixed end-0 top-0 bottom-0 z-[60] flex w-[380px] max-w-full flex-col gap-3 overflow-y-auto border-s border-line bg-raised p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="quick-look-h" className="text-xl font-bold text-ink">
              {x.title(ticker)}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={x.close}
              className="grid size-11 place-items-center rounded-full bg-bg/50 text-ink"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <QuickLookBody ticker={ticker} />
        </aside>
      )}
    </QuickLookContext.Provider>
  );
}
