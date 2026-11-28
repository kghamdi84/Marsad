/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import { Segmented, useRemembered } from '../../Card';
import type { StudyData } from '../../../lib/study';
import { t } from '../../../strings';
import { AiFilingSummary } from '../AiSummary';
import { FilingsCard } from '../FilingsCard';
import { QuarterlyRiskFactors } from '../QuarterlyRiskFactors';
import { RiskFactors } from '../RiskFactors';

const ui = t.study.ui;
const RISK_MODES = ['yoy', 'qoq'] as const;

/** The AI filing summary, then the filings with the risk factors, year over year (10-K) or quarter over quarter (10-Q). */
export function StudyFilings({ data }: { data: StudyData }) {
  const [riskMode, setRiskMode] = useRemembered('marsad.study.risk', RISK_MODES, 'yoy');
  const cik = data.company?.cik;
  return (
    <>
      <AiFilingSummary ticker={data.ticker} />
      <FilingsCard data={data} />
      <Segmented
        label={ui.riskToggle}
        options={RISK_MODES.map((m) => ({ key: m, label: ui.riskModes[m] ?? m }))}
        value={riskMode}
        onChange={setRiskMode}
      />
      {cik && (riskMode === 'yoy' ? <RiskFactors cik={cik} /> : <QuarterlyRiskFactors cik={cik} />)}
      {!cik && <p className="text-sm text-ink3">{t.study.noCompany}</p>}
    </>
  );
}
