import { Segmented, useRemembered } from '../Card';
import { AnalysisView } from './AnalysisView';
import { HoldingsTable } from './HoldingsTable';
import { IncomeView } from './IncomeView';
import { NewsView } from './NewsView';
import { PerformanceView } from './PerformanceView';
import { ReviewView } from './ReviewView';
import { p } from './shared';

/** The views ADR 0048 gives the Portfolio page, in its order; Review first. */
export const PORTFOLIO_VIEWS = [
  'review',
  'holdings',
  'analysis',
  'performance',
  'income',
  'news',
] as const;
export type PortfolioViewKey = (typeof PORTFOLIO_VIEWS)[number];

/** One view by key. Each view loads its own data, so it can be placed on any page. */
export function PortfolioView({ view }: { view: PortfolioViewKey }) {
  if (view === 'review') return <ReviewView />;
  if (view === 'holdings') return <HoldingsTable />;
  if (view === 'analysis') return <AnalysisView />;
  if (view === 'performance') return <PerformanceView />;
  if (view === 'income') return <IncomeView />;
  return <NewsView />;
}

/**
 * The portfolio views behind one switch, the choice remembered. Today this sits in a Journal tab; the navigation
 * batch moves it to `/portfolio?view=` by rendering `PortfolioView` from the route.
 */
export function PortfolioViews() {
  const [view, setView] = useRemembered<PortfolioViewKey>(
    'marsad.portfolio.view',
    PORTFOLIO_VIEWS,
    'review',
  );
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={p.viewsLabel}
        options={PORTFOLIO_VIEWS.map((k) => ({ key: k, label: p.views[k] }))}
        value={view}
        onChange={setView}
      />
      <PortfolioView view={view} />
    </div>
  );
}
