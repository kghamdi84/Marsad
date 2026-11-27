import { BREADTH_VERSION, UNIVERSE_VERSION, breadthReading } from '@marsad/core';
import { Info } from '../Info';
import { Card, Details } from '../Card';
import { fixed, signedFixed, width } from './format';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const b = r.breadth;

/** Marsad universe breadth: above the 50- and 200-day averages, highs and lows, advancers and decliners. */
export function Breadth({ data }: { data: RegimeData }) {
  const last = data.breadth.at(-1);
  if (!last)
    return (
      <Card id="breadth" title={b.title} subtitle={b.intro}>
        <p className="text-sm text-ink3">{b.none}</p>
      </Card>
    );
  const now = breadthReading(last);
  const monthAgoDay = data.breadth.at(-22);
  const before = monthAgoDay ? breadthReading(monthAgoDay) : null;
  const lastThrust = [...data.breadth].reverse().find((d) => d.zweigThrust);
  const pctText = (v: number | null) => (v === null ? r.noData : `${fixed(v, 1)}%`);
  const bar = (label: string, value: number | null, prior: number | null, n: number) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-ink2">{label}</span>
        <span className="font-semibold text-ink">{pctText(value)}</span>
      </div>
      <div aria-hidden="true" className="relative h-2 rounded bg-sub">
        <span
          className="absolute inset-y-0 start-0 rounded bg-up"
          style={{ width: width((value ?? 0) / 100) }}
        />
        {prior !== null && (
          <span
            className="absolute -top-1 -bottom-1 w-0.5 bg-ink"
            style={{ insetInlineStart: width(prior / 100) }}
          />
        )}
      </div>
      <span className="text-xs text-ink3">
        {b.outOf(n)}
        {prior !== null ? `; ${b.monthAgo(pctText(prior))}` : ''}
      </span>
    </div>
  );
  return (
    <Card id="breadth" title={b.title} subtitle={b.asOf(last.date, last.members)}>
      {bar(b.above50, now.pctAbove50, before?.pctAbove50 ?? null, last.n50)}
      {bar(b.above200, now.pctAbove200, before?.pctAbove200 ?? null, last.n200)}
      <dl className="grid grid-cols-2 gap-2.5 text-sm">
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev p-3">
          <dt className="text-xs text-ink3">{b.netHighs}</dt>
          <dd className="text-lg font-semibold text-ink">{signedFixed(now.netNewHighs, 0)}</dd>
          <dd className="text-xs text-ink3">{b.highsLows(last.newHighs, last.newLows)}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev p-3">
          <dt className="text-xs text-ink3">{b.advDec}</dt>
          <dd className="text-lg font-semibold text-ink">
            {b.advDecValue(last.advancers, last.decliners)}
          </dd>
          <dd className="text-xs text-ink3">
            {b.upVolume}: {pctText(now.upVolumePct)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-ink3">{b.tickNote}</p>
      {last.suspect > 0 && <p className="text-sm text-ink3">{b.suspect(last.suspect)}</p>}
      <Details>
        <Info>{b.intro}</Info>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink3">{b.avg10}</dt>
            <dd className="font-medium">
              {last.advanceAvg10 === null ? r.noData : fixed(last.advanceAvg10, 3)}
            </dd>
          </div>
          <div>
            <dt className="text-ink3">{b.mcclellan}</dt>
            <dd className="font-medium">
              {last.mcclellanOscillator === null
                ? r.noData
                : `${signedFixed(last.mcclellanOscillator, 3)} (${last.mcclellanSummation === null ? '' : signedFixed(last.mcclellanSummation, 2)})`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink3">{b.zweig}</dt>
            <dd className="font-medium">
              {lastThrust ? b.zweigLast(lastThrust.date) : b.zweigNone}
            </dd>
            <dd className="text-xs text-ink3">{b.zweigRule}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink3">{b.highsLowsOutOf(last.n252)}</p>
        <Info>
          <p>{b.warmup}</p>
          <p>{b.source(`${UNIVERSE_VERSION}, ${BREADTH_VERSION}`)}</p>
        </Info>
      </Details>
    </Card>
  );
}
