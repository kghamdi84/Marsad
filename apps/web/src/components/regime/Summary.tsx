import type { ReactNode } from 'react';
import { currentRun, seriesSnapshot } from '@marsad/core';
import { toneText } from './FearGreed';
import { useRotation } from './Rotation';
import { LABEL_COLOR, arrowPct, toneClass } from './format';
import type { Target } from './areas';
import { dayMonth, dayMonthYear } from '../../lib/dates';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const m = u.summary;

const LEVEL_TEXT: Record<string, string> = {
  low: 'text-up',
  elevated: 'text-warn',
  high: 'text-crit',
  unavailable: 'text-ink3',
};

/**
 * One summary row (squeezed v2 Regime): the gauge on the start side, the answer and its context on one line. The
 * whole row is a button that opens the gauge's detail below; its words carry the meaning, colour never alone.
 */
function Row({
  label,
  value,
  sub,
  onGo,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onGo: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onGo}
        className="grid min-h-11 w-full min-w-0 grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-2 py-2 text-start text-ink hover:bg-elev"
      >
        <span className="pt-0.5 text-xs text-ink3">{label}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] leading-snug font-semibold">{value}</span>
          {sub && <span className="text-xs text-ink3">{sub}</span>}
        </span>
      </button>
    </li>
  );
}

/** A signed return with its arrow, isolated left to right so the sign stays with the number. */
const Ret = ({ v }: { v: number }) => (
  <span dir="ltr" className={`[unicode-bidi:isolate] ${toneClass(v)}`}>
    {arrowPct(v)}
  </span>
);

/**
 * What matters now, in six rows: the label and its run, the recession filter, Fear and Greed, the capitulation
 * watch, the leading and lagging sector against SPY, and the GPR and EPU percentiles. Each value comes from the
 * same stored rows and core functions as its card; a missing input reads "Data unavailable".
 */
export function SummaryRows({ data, go }: { data: RegimeData; go: (to: Target) => void }) {
  const last = data.days.at(-1);
  const run = currentRun(data.days);
  const { rot, rows } = useRotation(data);
  if (!last || !run) return null;
  const name = (k: string) => r.labels[k] ?? k;
  const since =
    run.since.slice(0, 4) === last.date.slice(0, 4) ? dayMonth(run.since) : dayMonthYear(run.since);
  /** A date note only when a gauge's close is not the label's. */
  const otherDay = (date: string) => (date === last.date ? '' : ` · ${m.closeOf(dayMonth(date))}`);

  const fg = data.fearGreed.filter((d) => d.composite !== null).at(-1);
  const fgValue = fg?.composite == null ? null : Math.round(fg.composite);

  const cap = data.capitulation.latest;
  const capMet = cap ? cap.conditions.filter((c) => c.met === true).length : 0;
  const planOn = data.capitulation.plan !== null && !data.capitulation.plan.expired;

  const ranked = rows.filter((x) => x.m1 !== null);
  const lead = ranked[0];
  const lag = ranked.length > 1 ? ranked.at(-1) : undefined;

  const gpr = seriesSnapshot(data.gpr);
  const epu = seriesSnapshot(data.series['USEPUINDXD'] ?? []);
  const idx = [gpr ? { name: 'GPR', s: gpr } : null, epu ? { name: 'EPU', s: epu } : null].filter(
    (x) => x !== null,
  );
  const dates = [...new Set(idx.map((x) => x.s.date))];
  const geoSub = [
    m.pastYear(
      dates.length === 1 ? (dates[0] ?? '') : idx.map((x) => `${x.name} ${x.s.date}`).join(', '),
    ),
    ...idx.filter((x) => x.s.n < 252).map((x) => m.fewDays(x.name, x.s.n)),
  ].join(' · ');

  return (
    <ul aria-label={m.rowsLabel} className="-mx-2 flex flex-col">
      <Row
        label={m.regime}
        value={
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 flex-none rounded-[3px]"
              style={{ background: LABEL_COLOR[last.label] }}
            />
            <span>{name(last.label)}</span>
          </span>
        }
        sub={u.running(run.sessions, since)}
        onGo={() => go({ area: 'why' })}
      />
      <Row
        label={m.recession}
        value={
          <span className={LEVEL_TEXT[last.recessionLevel] ?? 'text-ink'}>
            {r.recession.level[last.recessionLevel] ?? last.recessionLevel}
          </span>
        }
        sub={m.signalsOn(last.triggered, last.available)}
        onGo={() => go({ area: 'risk', view: 'recession' })}
      />
      <Row
        label={m.fearGreed}
        value={
          fg && fgValue !== null ? (
            <>
              <span className="tabular-nums">{fgValue}</span>{' '}
              <span className={toneText(fgValue)}>{r.fearGreed.labels[fg.label ?? ''] ?? ''}</span>
            </>
          ) : (
            <span className="text-ink3">{m.unavailable}</span>
          )
        }
        sub={fg ? `${m.fgComponents(fg.available)}${otherDay(fg.date)}` : m.fgNone}
        onGo={() => go({ area: 'risk', view: 'fearGreed' })}
      />
      <Row
        label={m.capitulation}
        value={
          cap ? (
            <span className={cap.state === 'on' ? 'text-warn' : 'text-ink'}>
              {r.capitulation.state[cap.state]}
            </span>
          ) : (
            <span className="text-ink3">{m.unavailable}</span>
          )
        }
        sub={
          cap
            ? `${m.capMet(capMet)}${planOn ? ` · ${m.capPlan}` : ''}${otherDay(cap.date)}`
            : m.capNone
        }
        onGo={() => go({ area: 'risk', view: 'capitulation' })}
      />
      <Row
        label={m.sectors}
        value={
          lead?.m1 != null && lag?.m1 != null ? (
            <span className="flex flex-wrap gap-x-2">
              <span>
                {lead.ticker} <Ret v={lead.m1} />
              </span>
              <span aria-hidden="true" className="text-ink3">
                ·
              </span>
              <span>
                {lag.ticker} <Ret v={lag.m1} />
              </span>
            </span>
          ) : (
            <span className="text-ink3">{m.unavailable}</span>
          )
        }
        sub={
          lead && lag && rot.asOf
            ? m.sectorSub(
                r.rotation.names[lead.ticker] ?? lead.ticker,
                r.rotation.names[lag.ticker] ?? lag.ticker,
                dayMonth(rot.asOf),
              )
            : m.sectorNone
        }
        onGo={() => go({ area: 'context', view: 'rotation' })}
      />
      <Row
        label={m.geopolitics}
        value={
          idx.length > 0 ? (
            m.percentiles(
              idx.map((x) => `${x.name} ${r.ordinal(Math.round(x.s.percentile))}`).join(', '),
            )
          ) : (
            <span className="text-ink3">{m.unavailable}</span>
          )
        }
        sub={idx.length > 0 ? geoSub : undefined}
        onGo={() => go({ area: 'context', view: 'geopolitics' })}
      />
    </ul>
  );
}
