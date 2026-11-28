import { Suspense, lazy, useEffect, useMemo } from 'react';
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
  type EarningsEstimate,
  type EarningsMove,
} from '@marsad/core';
import { useQuotePoll } from '../lib/refresh';
import { loadQuoteView, quoteStatus } from '../lib/quotes';
import { loadPreferences } from '../lib/settings';
import { shariahAsOf } from '../lib/shariah';
import { weekdayDayMonth } from '../lib/dates';
import { CompanySearch } from '../components/study/CompanySearch';
import { filingEvents, formatUsd, loadStudy, type StudyData } from '../lib/study';
import { CompanyBrief, type BriefTarget } from '../components/study/CompanyBrief';
import {
  loadChartEvents,
  loadDividends,
  loadEarningsFilings,
  loadFacts,
  loadInsiders,
  loadShortData,
} from '../lib/studyPanels';
import { StudyChart } from '../components/study/StudyChart';
import { SkeletonCards, Tabs, cardClass } from '../components/Card';
import { AutoGrid, Num, Pill, signedPct, type Tone } from '../components/ui/kit';
import { panelTitle, tileClass } from '../components/study/Panel';
import { useView } from '../lib/view';
import { rememberViewed } from '../lib/recent';
import { SizeTradeLink } from '../components/journal/SizeTradeLink';
import { t } from '../strings';

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `$${money(n)}`;

const ui = t.study.ui;

/**
 * Each Study view is its own chunk, loaded the first time its tab opens (ADR 0048: lazy chunks per Study view and
 * a bundle budget); the chart, header and tabs stay in this page's chunk.
 */
const StudyOverview = lazy(async () => ({
  default: (await import('../components/study/views/Overview')).StudyOverview,
}));
const StudyAnalysts = lazy(async () => ({
  default: (await import('../components/study/views/Analysts')).StudyAnalysts,
}));
const StudyNews = lazy(async () => ({
  default: (await import('../components/study/views/News')).StudyNews,
}));
const StudyFilings = lazy(async () => ({
  default: (await import('../components/study/views/Filings')).StudyFilings,
}));
const StudyFinancials = lazy(async () => ({
  default: (await import('../components/study/views/Financials')).StudyFinancials,
}));
const StudyEarnings = lazy(async () => ({
  default: (await import('../components/study/views/Earnings')).StudyEarnings,
}));
const StudyTechnicals = lazy(async () => ({
  default: (await import('../components/study/views/Technicals')).StudyTechnicals,
}));
const StudyOwnership = lazy(async () => ({
  default: (await import('../components/study/views/Ownership')).StudyOwnership,
}));
const StudyDividends = lazy(async () => ({
  default: (await import('../components/study/views/Dividends')).StudyDividends,
}));
const StudyShariah = lazy(async () => ({
  default: (await import('../components/study/views/Shariah')).StudyShariah,
}));

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
        <SizeTradeLink ticker={ticker} className="mt-1 self-start" />
      </div>
      <CompanySearch id="company-search" label={ui.searchLabel} className="w-full tablet:w-80" />
    </header>
  );
}

const SECTIONS = [
  'overview',
  'analysts',
  'financials',
  'earnings',
  'technicals',
  'dividends',
  'ownership',
  'news',
  'filings',
  'shariah',
] as const;
type SectionKey = (typeof SECTIONS)[number];

/**
 * One view at a time behind accessible tabs (ADR 0048). The tab row wraps, so on phones it is a chip row like
 * Journal's; the choice is remembered on the device.
 */
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

export function StudyCompany() {
  const { ticker: raw } = useParams({ from: '/study/$ticker' });
  const ticker = normalizeTicker(raw);
  const [section, setSection] = useView<SectionKey>('marsad.study.section', SECTIONS, 'overview');
  // Recently viewed on Study's index (ADR 0048), kept on this device only.
  useEffect(() => {
    if (ticker !== null) rememberViewed(ticker);
  }, [ticker]);
  // A brief block's link: choose that view and bring the area into view.
  const openSection = (k: BriefTarget) => {
    setSection(k);
    requestAnimationFrame(() =>
      document.getElementById('study-area')?.scrollIntoView({ block: 'start' }),
    );
  };
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

  const render = (k: SectionKey): React.ReactNode => {
    if (!q.data) return null;
    const cikOf = q.data.company?.cik;
    switch (k) {
      case 'overview':
        return (
          <StudyOverview
            data={q.data}
            brief={
              <CompanyBrief
                data={q.data}
                earnings={earningsEstimate}
                results={results}
                insiders={insiders}
                events={events}
                dividends={dividends}
                onOpen={openSection}
              />
            }
          />
        );
      case 'analysts':
        return <StudyAnalysts data={q.data} />;
      case 'news':
        return <StudyNews data={q.data} />;
      case 'filings':
        return <StudyFilings data={q.data} />;
      case 'financials':
        return (
          <StudyFinancials
            data={q.data}
            lead={
              summary && (
                <Snapshot ticker={ticker} cik={cikOf} s={summary} earnings={earningsEstimate} />
              )
            }
          />
        );
      case 'earnings':
        return (
          <StudyEarnings
            data={q.data}
            estimate={earningsEstimate}
            lead={
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
            }
          />
        );
      case 'technicals':
        return <StudyTechnicals data={q.data} />;
      case 'ownership':
        return <StudyOwnership data={q.data} />;
      case 'dividends':
        return <StudyDividends data={q.data} rows={dividends.data ?? []} />;
      case 'shariah':
        return <StudyShariah data={q.data} />;
    }
  };

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
        <StudyChart data={q.data} summary={summary} markers={markers} moves={moves} />
      )}

      {q.data && (
        <div id="study-area" className="scroll-mt-4">
          <SectionTabs
            value={section}
            onChange={setSection}
            render={(k) => (
              <Suspense fallback={<SkeletonCards heights={['14rem']} />}>{render(k)}</Suspense>
            )}
          />
        </div>
      )}
    </div>
  );
}
