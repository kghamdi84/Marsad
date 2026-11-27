import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { seriesDifference } from '@marsad/core';
import { Info } from '../components/Info';
import { Segmented, SkeletonCards, cardClass, useRemembered } from '../components/Card';
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
import {
  AREA_ID,
  CONTEXT_VIEWS,
  HEADING_ID,
  RISK_VIEWS,
  WHY_ID,
  type Target,
} from '../components/regime/areas';
import { loadRegime, type RegimeData } from '../lib/regime';
import { t } from '../strings';

const r = t.regime;
const sw = r.ui.switch;

/** Move focus to a summary row's target after the view has rendered, without a second scroll. */
function focusTarget(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/** Volatility, uncertainty and credit with the date and 1-year percentile of each series. */
function Measures({ d }: { d: RegimeData }) {
  const v = r.volatility;
  const c = r.credit;
  const un = r.uncertainty;
  return (
    <div className="flex flex-col gap-5">
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
    </div>
  );
}

/** A switchable area: its name, the switch, then the one chosen view. */
function Area<K extends string>({
  id,
  label,
  views,
  names,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  views: readonly K[];
  names: Record<K, string>;
  value: K;
  onChange: (k: K) => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-20 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold text-ink3">{label}</h2>
        <Segmented
          label={label}
          options={views.map((key) => ({ key, label: names[key] }))}
          value={value}
          onChange={onChange}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * Market regime (Marsad v2, squeezed): one summary card first (the label and its run, the recession filter, Fear
 * and Greed, the capitulation watch, the leading and lagging sector, GPR and EPU), with the past-year ribbon and
 * "Why this label"; then two switchable areas. Risk gauges: the recession filter, Fear and Greed, the capitulation
 * watch with its plan, and breadth. Context: what the S&P did next, sector rotation, geopolitics, the quality
 * screen and the measures behind them. Nothing is dropped; each view is one tap away and the choice is remembered.
 */
export function Regime() {
  const q = useQuery({ queryKey: ['regime'], queryFn: loadRegime });
  const [risk, setRisk] = useRemembered('marsad.regime.risk', RISK_VIEWS, 'recession');
  const [context, setContext] = useRemembered('marsad.regime.context', CONTEXT_VIEWS, 'study');
  // A summary row's jump: switch the area's view, then scroll to the area and focus the card once it renders.
  const [jump, setJump] = useState<{ scroll: string; focus: string; n: number } | null>(null);
  useEffect(() => {
    if (!jump) return;
    document.getElementById(jump.scroll)?.scrollIntoView({ block: 'start' });
    focusTarget(jump.focus);
  }, [jump]);
  const go = (to: Target) => {
    const n = (jump?.n ?? 0) + 1;
    if (to.area === 'why') {
      setJump({ scroll: WHY_ID, focus: WHY_ID, n });
      return;
    }
    if (to.area === 'risk') setRisk(to.view);
    else setContext(to.view);
    setJump({ scroll: AREA_ID[to.area], focus: HEADING_ID[to.view], n });
  };
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
          <Hero data={d} go={go} />
          <Area
            id={AREA_ID.risk}
            label={sw.riskLabel}
            views={RISK_VIEWS}
            names={sw.risk}
            value={risk}
            onChange={setRisk}
          >
            {risk === 'recession' && <Recession data={d} />}
            {risk === 'fearGreed' && <FearGreed data={d} />}
            {risk === 'capitulation' && <Capitulation data={d} />}
            {risk === 'breadth' && <Breadth data={d} />}
          </Area>
          <Area
            id={AREA_ID.context}
            label={sw.contextLabel}
            views={CONTEXT_VIEWS}
            names={sw.context}
            value={context}
            onChange={setContext}
          >
            {context === 'study' && <EventStudy data={d} />}
            {context === 'rotation' && <Rotation data={d} />}
            {context === 'geopolitics' && <Geopolitics data={d} />}
            {context === 'quality' && (
              <div className={cardClass}>
                <QualityScreen capitulationOn={d.capitulation.latest?.state === 'on'} />
              </div>
            )}
            {context === 'measures' && <Measures d={d} />}
          </Area>
        </>
      )}
    </div>
  );
}
