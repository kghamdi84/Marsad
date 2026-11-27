import { useQuery } from '@tanstack/react-query';
import { seriesDifference } from '@marsad/core';
import { Info } from '../components/Info';
import { SkeletonCards, cardClass } from '../components/Card';
import { AutoGrid, PageTitle } from '../components/ui/kit';
import { Breadth } from '../components/regime/Breadth';
import { Capitulation } from '../components/regime/Capitulation';
import { EventStudy } from '../components/regime/EventStudy';
import { FearGreed } from '../components/regime/FearGreed';
import { Geopolitics } from '../components/regime/Geopolitics';
import { Hero } from '../components/regime/Hero';
import { MeasuresCard } from '../components/regime/Measures';
import { QualityScreen } from '../components/regime/QualityScreen';
import { Recession } from '../components/regime/Recession';
import { Rotation } from '../components/regime/Rotation';
import { loadRegime } from '../lib/regime';
import { t } from '../strings';

const r = t.regime;

/**
 * Market regime (Marsad v2): the label and why, what the S&P did next, the recession filter, Fear and Greed, the
 * capitulation watch, sector rotation and geopolitics; then breadth, the quality screen and the measures behind
 * them. One column under 760 px, paired cards from there.
 */
export function Regime() {
  const q = useQuery({ queryKey: ['regime'], queryFn: loadRegime });
  const v = r.volatility;
  const c = r.credit;
  const un = r.uncertainty;
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <PageTitle page="regime" />
        <Info>{r.intro}</Info>
      </div>
      {q.isPending && <SkeletonCards />}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {d && (
        <>
          <Hero data={d} />
          <EventStudy data={d} />
          <AutoGrid min={380} gap="gap-5" className="items-start">
            <Recession data={d} />
            <FearGreed data={d} />
          </AutoGrid>
          <AutoGrid min={380} gap="gap-5" className="items-start">
            <Capitulation data={d} />
            <Rotation data={d} />
          </AutoGrid>
          <Geopolitics data={d} />
          <AutoGrid min={380} gap="gap-5" className="items-start">
            <Breadth data={d} />
            <div className={cardClass}>
              <QualityScreen capitulationOn={d.capitulation.latest?.state === 'on'} />
            </div>
          </AutoGrid>
          <h2 className="pt-1 text-base font-semibold text-ink">{r.ui.moreMeasures}</h2>
          <AutoGrid min={380} gap="gap-5" className="items-start">
            <MeasuresCard
              id="volatility"
              title={v.title}
              rows={[
                { label: v.vix, obs: d.series['VIXCLS'] ?? [] },
                { label: v.vix3m, obs: d.series['VXVCLS'] ?? [] },
              ]}
              notes={[`${v.contango} ${v.backwardation}`, v.source]}
            />
            <MeasuresCard
              id="uncertainty"
              title={un.title}
              rows={[
                { label: un.gpr, obs: d.gpr, digits: 1 },
                { label: un.epu, obs: d.series['USEPUINDXD'] ?? [], digits: 1 },
              ]}
              notes={[un.source]}
            />
          </AutoGrid>
          <MeasuresCard
            id="credit"
            title={c.title}
            rows={[
              { label: c.hy, obs: d.series['BAMLH0A0HYM2'] ?? [] },
              { label: c.ig, obs: d.series['BAMLC0A0CM'] ?? [] },
              {
                label: c.hyIg,
                obs: seriesDifference(d.series['BAMLH0A0HYM2'] ?? [], d.series['BAMLC0A0CM'] ?? []),
              },
              { label: c.dgs10, obs: d.series['DGS10'] ?? [] },
              { label: c.curve3m, obs: d.series['T10Y3M'] ?? [] },
              { label: c.curve2y, obs: d.series['T10Y2Y'] ?? [] },
            ]}
            notes={[c.source]}
          />
        </>
      )}
    </div>
  );
}
