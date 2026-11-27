import { lazy, Suspense, useMemo, useState } from 'react';
import { Info } from '../components/Info';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  buildEventMarkers,
  companySnapshot,
  earningsMove,
  estimateNextEarnings,
  etDate,
  mergeFilingEvents,
  normalizeTicker,
  summarizeBars,
  toFixedHalfUp,
  type BarSummary,
  type ChartMarker,
  type EarningsEstimate,
  type EarningsMove,
} from '@marsad/core';
import type { ChartToggles } from '../components/PriceChart';
import { useQuotePoll } from '../lib/refresh';
import { loadQuoteView, quoteStatus } from '../lib/quotes';
import { loadPreferences } from '../lib/settings';
import { shariahAsOf } from '../lib/shariah';
import { dayMonthYear, weekdayDayMonth } from '../lib/dates';
import { Dividends } from '../components/study/Dividends';
import { Earnings } from '../components/study/Earnings';
import { Financials } from '../components/study/Financials';
import { Insiders } from '../components/study/Insiders';
import { NewsPanel } from '../components/study/NewsPanel';
import { Business } from '../components/study/Business';
import { Holders13F } from '../components/study/Holders13F';
import { QuarterlyRiskFactors } from '../components/study/QuarterlyRiskFactors';
import { RiskFactors } from '../components/study/RiskFactors';
import { ShariahAid } from '../components/study/ShariahAid';
import { ShortData } from '../components/study/ShortData';
import { CompanySearch } from '../components/study/CompanySearch';
import { FilingsCard } from '../components/study/FilingsCard';
import { markerLetter } from '../components/study/markers';
import { filingEvents, loadStudy, type StudyData } from '../lib/study';
import {
  loadChartEvents,
  loadDividends,
  loadEarningsFilings,
  loadFacts,
  loadInsiders,
  loadShortData,
} from '../lib/studyPanels';
import { ThesisCard } from '../components/study/ThesisCard';
import { ChevronRight, Lock } from 'lucide-react';
import {
  Segmented,
  SkeletonCards,
  Tabs,
  cardClass,
  useRemembered,
  useWide,
} from '../components/Card';
import { AutoGrid, Num, Pill, signedPct, type Tone } from '../components/ui/kit';
import { panelTitle, tileClass } from '../components/study/Panel';
import { t } from '../strings';

const PriceChart = lazy(() => import('../components/PriceChart'));

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `$${money(n)}`;

const ui = t.study.ui;

/** The day's change as a soft pill with sign and arrow; no arrow and a neutral tone when unchanged. */
function ChangePill({ pct }: { pct: number | null }) {
  if (pct === null) return <Pill>{t.study.unavailable}</Pill>;
  const tone: Tone = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
  return (
    <Pill tone={tone} className="font-semibold">
      <Num>{pct === 0 ? '0.00%' : signedPct(pct, 2)}</Num>
    </Pill>
  );
}

const SHARIAH_TONE: Record<string, Tone> = {
  'passes-ratios': 'up',
  'fails-ratios': 'down',
  unknown: 'neutral',
  off: 'neutral',
};

/** The header's Shariah aid status: the verdict when the aid is on, "off" when it is not. A screening aid, not a ruling. */
function ShariahPill({ cik, bars }: { cik: string | undefined; bars: StudyData['bars'] }) {
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const sh = prefs.data?.shariah;
  const facts = useQuery({
    queryKey: ['facts', cik],
    queryFn: () => loadFacts(cik as string),
    enabled: !!sh?.enabled && cik !== undefined,
  });
  if (!prefs.data) return null;
  const key = !sh?.enabled
    ? 'off'
    : !cik
      ? 'unknown'
      : facts.data
        ? (shariahAsOf(facts.data, bars, sh, etDate(new Date()))?.verdict ?? 'unknown')
        : null;
  if (key === null) return null;
  return (
    <Pill tone={SHARIAH_TONE[key] ?? 'neutral'}>
      <span className="sr-only">{ui.shariahPrefix} </span>
      {ui.shariahPill[key]}
    </Pill>
  );
}

/** The header: ticker, name, Shariah aid status, last close with its change, source and date, and the search. */
function Header({ ticker, data, s }: { ticker: string; data: StudyData; s: BarSummary | null }) {
  const stale = !!s && !!data.lastCompletedDay && s.asOf < data.lastCompletedDay;
  // The viewer's quote source (ADR 0041): with Tauric, its latest price sits under the Massive close.
  const quotePoll = useQuotePoll();
  const qv = useQuery({
    queryKey: ['quote-view'],
    queryFn: loadQuoteView,
    // Quotes move only in the session; the rest of the page is end of day (ADR 0042).
    staleTime: 0,
    refetchInterval: quotePoll,
  });
  const tq = qv.data?.source === 'tauric' ? qv.data.quotes[ticker] : undefined;
  const latest = tq && qv.data ? quoteStatus(tq, qv.data, new Date()) : null;
  const notCovered = qv.data?.source === 'tauric' && !tq && qv.data.notCovered.includes(ticker);
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.01em] text-ink">
            {ticker}
          </h1>
          {data.company?.name && (
            <span className="min-w-0 truncate text-lg text-ink2">{data.company.name}</span>
          )}
          <ShariahPill cik={data.company?.cik} bars={data.bars} />
        </div>
        {s && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-lg font-semibold text-ink">
              <Num>{usd(s.lastClose)}</Num>
            </span>
            <ChangePill pct={s.changePct} />
            <span className="text-xs text-ink3">
              <Num>{ui.headerMeta(weekdayDayMonth(s.asOf))}</Num>
              {' · '}
              <span className={stale ? 'font-semibold text-warn' : ''}>
                {stale ? ui.staleBadge : ui.endOfDay}
              </span>
            </span>
          </div>
        )}
        {tq && latest && (
          <span
            data-testid="latest-quote"
            className={`text-xs tabular-nums ${latest.state === 'stale' ? 'text-warn' : 'text-ink3'}`}
          >
            {ui.latestLine(money(tq.price), latest.label)}
          </span>
        )}
        {notCovered && (
          <span data-testid="latest-quote" className="text-xs text-ink3">
            {ui.latestNotCovered(ticker)}
          </span>
        )}
      </div>
      <CompanySearch id="company-search" label={ui.searchLabel} className="w-full tablet:w-80" />
    </header>
  );
}

const RANGES = ['3m', '6m', '1y'] as const;
type Range = (typeof RANGES)[number];
const RANGE_SESSIONS: Record<Range, number> = { '3m': 63, '6m': 126, '1y': 252 };

const SECTIONS = [
  'overview',
  'financials',
  'earnings',
  'holders',
  'risk',
  'shariah',
  'short',
  'dividends',
] as const;
type SectionKey = (typeof SECTIONS)[number];

const RISK_MODES = ['yoy', 'qoq'] as const;

/** Tablet and desktop: one section at a time behind accessible tabs, in the company details card. */
function SectionTabs({
  value,
  onChange,
  render,
}: {
  value: SectionKey;
  onChange: (k: SectionKey) => void;
  render: (k: SectionKey) => React.ReactNode;
}) {
  return (
    <section aria-label={ui.details} className={`${cardClass} gap-3.5`}>
      <Tabs
        label={ui.sections}
        idPrefix="study"
        options={SECTIONS.map((k) => ({ key: k, label: ui.sectionNames[k] ?? k }))}
        value={value}
        onChange={onChange}
      >
        {render(value)}
      </Tabs>
    </section>
  );
}

/** Phones: every section as a collapsible block, the overview open first; closed ones load nothing. */
function SectionAccordions({ render }: { render: (k: SectionKey) => React.ReactNode }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ overview: true });
  return (
    <section aria-label={ui.details} className="flex flex-col gap-3">
      {SECTIONS.map((k) => (
        <details
          key={k}
          open={!!open[k]}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((o) => (o[k] === isOpen ? o : { ...o, [k]: isOpen }));
          }}
          className="group rounded-xl border border-line bg-surface"
        >
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 text-[0.9375rem] font-semibold text-ink select-none">
            {ui.sectionNames[k]}
            <ChevronRight
              aria-hidden="true"
              size={18}
              className="text-ink3 transition-transform group-open:rotate-90 motion-reduce:transition-none rtl:rotate-180"
            />
          </summary>
          {open[k] && <div className="flex flex-col gap-3 p-3 pt-0">{render(k)}</div>}
        </details>
      ))}
    </section>
  );
}

const defaultToggles: ChartToggles = {
  sma50: true,
  sma200: true,
  ema20: false,
  rsi: false,
  volume: true,
};

/** The indicator toggles, remembered in this browser only (storage may be blocked, so every access is guarded). */
function useStoredToggles() {
  const key = 'marsad.study.toggles';
  const [v, setV] = useState<ChartToggles>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as Partial<ChartToggles>) : {};
      const out = { ...defaultToggles };
      for (const k of Object.keys(out) as (keyof ChartToggles)[])
        if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
      return out;
    } catch {
      return defaultToggles;
    }
  });
  const set = (next: ChartToggles) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Not remembered; the choice still applies to this visit.
    }
  };
  return [v, set] as const;
}

/** One marker in words: "2026-11-23: 8-K: Executive or director change (High)". */
const markerText = (m: ChartMarker) =>
  `${m.date}: ${m.label}${m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}`;

/** The detail line for the picked session: each marker on it, with the next-session move for results. */
function MarkerDetail({
  markers,
  date,
  moves,
}: {
  markers: readonly ChartMarker[];
  date: string | null;
  moves: ReadonlyMap<string, EarningsMove>;
}) {
  const on = date ? markers.filter((m) => m.date === date) : [];
  return (
    <p aria-live="polite" className="text-xs text-ink2">
      {on.length === 0
        ? markers.length === 0
          ? t.study.noMarkers
          : ui.markerPrompt
        : on.map((m, i) => {
            const move = m.results ? moves.get(m.date) : undefined;
            return (
              <span key={`${m.label}-${i}`} className="block">
                <span className="font-semibold text-ink">{markerLetter(m)}</span>
                {' · '}
                <Num>{dayMonthYear(m.date)}</Num>
                {' · '}
                {m.label}
                {m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}
                {move && (
                  <>
                    {' · '}
                    <span className={move.pct > 0 ? 'text-up' : move.pct < 0 ? 'text-down' : ''}>
                      <Num>{ui.nextSession(signedPct(move.pct, 1))}</Num>
                    </span>
                    {move.large ? ` (${ui.largeMove})` : ''}
                  </>
                )}
              </span>
            );
          })}
    </p>
  );
}

function SnapTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode | undefined;
  tone?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-elev p-3">
      <span className="text-xs text-ink3">{label}</span>
      <span className={`text-lg font-semibold whitespace-nowrap ${tone ?? 'text-ink'}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-ink2">{sub}</span>}
    </div>
  );
}

/** Snapshot (v2): market value, revenue over four quarters, net margin and the next earnings estimate. */
function Snapshot({
  ticker,
  cik,
  s,
  earnings,
}: {
  ticker: string;
  cik: string | undefined;
  s: BarSummary;
  earnings: EarningsEstimate | null | undefined;
}) {
  const x = ui.snapshot;
  // Shares its cache with the Short data panel, so the tile and the table read the same stored rows.
  const short = useQuery({ queryKey: ['short', ticker], queryFn: () => loadShortData(ticker) });
  const si = short.data?.interest[0];
  const facts = useQuery({
    queryKey: ['facts', cik],
    queryFn: () => loadFacts(cik as string),
    enabled: cik !== undefined,
  });
  const today = etDate(new Date());
  const snap = useMemo(
    () => (facts.data ? companySnapshot(facts.data, today, s.lastClose) : null),
    [facts.data, today, s.lastClose],
  );
  const pending = cik !== undefined && facts.isPending;
  const missing = cik === undefined ? x.noFiler : x.notReported;
  const fact = (v: string | null) =>
    pending ? <span className="text-sm text-ink3">{t.loading}</span> : (v ?? missing);
  const yoy = snap?.revenueTtmYoYPct ?? null;
  return (
    <section aria-label={x.title} className="flex flex-col gap-2">
      {facts.isError && (
        <p role="alert" className="text-sm text-crit">
          {t.study.panelError(x.title, facts.error.message)}
        </p>
      )}
      <AutoGrid min={150} gap="gap-2.5">
        <SnapTile
          label={x.marketValue}
          value={fact(snap?.marketValue == null ? null : formatUsd(snap.marketValue))}
          sub={
            snap?.sharesOutstanding && snap.marketValue !== null ? (
              <Num>
                {x.mvSub(
                  `${toFixedHalfUp(snap.sharesOutstanding.value / 1e9, 2)}B`,
                  money(s.lastClose),
                )}
              </Num>
            ) : undefined
          }
        />
        <SnapTile
          label={x.revenue}
          value={fact(snap?.revenueTtm?.value == null ? null : formatUsd(snap.revenueTtm.value))}
          tone={yoy === null ? undefined : yoy >= 0 ? 'text-up' : 'text-down'}
          sub={
            yoy !== null ? (
              <Num>{x.revenueYoY(signedPct(yoy, 0))}</Num>
            ) : snap?.revenueTtmEnd ? (
              <Num>{x.revenueTo(snap.revenueTtmEnd)}</Num>
            ) : undefined
          }
        />
        <SnapTile
          label={x.netMargin}
          value={fact(
            snap?.netMarginTtmPct == null ? null : `${toFixedHalfUp(snap.netMarginTtmPct, 1)}%`,
          )}
          sub={snap?.netMarginTtmPct == null ? undefined : x.netMarginSub}
        />
        <SnapTile
          label={x.nextEarnings}
          value={
            earnings === undefined ? (
              <span className="text-sm text-ink3">{t.loading}</span>
            ) : earnings === null ? (
              <span className="text-sm font-normal text-ink3">{ui.noEarnings}</span>
            ) : (
              <Num>{`~ ${weekdayDayMonth(earnings.date)}`}</Num>
            )
          }
          sub={
            earnings ? (
              <>
                {x.nextSub}
                {earnings.overdue && <span className="block text-warn">{ui.earningsOverdue}</span>}
              </>
            ) : undefined
          }
        />
        <SnapTile
          label={x.shortInterest}
          value={
            short.isPending ? (
              <span className="text-sm text-ink3">{t.loading}</span>
            ) : !si ? (
              <span className="text-sm font-normal text-ink3">
                {short.isError
                  ? t.study.panelError(x.shortInterest, short.error.message)
                  : ui.noShort}
              </span>
            ) : (
              <Num>{ui.shortShares(toFixedHalfUp(si.shortInterest / 1e6, 1))}</Num>
            )
          }
          sub={
            si ? (
              <Num>
                {ui.shortSub(
                  si.daysToCover === null ? null : toFixedHalfUp(si.daysToCover, 1),
                  si.date,
                )}
              </Num>
            ) : undefined
          }
        />
      </AutoGrid>
      {snap && (
        <p className="text-xs text-ink3">{x.provenance(snap.asOf, s.asOf, snap.formulaVersion)}</p>
      )}
    </section>
  );
}

/** Dollars in the units a person reads: $7.23T, $304.2B, $812.4M. */
function formatUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${toFixedHalfUp(abs / 1e12, 2)}T`;
  if (abs >= 1e9) return `${sign}$${toFixedHalfUp(abs / 1e9, 1)}B`;
  if (abs >= 1e6) return `${sign}$${toFixedHalfUp(abs / 1e6, 1)}M`;
  return `${sign}$${money(abs)}`;
}

export function StudyCompany() {
  const { ticker: raw } = useParams({ from: '/study/$ticker' });
  const ticker = normalizeTicker(raw);
  const [toggles, setToggles] = useStoredToggles();
  const [range, setRange] = useRemembered<Range>('marsad.study.range', RANGES, '1y');
  const [section, setSection] = useRemembered<SectionKey>(
    'marsad.study.section',
    SECTIONS,
    'overview',
  );
  const [riskMode, setRiskMode] = useRemembered('marsad.study.risk', RISK_MODES, 'yoy');
  const [picked, setPicked] = useState<string | null>(null);
  const wide = useWide();
  const q = useQuery({
    queryKey: ['study', ticker],
    queryFn: () => loadStudy(ticker as string),
    enabled: ticker !== null,
  });
  const summary = useMemo(() => (q.data ? summarizeBars(q.data.bars) : null), [q.data]);
  // Dividends load on their own: if they fail the chart still shows, just without their markers.
  const dividends = useQuery({
    queryKey: ['dividends', ticker],
    queryFn: () => loadDividends(ticker as string),
    enabled: ticker !== null,
  });
  // The page's filings list keeps the newest 200 rows; results 8-Ks are asked for on their own so older earnings
  // still get their marker. Shares its cache entry with the Earnings panel.
  const cik = q.data?.company?.cik;
  const results = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik as string),
    enabled: cik !== undefined,
  });
  // Halts, Marsad's alerts and insider purchases mark the chart too; each loads on its own, and the insiders query
  // shares its cache with the Insiders panel.
  const events = useQuery({
    queryKey: ['chart-events', ticker],
    queryFn: () => loadChartEvents(ticker as string),
    enabled: ticker !== null,
  });
  const insiders = useQuery({
    queryKey: ['insiders', cik],
    queryFn: () => loadInsiders(cik as string),
    enabled: cik !== undefined,
  });
  // Estimated from the stored results 8-Ks (item 2.02), like the Watch calendar; undefined while loading.
  const earningsEstimate = useMemo(
    () =>
      results.data
        ? estimateNextEarnings(
            results.data.map((f) => f.filingDate),
            etDate(new Date()),
          )
        : cik === undefined && q.data
          ? null
          : undefined,
    [results.data, cik, q.data],
  );
  const markers = useMemo(
    () =>
      q.data
        ? buildEventMarkers(
            mergeFilingEvents(filingEvents(q.data.filings), filingEvents(results.data ?? [])),
            q.data.splits,
            q.data.bars.map((b) => b.date),
            dividends.data ?? [],
            {
              // Open-market purchases only (code P), original filings, placed when they became public.
              insiderBuys: (insiders.data?.rows ?? []).flatMap((r) =>
                r.code === 'P' &&
                !r.isAmendment &&
                r.table === 'non-derivative' &&
                r.acquiredDisposed === 'A' &&
                r.filedAt
                  ? [
                      {
                        filedAt: r.filedAt,
                        owner: r.ownerName,
                        valueUsd: r.valueUsd,
                        plan10b5: r.plan10b5,
                      },
                    ]
                  : [],
              ),
              halts: events.data?.halts ?? [],
              alerts: events.data?.alerts ?? [],
            },
          )
        : [],
    [q.data, dividends.data, results.data, insiders.data, events.data],
  );
  // The move after each results release, keyed by the session that could first trade on it (the E marker's bar).
  const moves = useMemo(() => {
    const out = new Map<string, EarningsMove>();
    if (!q.data) return out;
    for (const f of results.data ?? []) {
      const r = earningsMove(f, q.data.bars, q.data.splits);
      if ('move' in r) out.set(r.move.reactionDate, r.move);
    }
    return out;
  }, [q.data, results.data]);

  if (ticker === null)
    return (
      <p role="alert" className="text-crit">
        {t.study.badTicker(raw)}
      </p>
    );

  // The picked session, or the newest marker until one is picked.
  const shownDate = picked ?? markers.at(-1)?.date ?? null;

  const chip = (k: keyof ChartToggles, label: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={toggles[k]}
      onClick={() => setToggles({ ...toggles, [k]: !toggles[k] })}
      className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
        toggles[k] ? 'border-line-strong bg-elev text-ink' : 'border-line text-ink3'
      }`}
    >
      {label}
    </button>
  );

  const render = (k: SectionKey): React.ReactNode => {
    if (!q.data) return null;
    const cikOf = q.data.company?.cik;
    switch (k) {
      case 'overview':
        return (
          <>
            <AutoGrid min={320} gap="gap-4">
              <ThesisCard ticker={q.data.ticker} />
              {cikOf && <Business cik={cikOf} />}
            </AutoGrid>
            <section aria-labelledby="more" className={tileClass}>
              <h2 id="more" className={panelTitle}>
                {t.study.placeholdersTitle}
              </h2>
              <ul className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
                {t.study.placeholders.map((p) => (
                  <li
                    key={p.name}
                    className="flex gap-3 rounded-[10px] border border-dashed border-line-strong p-3"
                  >
                    <Lock aria-hidden="true" size={18} className="mt-0.5 flex-none text-ink3" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-ink">{p.name}</span>
                      <span className="text-[13px]">
                        <span className="font-medium text-ink2">{p.state}.</span>{' '}
                        <span className="text-ink3">{p.why}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        );
      case 'financials':
        return <>{cikOf && <Financials cik={cikOf} bars={q.data.bars} />}</>;
      case 'earnings':
        return (
          <>
            <section aria-labelledby="next-results" className={tileClass}>
              <h2 id="next-results" className={panelTitle}>
                {ui.nextResults}
              </h2>
              {earningsEstimate === undefined ? (
                <p className="text-sm text-ink3">{t.loading}</p>
              ) : earningsEstimate === null ? (
                <p className="text-sm text-ink3">{ui.noEarnings}</p>
              ) : (
                <>
                  <span className="text-[22px] font-semibold text-ink">
                    <Num>{`~ ${weekdayDayMonth(earningsEstimate.date)} ${earningsEstimate.date.slice(0, 4)}`}</Num>
                  </span>
                  <p className="text-xs text-ink3">{ui.nextResultsSub}</p>
                  <p className="text-sm text-ink2">
                    <Num>{ui.earningsRange(earningsEstimate.from, earningsEstimate.to)}</Num>
                  </p>
                  {earningsEstimate.overdue && (
                    <p className="text-xs text-warn">{ui.earningsOverdue}</p>
                  )}
                </>
              )}
              <p className="text-[13px] text-ink2">{ui.impliedMissing}</p>
            </section>
            {cikOf && <Earnings cik={cikOf} bars={q.data.bars} splits={q.data.splits} />}
          </>
        );
      case 'holders':
        return (
          <>
            {cikOf && <Holders13F ticker={q.data.ticker} />}
            {cikOf && <Insiders cik={cikOf} />}
          </>
        );
      case 'short':
        return <ShortData ticker={q.data.ticker} />;
      case 'risk':
        return (
          <>
            <Segmented
              label={ui.riskToggle}
              options={RISK_MODES.map((m) => ({ key: m, label: ui.riskModes[m] ?? m }))}
              value={riskMode}
              onChange={setRiskMode}
            />
            {cikOf &&
              (riskMode === 'yoy' ? (
                <RiskFactors cik={cikOf} />
              ) : (
                <QuarterlyRiskFactors cik={cikOf} />
              ))}
            {!cikOf && <p className="text-sm text-ink3">{t.study.noCompany}</p>}
          </>
        );
      case 'dividends':
        return <Dividends rows={dividends.data ?? []} />;
      case 'shariah':
        return cikOf ? <ShariahAid cik={cikOf} bars={q.data.bars} /> : null;
    }
  };

  const staleLine =
    q.data && summary
      ? q.data.lastCompletedDay && summary.asOf < q.data.lastCompletedDay
        ? t.study.stale(summary.asOf, q.data.lastCompletedDay)
        : t.study.current
      : null;

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/study"
        className="-mb-3 inline-flex min-h-11 items-center self-start text-sm text-ink3 underline underline-offset-4"
      >
        {t.study.back}
      </Link>

      {!q.data && (
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.01em] text-ink">
          {ticker}
        </h1>
      )}
      {q.isPending && <SkeletonCards heights={['6rem', '22rem', '7rem']} />}
      {q.isError && (
        <p role="alert" className="text-crit">
          {q.error.message}
        </p>
      )}

      {q.data && <Header ticker={ticker} data={q.data} s={summary} />}
      {q.data && !q.data.company && <p className="text-sm text-ink3">{t.study.noCompany}</p>}
      {q.data && q.data.bars.length === 0 && <p className="text-sm text-ink3">{t.study.noBars}</p>}

      {q.data && summary && (
        <>
          <section aria-labelledby="chart-h" className={`${cardClass} gap-2.5`}>
            <h2 id="chart-h" className="sr-only">
              {t.study.chart}
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label={t.study.indicators} className="flex flex-wrap gap-1.5">
                {chip('sma50', t.study.sma50)}
                {chip('sma200', t.study.sma200)}
                {chip('ema20', t.study.ema20)}
                {chip(
                  'rsi',
                  ui.rsiChip(summary.rsi14 === null ? null : toFixedHalfUp(summary.rsi14, 1)),
                )}
                {chip('volume', t.study.volume)}
              </div>
              <Segmented
                label={ui.chartRange}
                options={RANGES.map((k) => ({ key: k, label: ui.ranges[k] ?? k }))}
                value={range}
                onChange={setRange}
              />
            </div>
            <div
              role="figure"
              aria-label={t.study.chartLabel(ticker, summary.asOf)}
              className="overflow-hidden rounded-[10px] bg-elev"
            >
              <Suspense fallback={<SkeletonCards heights={[wide ? '300px' : '240px']} />}>
                <PriceChart
                  bars={q.data.bars}
                  markers={markers}
                  toggles={toggles}
                  height={wide ? 300 : 240}
                  visibleSessions={RANGE_SESSIONS[range]}
                  onPick={setPicked}
                />
              </Suspense>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <MarkerDetail markers={markers} date={shownDate} moves={moves} />
              <span className="text-xs text-ink3">
                <Num>
                  {ui.legend(
                    t.study.range(summary.rangeSessions),
                    usd(summary.low52w),
                    usd(summary.high52w),
                  )}
                </Num>
              </span>
            </div>
            <p className="text-xs text-ink2">
              {ui.trendLine(
                t.study.trendLabels[summary.trend],
                summary.sma50 === null ? t.study.unavailable : usd(summary.sma50),
                summary.sma200 === null ? t.study.unavailable : usd(summary.sma200),
              )}
            </p>
            {markers.length > 0 && (
              <details className="rounded-lg border border-line">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-ink2 select-none">
                  {ui.markersAll(markers.length)}
                </summary>
                <div className="flex flex-col gap-2 border-t border-line p-3">
                  <Info>{t.study.markersNote}</Info>
                  <ul className="flex max-h-72 flex-col overflow-y-auto">
                    {[...markers].reverse().map((m, i) => (
                      <li key={`${m.date}-${m.label}-${i}`}>
                        <button
                          type="button"
                          aria-pressed={shownDate === m.date}
                          onClick={() => setPicked(m.date)}
                          className="flex min-h-11 w-full items-center gap-3 border-b border-line py-1.5 text-start text-sm text-ink2"
                        >
                          <span
                            aria-hidden="true"
                            className={`flex size-7 flex-none items-center justify-center rounded-full border bg-surface text-[11px] font-bold ${
                              m.results || m.kind === 'high-8k'
                                ? 'border-warn text-warn'
                                : m.kind === 'alert'
                                  ? 'border-up text-up'
                                  : m.kind === 'halt'
                                    ? 'border-crit text-crit'
                                    : 'border-line-strong text-ink3'
                            }`}
                          >
                            {markerLetter(m)}
                          </span>
                          <span>{markerText(m)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
            <p
              className={staleLine === t.study.current ? 'text-xs text-ink3' : 'text-sm text-warn'}
              role="status"
            >
              {staleLine}
            </p>
            <p className="text-xs text-ink3">
              {t.study.provenance(summary.asOf, summary.sessions, summary.formulaVersion)}
            </p>
          </section>
          <Snapshot ticker={ticker} cik={cik} s={summary} earnings={earningsEstimate} />
        </>
      )}

      {q.data && (
        <AutoGrid min={380} gap="gap-5" className="items-start">
          <NewsPanel ticker={q.data.ticker} />
          <FilingsCard data={q.data} />
        </AutoGrid>
      )}

      {q.data &&
        (wide ? (
          <SectionTabs value={section} onChange={setSection} render={render} />
        ) : (
          <SectionAccordions render={render} />
        ))}
    </div>
  );
}
