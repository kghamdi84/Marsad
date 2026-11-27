import { useMemo } from 'react';
import { REGIME_THRESHOLDS, currentRun, seriesSnapshot, type RegimeInputs } from '@marsad/core';
import { Info } from '../Info';
import { Pill, type Tone } from '../ui/kit';
import { CheckRow } from './CheckRow';
import { LABEL_COLOR, LABEL_ORDER, fixed, pct } from './format';
import { dayMonth, dayMonthYear, monthYear, weekdayDayMonth } from '../../lib/dates';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const w = u.why;

/** Consecutive sessions with the same label, oldest first. */
function runsOf(days: RegimeData['days']): { label: string; n: number; from: string }[] {
  const out: { label: string; n: number; from: string }[] = [];
  for (const d of days) {
    const lastRun = out.at(-1);
    if (lastRun && lastRun.label === d.label) lastRun.n += 1;
    else out.push({ label: d.label, n: 1, from: d.date });
  }
  return out;
}

interface Why {
  key: string;
  text: string;
  met: boolean | null;
  /** The stress check is bad news when met; the four bull calm conditions are good news. */
  stress?: boolean;
}

/**
 * "Why this label" from the stored regime-1 inputs: the four bull calm conditions and the stress check, each met
 * or not, exactly as `classifyRegime` tests them. There is no numeric score.
 */
function whyRows(x: RegimeInputs): Why[] {
  const T = REGIME_THRESHOLDS;
  const nd = r.noData;
  const has = (...v: (number | null)[]) => v.every((k) => k !== null);
  const stressMet =
    x.vix === null
      ? null
      : x.vix >= T.stressVix ||
        (x.vix3m !== null && x.sma50 !== null && x.vix >= x.vix3m && x.sp500 < x.sma50);
  return [
    {
      key: 'above50',
      text: w.above50(x.sma50 === null ? nd : fixed(x.sma50)),
      met: has(x.sma50) ? x.sp500 > (x.sma50 as number) : null,
    },
    {
      key: 'above200',
      text: w.above200(x.sma200 === null ? nd : fixed(x.sma200)),
      met: has(x.sma200) ? x.sp500 > (x.sma200 as number) : null,
    },
    {
      key: 'nearHigh',
      text: w.nearHigh(
        `${fixed(-T.calmDrawdown * 100, 0)}%`,
        x.drawdown === null ? nd : pct(x.drawdown),
      ),
      met: x.drawdown === null ? null : x.drawdown > T.calmDrawdown,
    },
    {
      key: 'vixCalm',
      text: w.vixCalm(String(T.calmVix), x.vix === null ? nd : fixed(x.vix)),
      met: x.vix === null ? null : x.vix < T.calmVix,
    },
    {
      key: 'stress',
      text: w.stress(
        String(T.stressVix),
        x.vix === null ? nd : fixed(x.vix),
        x.vix3m === null ? nd : fixed(x.vix3m),
      ),
      met: stressMet,
      stress: true,
    },
  ];
}

function pillOf(x: Why): { text: string; tone: Tone } {
  if (x.met === null) return { text: w.noData, tone: 'neutral' };
  if (!x.met) return { text: w.notMet, tone: 'neutral' };
  return { text: w.met, tone: x.stress ? 'warn' : 'up' };
}

/** GPR and EPU as one context line under the label (their 1-year percentiles). */
function ContextLine({ data }: { data: RegimeData }) {
  const gpr = seriesSnapshot(data.gpr);
  const epu = seriesSnapshot(data.series['USEPUINDXD'] ?? []);
  if (!gpr || !epu) return null;
  return (
    <p className="text-xs text-ink3">
      {r.context(r.ordinal(Math.round(gpr.percentile)), r.ordinal(Math.round(epu.percentile)))}
    </p>
  );
}

/** The label, how long it has run, the past-year ribbon and "Why this label". */
export function Hero({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  const run = currentRun(data.days);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of data.days) c[d.label] = (c[d.label] ?? 0) + 1;
    return c;
  }, [data.days]);
  const runs = useMemo(() => runsOf(data.days), [data.days]);
  if (!last || !run)
    return (
      <section
        aria-labelledby="regime-label"
        className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-[18px] py-4"
      >
        <h2 id="regime-label" className="text-base font-semibold text-ink">
          {r.labelTitle}
        </h2>
        <p className="text-sm text-ink3">{r.none}</p>
      </section>
    );
  const name = (k: string) => r.labels[k] ?? k;
  const summary = LABEL_ORDER.filter((k) => counts[k])
    .map((k) => `${name(k)} ${counts[k]}`)
    .join(', ');
  const since =
    run.since.slice(0, 4) === last.date.slice(0, 4) ? dayMonth(run.since) : dayMonthYear(run.since);
  return (
    <section
      aria-labelledby="regime-label"
      className="grid gap-5 rounded-xl border border-line bg-surface p-[18px]"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}
    >
      <h2 id="regime-label" className="sr-only">
        {r.labelTitle}
      </h2>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill className="px-2.5 py-1">
            {u.heroChip(last.ruleVersion, weekdayDayMonth(last.date))}
          </Pill>
          <Pill className="px-2.5 py-1">{u.delayedEod}</Pill>
        </div>
        <p className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-3.5 flex-none rounded"
            style={{ background: LABEL_COLOR[last.label] }}
          />
          <span className="text-[34px] leading-tight font-semibold text-ink">
            {name(last.label)}
          </span>
        </p>
        <p className="text-sm text-ink2">{u.running(run.sessions, since)}</p>
        <p className="text-sm text-ink2">{r.reasons[last.reason] ?? last.reason}</p>
        <p className="sr-only">{r.asOf(last.date, last.ruleVersion)}</p>
        <div className="mt-1 flex flex-col gap-1">
          <div
            role="img"
            aria-label={u.ribbonAria(summary)}
            className="flex h-4 overflow-hidden rounded"
          >
            {runs.map((x) => (
              <span
                key={x.from}
                title={`${name(x.label)}, ${x.n} from ${x.from}`}
                style={{ flex: x.n, background: LABEL_COLOR[x.label] }}
              />
            ))}
          </div>
          <div className="flex justify-between gap-2 text-xs text-ink3">
            <span>{data.days[0] ? monthYear(data.days[0].date) : ''}</span>
            <span>{u.ribbonPast(data.days.length)}</span>
            <span>{u.ribbonNow}</span>
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-2.5 gap-y-1">
          {LABEL_ORDER.map((k) => (
            <li key={k} className="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink2">
              <span
                aria-hidden="true"
                className="size-[9px] rounded-[2px]"
                style={{ background: LABEL_COLOR[k] }}
              />
              {name(k)} <span className="text-ink3">{counts[k] ?? 0}</span>
            </li>
          ))}
        </ul>
        <ContextLine data={data} />
        <Info>
          <p>{r.inputsSource}</p>
          <p>{w.rule}</p>
        </Info>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{w.title}</h3>
          <span className="text-xs text-ink3">{w.spClose(fixed(last.inputs.sp500))}</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {whyRows(last.inputs).map((x) => {
            const p = pillOf(x);
            return <CheckRow key={x.key} text={x.text} pill={p.text} tone={p.tone} />;
          })}
        </ul>
      </div>
    </section>
  );
}
