/**
 * Study's research sections (ADR 0048). Each section is self-contained: it takes the page's StudyData and reads
 * what else it needs through the shared hooks below (one cache entry per source), so it can move to another page
 * by changing a few lines where it is placed.
 */
import { useQuery } from '@tanstack/react-query';
import type { ChartMarker, EarningsEstimate } from '@marsad/core';
import { Num } from '../../ui/kit';
import type { StudyData } from '../../../lib/study';
import {
  loadCompanyResearch,
  loadDividendHistory,
  type CompanyResearch,
} from '../../../lib/research';
import { loadEarningsFilings, loadFacts, loadRecentDailyBars } from '../../../lib/studyPanels';
import { t } from '../../../strings';
import { AiView, AnalystsView, NextQuarterEstimate, RecommendationTrend } from './Analysts';
import { DividendsView } from './Dividends';
import { EarningsView } from './Earnings';
import { FinancialsView } from './Financials';
import { NewsView } from './News';
import { KeyStats, OwnershipBar, VsSpy, VendorBusiness } from './Overview';
import { PeersView } from './Peers';
import { TechnicalsView } from './Technicals';
import { R, etDay, reasonText } from './shared';

const MISSING = { ok: false as const, reason: 'not_stored' };

/** The research row for a ticker, shared by every section, the company brief and the quick look. */
export function useCompanyResearch(ticker: string) {
  return useQuery({
    queryKey: ['company-research', ticker],
    queryFn: () => loadCompanyResearch(ticker),
  });
}
export function useFacts(cik: string | undefined) {
  return useQuery({
    queryKey: ['facts', cik],
    queryFn: () => loadFacts(cik as string),
    enabled: cik !== undefined,
  });
}
export function useSpyBars(ticker: string, own: StudyData['bars']) {
  const q = useQuery({
    queryKey: ['research-spy'],
    queryFn: () => loadRecentDailyBars('SPY', 1000),
    enabled: ticker !== 'SPY',
  });
  return ticker === 'SPY' ? own : (q.data ?? null);
}
export function useDividendHistory(ticker: string) {
  return useQuery({
    queryKey: ['dividend-history', ticker],
    queryFn: () => loadDividendHistory(ticker),
  });
}

function parts(row: CompanyResearch | null | undefined) {
  return {
    analyst: row?.analyst ?? MISSING,
    profile: row?.profile ?? MISSING,
    thesis: row?.thesis ?? MISSING,
    calendar: row?.calendar ?? MISSING,
  };
}

/** One line on the research row: when it was fetched, and why any part is missing. */
export function ResearchStatus({ ticker }: { ticker: string }) {
  const rq = useCompanyResearch(ticker);
  if (rq.isPending) return <p className="text-xs text-ink3">{R.loading}</p>;
  if (rq.isError)
    return (
      <p role="alert" className="text-sm text-crit">
        {t.study.panelError(R.source, rq.error.message)}
      </p>
    );
  const row = rq.data;
  if (!row) return <p className="text-xs text-ink3">{R.noRow(ticker)}</p>;
  const missing = (['analyst', 'profile', 'thesis', 'calendar'] as const).flatMap((k) => {
    const p = row[k];
    return p.ok ? [] : [`${R.parts[k]}: ${reasonText(p.reason)}`];
  });
  return (
    <p className="text-xs text-ink3">
      <Num>{R.rowLine(row.fetchedAt ? etDay(row.fetchedAt) : R.na)}</Num>
      {missing.length > 0 && <span className="block text-warn">{missing.join(' · ')}</span>}
    </p>
  );
}

/** Overview facts: the vendor business text, key statistics (with Marsad's own figures), the stock vs SPY, peers. */
export function OverviewFacts({ data }: { data: StudyData }) {
  const ticker = data.ticker;
  const cik = data.company?.cik;
  const rq = useCompanyResearch(ticker);
  const facts = useFacts(cik);
  const spy = useSpyBars(ticker, data.bars);
  const divs = useDividendHistory(ticker);
  const p = parts(rq.data);
  return (
    <>
      <ResearchStatus ticker={ticker} />
      <VendorBusiness profile={p.profile} />
      <KeyStats
        profile={p.profile}
        bars={data.bars}
        spy={spy}
        facts={facts.data ?? null}
        dividends={divs.data ?? null}
      />
      <VsSpy ticker={ticker} bars={data.bars} spy={spy} />
      <PeersView ticker={ticker} bars={data.bars} profile={p.profile} />
    </>
  );
}

/** The labelled opinion: Tauric AI's thesis. */
export function OverviewOpinion({ ticker }: { ticker: string }) {
  const rq = useCompanyResearch(ticker);
  return <AiView thesis={parts(rq.data).thesis} />;
}

export function AnalystsSection({ data }: { data: StudyData }) {
  const rq = useCompanyResearch(data.ticker);
  const p = parts(rq.data);
  return (
    <>
      <ResearchStatus ticker={data.ticker} />
      <AnalystsView ticker={data.ticker} analyst={p.analyst} bars={data.bars} />
      <RecommendationTrend ticker={data.ticker} />
      <NextQuarterEstimate calendar={p.calendar} />
    </>
  );
}

export function FinancialsResearch({
  data,
  onOpenStatements,
}: {
  data: StudyData;
  onOpenStatements?: () => void;
}) {
  const cik = data.company?.cik;
  const facts = useFacts(cik);
  return (
    <FinancialsView
      facts={facts.data ?? null}
      factsError={
        facts.isError ? t.study.panelError(R.views.financials, facts.error.message) : null
      }
      hasCompany={cik !== undefined}
      onOpenStatements={onOpenStatements}
    />
  );
}

export function EarningsResearch({
  data,
  estimate,
}: {
  data: StudyData;
  estimate: EarningsEstimate | null | undefined;
}) {
  const cik = data.company?.cik;
  const rq = useCompanyResearch(data.ticker);
  const facts = useFacts(cik);
  const divs = useDividendHistory(data.ticker);
  const filings = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik as string),
    enabled: cik !== undefined,
  });
  const p = parts(rq.data);
  return (
    <EarningsView
      cik={cik}
      facts={cik === undefined ? [] : (facts.data ?? null)}
      filings={cik === undefined ? [] : (filings.data ?? null)}
      estimate={estimate}
      thesis={p.thesis}
      calendar={p.calendar}
      dividends={divs.data ?? null}
    />
  );
}

export function TechnicalsSection({ data }: { data: StudyData }) {
  return <TechnicalsView bars={data.bars} />;
}

export function DividendsResearch({ data }: { data: StudyData }) {
  const rq = useCompanyResearch(data.ticker);
  const facts = useFacts(data.company?.cik);
  const divs = useDividendHistory(data.ticker);
  const p = parts(rq.data);
  return (
    <DividendsView
      ticker={data.ticker}
      bars={data.bars}
      dividends={divs.data ?? null}
      dividendsError={
        divs.isError ? t.study.panelError(R.views.dividends, divs.error.message) : null
      }
      facts={facts.data ?? null}
      profile={p.profile}
      analyst={p.analyst}
    />
  );
}

export function OwnershipResearch({ ticker }: { ticker: string }) {
  const rq = useCompanyResearch(ticker);
  return <OwnershipBar profile={parts(rq.data).profile} />;
}

export function NewsResearch({ data }: { data: StudyData }) {
  return <NewsView ticker={data.ticker} bars={data.bars} />;
}

/** The analyst targets for the chart's dashed lines, when the research row has them. */
export function useAnalystTargets(ticker: string) {
  const rq = useCompanyResearch(ticker);
  return parts(rq.data).analyst;
}

export type { ChartMarker };
