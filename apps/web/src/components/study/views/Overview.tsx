/**
 * One Study view, loaded as its own chunk the first time it is opened (ADR 0048: lazy chunks per Study view).
 * StudyCompany renders it behind the view tabs; this module holds only what the view shows.
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { AutoGrid } from '../../ui/kit';
import type { StudyData } from '../../../lib/study';
import { t } from '../../../strings';
import { Business } from '../Business';
import { HeldPosition } from '../HeldPosition';
import { panelTitle, tileClass } from '../Panel';
import { ThesisCard } from '../ThesisCard';
import { AiView } from '../research/Analysts';
import { KeyStats, VendorBusiness, VsSpy } from '../research/Overview';
import { PeersView } from '../research/Peers';
import {
  ResearchStatus,
  parts,
  useCompanyResearch,
  useDividendHistory,
  useFacts,
  useSpyBars,
} from '../research/Research';

/** Overview facts: the vendor business text, key statistics (with Marsad's own figures), the stock vs SPY, peers. */
function OverviewFacts({ data }: { data: StudyData }) {
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
function OverviewOpinion({ ticker }: { ticker: string }) {
  const rq = useCompanyResearch(ticker);
  return <AiView thesis={parts(rq.data).thesis} />;
}

/** Overview: the company brief first, then the facts, the thesis and position, the labelled opinion. */
export function StudyOverview({ data, brief }: { data: StudyData; brief: ReactNode }) {
  const cik = data.company?.cik;
  return (
    <>
      {brief}
      <OverviewFacts data={data} />
      {cik && <Business cik={cik} />}
      <AutoGrid min={320} gap="gap-4">
        <ThesisCard ticker={data.ticker} />
        <HeldPosition ticker={data.ticker} />
      </AutoGrid>
      <OverviewOpinion ticker={data.ticker} />
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
}
