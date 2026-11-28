import { Segmented } from '../components/Card';
import { Info } from '../components/Info';
import { PageTitle } from '../components/ui/kit';
import { PORTFOLIO_VIEWS, PortfolioView } from '../components/portfolio/PortfolioViews';
import { PortfolioSummary } from '../components/portfolio/Summary';
import { useView } from '../lib/view';
import { t } from '../strings';

const p = t.portfolio;

/**
 * Portfolio (ADR 0048, taken out of Journal): the summary tiles first, then one view at a time behind one switch,
 * opening on Review (exit conditions, open risk against Khaled's limits, holdings with no exit rule first). The
 * view is in the URL (`?view=`), so a brief or an alert can link straight to it; the device remembers the last one.
 */
export function Portfolio() {
  const [view, setView] = useView('marsad.portfolio.view', PORTFOLIO_VIEWS, 'review');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="portfolio" aside={<Info>{p.pageIntro}</Info>} />
      <PortfolioSummary />
      <div className="flex flex-col gap-3">
        <Segmented
          label={p.viewsLabel}
          options={PORTFOLIO_VIEWS.map((k) => ({ key: k, label: p.views[k] }))}
          value={view}
          onChange={setView}
        />
        <PortfolioView view={view} />
      </div>
    </div>
  );
}
