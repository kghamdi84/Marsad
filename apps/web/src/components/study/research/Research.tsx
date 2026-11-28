/**
 * Study's research sections (ADR 0048). Each section is self-contained: it takes the page's StudyData and reads
 * what else it needs through the shared hooks below (one cache entry per source), so it can move to another page
 * by changing a few lines where it is placed.
 */
import { useQuery } from '@tanstack/react-query';
import type { ChartMarker } from '@marsad/core';
import { Num } from '../../ui/kit';
import type { StudyData } from '../../../lib/study';
import {
  loadCompanyResearch,
  loadDividendHistory,
  type CompanyResearch,
} from '../../../lib/research';
import { loadFacts, loadRecentDailyBars } from '../../../lib/studyPanels';
import { t } from '../../../strings';
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

/** The four research parts of a row, each "not stored" when the row is missing. */
export function parts(row: CompanyResearch | null | undefined) {
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

/** The analyst targets for the chart's dashed lines, when the research row has them. */
export function useAnalystTargets(ticker: string) {
  const rq = useCompanyResearch(ticker);
  return parts(rq.data).analyst;
}

export type { ChartMarker };
