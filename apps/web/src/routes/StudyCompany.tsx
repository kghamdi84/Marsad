import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  buildEventMarkers,
  estimateNextEarnings,
  toFixedHalfUp,
  type EarningsEstimate,
  describeEightK,
  disclosureLag,
  dualClock,
  etDate,
  formLabel,
  mergeFilingEvents,
  normalizeTicker,
  summarizeBars,
  type BarSummary,
  type Materiality,
} from '@marsad/core';
import type { ChartToggles } from '../components/PriceChart';
import { useQuotePoll } from '../lib/refresh';
import { loadQuoteView, quoteStatus } from '../lib/quotes';
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
import { filingEvents, loadStudy, secUrl, type FilingRow, type StudyData } from '../lib/study';
import {
  loadChartEvents,
  loadDividends,
  loadEarningsFilings,
  loadInsiders,
  loadShortData,
  type ShortData as ShortRows,
} from '../lib/studyPanels';
import { ThesisCard } from '../components/study/ThesisCard';
import { ChevronRight, Lock } from 'lucide-react';
import {
  Card,
  Segmented,
  SkeletonCards,
  Tabs,
  cardClass,
  useRemembered,
  useWide,
} from '../components/Card';
import { panelTitle } from '../components/study/Panel';
import { t } from '../strings';

const PriceChart = lazy(() => import('../components/PriceChart'));

const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';
const td = 'border-b border-line px-2 py-2 align-top';
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ui = t.study.ui;

/** The header: ticker, name, last close with its change, and whether the newest session is stored. */
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
  const change = s?.changePct ?? null;
  const arrow = change === null ? '' : change > 0 ? '\u25B2' : change < 0 ? '\u25BC' : '';
  const tint =
    change === null
      ? ''
      : change > 0
        ? 'bg-up/15 text-up'
        : change < 0
          ? 'bg-down/15 text-down'
          : '';
  return (
    <header className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur tablet:static tablet:mx-0 tablet:rounded-xl tablet:border-0 tablet:bg-raised tablet:p-5 tablet:backdrop-blur-none">
      <div className="flex min-w-0 flex-col">
        <h1 className="text-xl leading-tight font-bold text-white tablet:text-[1.75rem]">
          {ticker}
        </h1>
        {data.company?.name && (
          <span className="truncate text-sm text-muted">{data.company.name}</span>
        )}
      </div>
      {s && (
        <div className="flex flex-col items-end gap-1">
          <span className="text-[1.375rem] font-bold text-white tabular-nums">
            ${money(s.lastClose)}
          </span>
          <span className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${tint}`}>
              {change === null
                ? t.study.unavailable
                : `${arrow} ${change > 0 ? '+' : ''}${change.toFixed(2)}%`}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                stale ? 'bg-warn/15 text-warn' : 'bg-muted/15 text-fg'
              }`}
            >
              {stale ? ui.staleBadge : ui.endOfDay}
            </span>
          </span>
          {tq && latest && (
            <span
              data-testid="latest-quote"
              className={`text-xs tabular-nums ${latest.state === 'stale' ? 'text-warn' : 'text-muted'}`}
            >
              {ui.latestLine(money(tq.price), latest.label)}
            </span>
          )}
          {notCovered && (
            <span data-testid="latest-quote" className="text-xs text-muted">
              {ui.latestNotCovered(ticker)}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

function TileBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 tablet:p-3.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

/** Key tiles: the range, RSI 14 with its zones, the trend and the two averages. */
function Summary({
  data,
  s,
  earnings,
  short,
}: {
  data: StudyData;
  s: BarSummary;
  earnings: EarningsEstimate | null | undefined;
  short: ShortRows | undefined;
}) {
  const si = short?.interest[0];
  const staleLine =
    data.lastCompletedDay && s.asOf < data.lastCompletedDay
      ? t.study.stale(s.asOf, data.lastCompletedDay)
      : t.study.current;
  const span = s.high52w - s.low52w;
  const pos = span > 0 ? Math.min(1, Math.max(0, (s.lastClose - s.low52w) / span)) : 0.5;
  const posPct = (pos * 100).toFixed(0);
  return (
    <section aria-labelledby="summary" className="flex flex-col gap-2">
      <h2 id="summary" className="sr-only">
        {t.study.summary}
      </h2>
      <div className="grid grid-cols-2 gap-2 tablet:grid-cols-3 tablet:gap-3">
        <TileBox label={t.study.range(s.rangeSessions)}>
          <div
            role="img"
            aria-label={ui.rangeAria(`$${money(s.low52w)}`, `$${money(s.high52w)}`, posPct)}
            className="relative mt-1 h-1.5 rounded-full bg-gradient-to-r from-down/55 to-up/60"
          >
            <span
              className="absolute -top-[5px] -ms-2 size-4 rounded-full border-[3px] border-surface bg-white"
              style={{ insetInlineStart: `${posPct}%` }}
            />
          </div>
          <span className="flex justify-between text-[0.8125rem] text-fg tabular-nums">
            <span>${money(s.low52w)}</span>
            <span>${money(s.high52w)}</span>
          </span>
        </TileBox>
        <TileBox label={t.study.rsi}>
          {s.rsi14 === null ? (
            <span className="text-sm text-muted">{t.study.unavailable}</span>
          ) : (
            <>
              <span className="text-xl font-bold text-white tabular-nums">
                {s.rsi14.toFixed(1)}
              </span>
              <div
                role="img"
                aria-label={ui.rsiAria(s.rsi14.toFixed(1))}
                className="relative h-1.5 rounded-full bg-faint/20"
              >
                <span className="absolute inset-y-0 start-0 w-[30%] rounded-s-full bg-up/35" />
                <span className="absolute inset-y-0 end-0 w-[30%] rounded-e-full bg-down/35" />
                <span
                  className="absolute -top-[5px] -ms-2 size-4 rounded-full border-[3px] border-surface bg-white"
                  style={{ insetInlineStart: `${Math.min(100, Math.max(0, s.rsi14)).toFixed(1)}%` }}
                />
              </div>
              <span className="text-[0.6875rem] text-muted">{ui.rsiZones}</span>
            </>
          )}
        </TileBox>
        <TileBox label={t.study.trend}>
          <span className="text-sm leading-snug font-semibold text-white">
            {t.study.trendLabels[s.trend]}
          </span>
        </TileBox>
        <TileBox label={ui.averages}>
          <span className="flex justify-between gap-2 text-sm">
            <span className="text-muted">{t.study.sma50}</span>
            <span className="text-white tabular-nums">
              {s.sma50 === null ? t.study.unavailable : `$${money(s.sma50)}`}
            </span>
          </span>
          <span className="flex justify-between gap-2 text-sm">
            <span className="text-muted">{t.study.sma200}</span>
            <span className="text-white tabular-nums">
              {s.sma200 === null ? t.study.unavailable : `$${money(s.sma200)}`}
            </span>
          </span>
        </TileBox>
        <TileBox label={ui.nextEarnings}>
          {earnings === undefined ? (
            <span className="text-sm text-muted">{t.loading}</span>
          ) : earnings === null ? (
            <span className="text-sm text-muted">{ui.noEarnings}</span>
          ) : (
            <>
              <span className="text-lg font-bold text-white tabular-nums">{earnings.date}</span>
              <span className="text-[0.6875rem] text-muted">
                {ui.earningsRange(earnings.from, earnings.to)}
              </span>
              {earnings.overdue && (
                <span className="text-[0.6875rem] text-warn">{ui.earningsOverdue}</span>
              )}
            </>
          )}
        </TileBox>
        <TileBox label={ui.shortInterest}>
          {short === undefined ? (
            <span className="text-sm text-muted">{t.loading}</span>
          ) : !si ? (
            <span className="text-sm text-muted">{ui.noShort}</span>
          ) : (
            <>
              <span className="text-lg font-bold text-white tabular-nums">
                {ui.shortShares(toFixedHalfUp(si.shortInterest / 1e6, 1))}
              </span>
              <span className="text-[0.6875rem] text-muted">
                {ui.shortSub(
                  si.daysToCover === null ? null : toFixedHalfUp(si.daysToCover, 1),
                  si.date,
                )}
              </span>
            </>
          )}
        </TileBox>
      </div>
      <p
        className={staleLine === t.study.current ? 'text-xs text-muted' : 'text-sm text-warn'}
        role="status"
      >
        {staleLine}
      </p>
      <p className="text-xs text-muted">
        {t.study.provenance(s.asOf, s.sessions, s.formulaVersion)}
      </p>
    </section>
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
  'short',
  'risk',
  'news',
  'dividends',
  'shariah',
] as const;
type SectionKey = (typeof SECTIONS)[number];

/** Tablet and desktop: one section at a time behind accessible tabs. */
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
    <Tabs
      label={ui.sections}
      idPrefix="study"
      options={SECTIONS.map((k) => ({ key: k, label: ui.sectionNames[k] ?? k }))}
      value={value}
      onChange={onChange}
    >
      {render(value)}
    </Tabs>
  );
}

/** Phones: every section as a collapsible block, the overview open first; closed ones load nothing. */
function SectionAccordions({ render }: { render: (k: SectionKey) => React.ReactNode }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ overview: true });
  return (
    <div className="flex flex-col gap-3">
      {SECTIONS.map((k) => (
        <details
          key={k}
          open={!!open[k]}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((o) => (o[k] === isOpen ? o : { ...o, [k]: isOpen }));
          }}
          className="group rounded-2xl border border-line bg-surface"
        >
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 text-[0.9375rem] font-semibold text-white select-none">
            {ui.sectionNames[k]}
            <ChevronRight
              aria-hidden="true"
              size={18}
              className="text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
          </summary>
          {open[k] && <div className="flex flex-col gap-3 p-2 pt-0">{render(k)}</div>}
        </details>
      ))}
    </div>
  );
}

function Materiality({ level, defaulted }: { level: Materiality | 'unknown'; defaulted: boolean }) {
  return (
    <span
      className="whitespace-nowrap rounded-sm border border-line px-1.5 py-0.5 text-xs"
      title={defaulted ? t.study.marsadDefault : undefined}
    >
      {t.study.materiality[level]}
    </span>
  );
}

function FilingWhat({ f }: { f: FilingRow }) {
  if (f.form === '8-K' || f.form === '8-K/A') {
    const d = describeEightK(f.items);
    return (
      <div className="flex flex-col gap-1">
        <Materiality
          level={d.materiality}
          defaulted={d.items.some((i) => i.basis === 'marsad-default')}
        />
        <ul className="list-none">
          {d.items.map((i) => (
            <li key={i.item} title={i.officialTitle}>
              Item {i.item}: {i.plain}
            </li>
          ))}
          {d.unknown.map((n) => (
            <li key={n}>Item {n}: not in the table</li>
          ))}
        </ul>
      </div>
    );
  }
  return <span>{formLabel(f.form)}</span>;
}

function FilingsTable({ data }: { data: StudyData }) {
  if (data.filings.length === 0) return <p className="text-muted">{t.study.noFilings}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{t.study.colWhen}</th>
            <th className={th}>{t.study.colForm}</th>
            <th className={th}>{t.study.colWhat}</th>
            <th className={th}>{t.study.colLag}</th>
          </tr>
        </thead>
        <tbody>
          {data.filings.slice(0, 60).map((f) => {
            const lag = disclosureLag(f.form);
            const link = data.company ? secUrl(data.company.cik, f) : null;
            const when = f.acceptedAt
              ? `${etDate(new Date(f.acceptedAt))} ${dualClock(new Date(f.acceptedAt), DEFAULT_LOCAL_ZONE).label}`
              : f.filingDate;
            return (
              <tr key={f.accession}>
                <td className={td}>{when}</td>
                <td className={td}>
                  {link ? (
                    <a
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {f.form} <span className="sr-only">{t.study.viewOnSec}</span>
                    </a>
                  ) : (
                    f.form
                  )}
                </td>
                <td className={td}>
                  <FilingWhat f={f} />
                </td>
                <td className={`${td} text-muted`}>{lag?.label ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const shortQ = useQuery({
    queryKey: ['short', ticker],
    queryFn: () => loadShortData(ticker as string),
    enabled: ticker !== null,
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

  if (ticker === null)
    return (
      <p role="alert" className="text-down">
        {t.study.badTicker(raw)}
      </p>
    );

  const chip = (k: keyof ChartToggles, label: string) => (
    <button
      key={k}
      type="button"
      aria-pressed={toggles[k]}
      onClick={() => setToggles({ ...toggles, [k]: !toggles[k] })}
      className={`min-h-11 rounded-full border px-3 text-sm ${
        toggles[k] ? 'border-up/60 bg-up/15 font-semibold text-white' : 'border-line text-muted'
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
            <ThesisCard ticker={q.data.ticker} />
            {cikOf && <Business cik={cikOf} />}
            <section aria-labelledby="more" className={`${cardClass} gap-3!`}>
              <h2 id="more" className={panelTitle}>
                {t.study.placeholdersTitle}
              </h2>
              <ul className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
                {t.study.placeholders.map((p) => (
                  <li
                    key={p.name}
                    className="flex gap-3 rounded-xl border border-dashed border-line p-3"
                  >
                    <Lock aria-hidden="true" size={18} className="mt-0.5 flex-none text-muted" />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-white">{p.name}</span>
                      <span className="text-sm">
                        <span className="font-medium">{p.state}.</span>{' '}
                        <span className="text-muted">{p.why}</span>
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
        return <>{cikOf && <Earnings cik={cikOf} bars={q.data.bars} splits={q.data.splits} />}</>;
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
            <section aria-labelledby="filings" className={`${cardClass} gap-3!`}>
              <h2 id="filings" className={panelTitle}>
                {t.study.filings}
              </h2>
              <p className="text-sm text-muted">{t.study.filingsNote}</p>
              <FilingsTable data={q.data} />
            </section>
            {cikOf && <RiskFactors cik={cikOf} />}
            {cikOf && <QuarterlyRiskFactors cik={cikOf} />}
          </>
        );
      case 'dividends':
        return <Dividends rows={dividends.data ?? []} />;
      case 'shariah':
        return cikOf ? <ShariahAid cik={cikOf} bars={q.data.bars} /> : null;
      case 'news':
        return <NewsPanel ticker={q.data.ticker} />;
    }
  };

  return (
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <Link
        to="/study"
        className="inline-flex min-h-11 items-center self-start text-sm text-muted underline underline-offset-4"
      >
        {t.study.back}
      </Link>

      {!q.data && <h1 className="text-[1.75rem] font-bold text-white">{ticker}</h1>}
      {q.isPending && <SkeletonCards heights={['6rem', '7rem', '22rem']} />}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}

      {q.data && <Header ticker={ticker} data={q.data} s={summary} />}
      {q.data && !q.data.company && <p className="text-sm text-muted">{t.study.noCompany}</p>}
      {q.data && q.data.bars.length === 0 && <p className="text-muted">{t.study.noBars}</p>}

      {q.data && summary && (
        <>
          {/* The design puts the chart first on a phone; the tiles follow it. */}
          {wide && (
            <Summary data={q.data} s={summary} earnings={earningsEstimate} short={shortQ.data} />
          )}
          <Card
            id="chart"
            title={t.study.chart}
            aside={
              <Segmented
                label={ui.chartRange}
                options={RANGES.map((k) => ({ key: k, label: ui.ranges[k] ?? k }))}
                value={range}
                onChange={setRange}
              />
            }
          >
            <div role="group" aria-label={t.study.indicators} className="flex flex-wrap gap-2">
              {chip('sma50', t.study.sma50)}
              {chip('sma200', t.study.sma200)}
              {chip('ema20', t.study.ema20)}
              {chip('rsi', t.study.rsi)}
              {chip('volume', t.study.volume)}
            </div>
            <div
              role="figure"
              aria-label={t.study.chartLabel(ticker, summary.asOf)}
              className="overflow-hidden rounded-lg"
            >
              <Suspense fallback={<SkeletonCards heights={[wide ? '360px' : '260px']} />}>
                <PriceChart
                  bars={q.data.bars}
                  markers={markers}
                  toggles={toggles}
                  height={wide ? 360 : 260}
                  visibleSessions={RANGE_SESSIONS[range]}
                />
              </Suspense>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[0.9375rem] font-semibold text-white">{t.study.markers}</h3>
              <p className="text-xs text-muted">{t.study.markersNote}</p>
              {markers.length === 0 ? (
                <p className="text-sm text-muted">{t.study.noMarkers}</p>
              ) : (
                <>
                  <ul className="flex max-h-72 flex-col overflow-y-auto">
                    {[...markers].reverse().map((m) => (
                      <li
                        key={`${m.date}-${m.label}`}
                        className="flex min-h-11 items-center gap-3 border-b border-line/60 py-1.5 text-sm last:border-0"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex size-8 flex-none items-center justify-center rounded-full text-xs font-bold ${
                            m.materiality === 'high'
                              ? 'bg-warn/20 text-warn'
                              : m.kind === 'halt'
                                ? 'bg-down/20 text-down'
                                : 'bg-up/15 text-up'
                          }`}
                        >
                          {ui.markerLetters[m.kind] ?? '?'}
                        </span>
                        <span>
                          {m.date}: {m.label}
                          {m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">{ui.markerLegend}</p>
                </>
              )}
            </div>
          </Card>
          {!wide && (
            <Summary data={q.data} s={summary} earnings={earningsEstimate} short={shortQ.data} />
          )}
        </>
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
