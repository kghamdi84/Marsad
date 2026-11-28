import { useNavigate } from '@tanstack/react-router';
import { OptionPositions } from '../journal/OptionPositions';
import { Positions } from '../journal/Positions';
import { AnalysisView } from './AnalysisView';
import { HoldingsTable } from './HoldingsTable';
import { IncomeView } from './IncomeView';
import { NewsView } from './NewsView';
import { PerformanceView } from './PerformanceView';
import { ReviewView } from './ReviewView';
import { ExposurePanel } from './Summary';

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

/**
 * One view by key. Each view loads its own data. Holdings carries the position cards (exit rules, edits and the
 * Sahm CSV import) and the options positions; Analysis carries exposure and the ETF look-through, all moved from
 * Journal (ADR 0048: Journal keeps what Khaled did, Portfolio what he holds).
 */
export function PortfolioView({ view }: { view: PortfolioViewKey }) {
  const navigate = useNavigate();
  if (view === 'review') return <ReviewView />;
  if (view === 'holdings')
    return (
      <div className="flex flex-col gap-5">
        <HoldingsTable />
        <Positions onTrade={() => void navigate({ to: '/journal', search: { view: 'sizer' } })} />
        <OptionPositions />
      </div>
    );
  if (view === 'analysis')
    return (
      <div className="flex flex-col gap-5">
        <AnalysisView />
        <ExposurePanel />
      </div>
    );
  if (view === 'performance') return <PerformanceView />;
  if (view === 'income') return <IncomeView />;
  return <NewsView />;
}
