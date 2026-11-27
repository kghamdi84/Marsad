import { useMemo, useState } from 'react';
import { Info } from '../components/Info';
import { useQuery } from '@tanstack/react-query';
import {
  BREADTH_VERSION,
  CAPITULATION_RULES,
  COMPONENT_SOURCES,
  RECESSION_THRESHOLDS,
  topicSummary,
  type ComponentKey,
  type Topic,
  type Condition,
  UNIVERSE_VERSION,
  breadthReading,
  currentRun,
  seriesDifference,
  seriesSnapshot,
  toFixedHalfUp,
  type Obs,
  type RecessionSignal,
} from '@marsad/core';
import { num, td, th, thNum } from '../components/study/Panel';
import {
  loadRegime,
  type RegimeData,
  type StoredEventStat,
  type StoredFearGreedDay,
} from '../lib/regime';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { monthYear, weekdayDayMonth } from '../lib/dates';
import { Card, Details, SkeletonCards, cardClass, useWide } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { QualityScreen } from '../components/regime/QualityScreen';
import { t } from '../strings';

const r = t.regime;
const u = r.ui;
const fixed = (v: number, d = 2) => toFixedHalfUp(v, d);
const signed = (v: number, d = 2) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v, d)}`;
const pct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, d)}%`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const width = (v: number) => `${toFixedHalfUp(clamp01(v) * 100, 1)}%`;

/** Regime colors: each label also has its name beside it, so color is never the only signal. */
const LABEL_COLOR: Record<string, string> = {
  stress: 'var(--color-alarm)',
  bear: 'var(--color-down)',
  recovery: 'var(--color-warn)',
  'bull-correction': 'var(--color-muted)',
  'bull-calm': 'var(--color-up)',
  'insufficient-data': 'rgba(138, 153, 178, 0.35)',
};
const LABEL_ORDER = ['stress', 'bear', 'recovery', 'bull-correction', 'bull-calm'];

function SnapshotTable({ rows }: { rows: { label: string; obs: Obs[]; digits?: number }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{r.colMeasure}</th>
            <th className={thNum}>{r.colLatest}</th>
            <th className={thNum}>{r.colChange}</th>
            <th className={thNum}>{r.colPercentile}</th>
            <th className={th}>{r.colAsOf}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, obs, digits = 2 }) => {
            const s = seriesSnapshot(obs);
            return (
              <tr key={label}>
                <td className={td}>{label}</td>
                {s ? (
                  <>
                    <td className={`${td} ${num}`}>{fixed(s.value, digits)}</td>
                    <td className={`${td} ${num}`}>
                      {s.change === null ? '' : signed(s.change, digits)}
                    </td>
                    <td className={`${td} ${num}`}>
                      {fixed(s.percentile, 0)}
                      {s.n < 252 && <span className="block text-xs text-muted">{r.ofN(s.n)}</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{s.date}</td>
                  </>
                ) : (
                  <td className={`${td} text-muted`} colSpan={4}>
                    {r.noData}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** GPR and EPU as one context line under the label (their 1-year percentiles). */
function ContextLine({ data }: { data: RegimeData }) {
  const gpr = seriesSnapshot(data.gpr);
  const epu = seriesSnapshot(data.series['USEPUINDXD'] ?? []);
  if (!gpr || !epu) return null;
  return (
    <p className="text-sm text-fg">
      {r.context(r.ordinal(Math.round(gpr.percentile)), r.ordinal(Math.round(epu.percentile)))}
    </p>
  );
}

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

function Hero({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  const run = currentRun(data.days);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of data.days) c[d.label] = (c[d.label] ?? 0) + 1;
    return c;
  }, [data.days]);
  const runs = useMemo(() => runsOf(data.days), [data.days]);
  if (!last || !run) return <p className="text-muted">{r.none}</p>;
  const x = last.inputs;
  const name = (k: string) => r.labels[k] ?? k;
  const summary = LABEL_ORDER.filter((k) => counts[k])
    .map((k) => `${name(k)} ${counts[k]}`)
    .join(', ');
  const fromHigh = x.drawdown === null ? r.noData : pct(x.drawdown);
  return (
    <section
      aria-labelledby="label"
      className="flex flex-col gap-3.5 rounded-2xl bg-raised px-4 py-[18px] tablet:p-5"
    >
      <h2 id="label" className="sr-only">
        {r.labelTitle}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px] text-muted">
          {u.heroMeta(last.ruleVersion, weekdayDayMonth(last.date))}
        </span>
        <span className="rounded-sm bg-muted/15 px-2 py-[3px] text-xs font-semibold text-fg">
          {u.delayedEod}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-4 flex-none rounded"
          style={{ background: LABEL_COLOR[last.label] }}
        />
        <p className="text-4xl leading-[1.05] font-bold text-white">{name(last.label)}</p>
      </div>
      <p className="text-[15px] leading-[1.45] text-fg">{r.reasons[last.reason] ?? last.reason}</p>
      <p className="sr-only">{r.asOf(last.date, last.ruleVersion)}</p>
      <div className="grid grid-cols-3 gap-2 tablet:grid-cols-4">
        {[
          [u.runningTile, u.sessShort(run.sessions)],
          [u.fromHighTile, fromHigh],
          [r.inputs.vix, x.vix === null ? r.noData : fixed(x.vix)],
          [r.inputs.vix3m, x.vix3m === null ? r.noData : fixed(x.vix3m)],
        ].map(([k, v], i) => (
          <div
            key={k}
            className={`min-w-0 flex-col gap-0.5 rounded-[10px] bg-bg/50 p-2.5 ${i === 3 ? 'hidden tablet:flex' : 'flex'}`}
          >
            <span className="text-xs text-muted">{k}</span>
            <span className="text-lg font-bold text-white tabular-nums">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={u.ribbonAria(summary)}
          className="flex h-[22px] overflow-hidden rounded-md"
        >
          {runs.map((x2) => (
            <span
              key={x2.from}
              title={`${name(x2.label)}, ${x2.n} from ${x2.from}`}
              style={{ flex: x2.n, background: LABEL_COLOR[x2.label] }}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>{data.days[0] ? monthYear(data.days[0].date) : ''}</span>
          <span>{u.ribbonPast}</span>
          <span>{u.ribbonNow}</span>
        </div>
        <p className="sr-only">
          {r.pastYear} {u.sessions(data.days.length)} {u.running(run.sessions, run.since)}
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {LABEL_ORDER.map((k) => (
          <li
            key={k}
            className="flex items-center gap-1.5 rounded-full bg-bg/50 px-2.5 py-1 text-[13px] whitespace-nowrap"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ background: LABEL_COLOR[k] }}
            />
            {name(k)} <span className="text-muted">{counts[k] ?? 0}</span>
          </li>
        ))}
      </ul>
      <div className="hidden tablet:block">
        <ContextLine data={data} />
      </div>
      <Info>{r.inputsSource}</Info>
    </section>
  );
}

function signalValue(s: RecessionSignal): string {
  if (s.value === null) return '';
  const rec = r.recession;
  switch (s.id) {
    case 'curve':
      return `${fixed(s.value)} (${rec.curveDetail(s.detail['invertedSessions'] ?? 0)})`;
    case 'credit':
      return s.detail['change63'] === null || s.detail['change63'] === undefined
        ? fixed(s.value)
        : `${fixed(s.value)} (${rec.creditDetail(signed(s.detail['change63']))})`;
    case 'claims':
      return `${Math.round(s.value).toLocaleString('en-US')} (${rec.claimsDetail(
        Math.round(s.detail['low52w'] ?? 0).toLocaleString('en-US'),
      )})`;
    default:
      return fixed(s.value, s.id === 'nfci' ? 3 : 2);
  }
}

/** Short value for the bar row. */
function signalShort(s: RecessionSignal): string {
  if (s.value === null) return r.noData;
  if (s.id === 'claims') return Math.round(s.value).toLocaleString('en-US');
  return s.id === 'nfci' ? fixed(s.value, 3) : fixed(s.value);
}

/** How far each signal sits toward its trigger: fill and trigger tick, both as fractions of the bar. */
function signalBar(s: RecessionSignal): { fill: number; tick: number } {
  const T = RECESSION_THRESHOLDS;
  if (s.value === null) return { fill: 0, tick: 1 };
  switch (s.id) {
    case 'sahm':
      return { fill: s.value / T.sahm, tick: 1 };
    case 'curve':
      return {
        fill: (s.detail['invertedSessions'] ?? 0) / T.curveLookbackSessions,
        tick: T.curveInvertedSessions / T.curveLookbackSessions,
      };
    case 'credit':
      return { fill: s.value / T.hySpreadLevel, tick: 1 };
    case 'claims': {
      const low = s.detail['low52w'];
      const rise = low ? s.value / low - 1 : 0;
      return { fill: rise / (T.claimsRise - 1), tick: 1 };
    }
    case 'nfci':
      return { fill: (s.value + 1) / 2, tick: 0.5 };
    default:
      return { fill: 0, tick: 1 };
  }
}

function RecessionCard({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  if (!last) return null;
  const rec = r.recession;
  const level = last.recessionLevel;
  const levels = ['low', 'elevated', 'high'];
  const stateColor = (s: string) =>
    s === 'triggered'
      ? 'var(--color-down)'
      : s === 'clear'
        ? 'var(--color-up)'
        : 'var(--color-faint)';
  return (
    <Card
      id="recession"
      title={rec.title}
      subtitle={`${last.recessionVersion} · ${rec.summary(last.available, last.triggered)}`}
      aside={
        <p className="text-[26px] leading-none font-bold text-white">{rec.level[level] ?? level}</p>
      }
    >
      <div
        role="img"
        aria-label={u.levelAria(rec.level[level] ?? level)}
        className="grid grid-cols-[1fr_2fr_2fr] gap-[3px]"
      >
        {levels.map((l, i) => (
          <span
            key={l}
            className={`h-2 ${i === 0 ? 'rounded-s' : ''} ${i === 2 ? 'rounded-e' : ''}`}
            style={{
              background:
                l === level
                  ? ['var(--color-up)', 'var(--color-warn)', 'var(--color-alarm)'][i]
                  : 'rgba(138,153,178,0.25)',
            }}
          />
        ))}
        {u.levelScale.map((s, i) => (
          <span
            key={s}
            className={`text-[11px] ${levels[i] === level ? 'font-semibold text-white' : 'text-muted'}`}
          >
            {s}
          </span>
        ))}
      </div>
      <ul className="flex flex-col">
        {last.signals.map((s) => {
          const b = signalBar(s);
          return (
            <li
              key={s.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-line py-3"
            >
              <span className="text-[15px] font-semibold text-white">
                {rec.names[s.id] ?? s.id}
              </span>
              <span className="text-end text-base font-bold text-white">{signalShort(s)}</span>
              <span className="text-xs text-muted">{rec.rules[s.id] ?? ''}</span>
              <span
                className="flex items-center justify-self-end gap-1.5 text-xs"
                style={{ color: stateColor(s.state) }}
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: stateColor(s.state) }}
                />
                {rec.states[s.state] ?? s.state}
              </span>
              <div
                aria-hidden="true"
                className="relative col-span-2 mt-1 h-1.5 rounded-sm bg-faint/20"
              >
                <span
                  className="absolute inset-y-0 start-0 rounded-sm"
                  style={{ width: width(b.fill), background: stateColor(s.state) }}
                />
                <span
                  className="absolute -top-1 -bottom-1 w-0.5 bg-white"
                  style={{ insetInlineStart: width(Math.min(b.tick, 0.995)) }}
                />
              </div>
              <span className="col-span-2 text-[11px] text-faint">
                FRED {s.source}
                {s.asOf ? ` · ${s.asOf}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">{u.tickNote}</p>
      <Details>
        <p className="text-sm text-muted">{rec.rule}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{rec.colSignal}</th>
                <th className={th}>{rec.colState}</th>
                <th className={th}>{rec.colValue}</th>
                <th className={th}>{rec.colRule}</th>
                <th className={th}>{rec.colAsOf}</th>
              </tr>
            </thead>
            <tbody>
              {last.signals.map((s) => (
                <tr key={s.id}>
                  <td className={td}>
                    {rec.names[s.id] ?? s.id}
                    <span className="block text-xs text-muted">FRED {s.source}</span>
                  </td>
                  <td className={`${td} font-medium ${s.state === 'triggered' ? 'text-down' : ''}`}>
                    {rec.states[s.state] ?? s.state}
                  </td>
                  <td className={td}>{signalValue(s)}</td>
                  <td className={`${td} text-muted`}>{rec.rules[s.id] ?? ''}</td>
                  <td className={`${td} whitespace-nowrap`}>{s.asOf ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{rec.creditNote}</p>
      </Details>
    </Card>
  );
}

function conditionValue(c: Condition): string {
  if (c.value === null) return r.noData;
  if (c.key === 'recession') return r.recession.level[String(c.value)] ?? String(c.value);
  if (c.key === 'breadth') return `${fixed(Number(c.value), 1)}%`;
  if (c.key === 'composite') return fixed(Number(c.value), 1);
  return fixed(Number(c.value), 2);
}

const HORIZONS = [21, 63, 126];

function CapitulationCard({ data }: { data: RegimeData }) {
  const k = r.capitulation;
  const latest = data.capitulation.latest;
  const plan = data.capitulation.plan;
  const proxy = (h: number) =>
    data.stats.find((x) => x.condition === 'vix-30-recession-not-high' && x.horizon === h);
  const needs = (key: string) =>
    k.needs(
      key,
      CAPITULATION_RULES.vixMin,
      CAPITULATION_RULES.above50MaxPct,
      CAPITULATION_RULES.compositeMax,
    );
  if (!latest)
    return (
      <Card id="capitulation" title={k.title} subtitle={k.intro}>
        <p className="text-muted">{k.none}</p>
      </Card>
    );
  const on = latest.state === 'on';
  const met = latest.conditions.filter((c) => c.met === true).length;
  const showPlan = plan !== null && !plan.expired;
  return (
    <Card
      id="capitulation"
      title={k.title}
      subtitle={k.asOf(latest.date, latest.version)}
      className={on ? 'border-warn/60' : ''}
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <p
          data-testid="capitulation-state"
          className={`text-[30px] leading-none font-bold ${on ? 'text-warn' : 'text-white'}`}
        >
          {k.state[latest.state]}
        </p>
        <span className="text-[13px] text-muted">{u.metCount(met)}</span>
      </div>
      <p className="text-sm text-fg">
        {data.capitulation.lastOn ? k.lastOn(data.capitulation.lastOn) : k.neverOn}
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {latest.conditions.map((c) => {
          const yes = c.met === true;
          return (
            <li
              key={c.key}
              className={`flex flex-col gap-1 rounded-lg border p-3 ${yes ? 'border-up/40 bg-up/10' : 'border-transparent bg-bg'}`}
            >
              <span className="text-xs text-muted">{k.names[c.key] ?? c.key}</span>
              <span className="text-xl font-bold text-white">{conditionValue(c)}</span>
              <span
                className={`flex items-center gap-1.5 text-xs ${yes ? 'text-up' : 'text-muted'}`}
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <path d={yes ? 'M5 12l5 5 9-10' : 'M6 6l12 12M18 6L6 18'} />
                </svg>
                {k.met[String(c.met)]} · {needs(c.key)}
              </span>
            </li>
          );
        })}
      </ul>
      {showPlan && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-white">{k.planTitle(plan.triggerDate)}</h3>
          <p className="text-sm text-muted">{k.planIntro}</p>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {plan.tranches.map((tr) => (
              <li
                key={tr.step}
                className={`flex flex-col gap-1.5 rounded-lg border p-3 text-sm ${tr.status === 'met' ? 'border-up/40 bg-up/10' : 'border-line bg-bg'}`}
              >
                <span className="text-lg font-bold text-white">1/3</span>
                <span>
                  {`${k.steps[tr.step]?.(tr.level === null ? r.noData : fixed(tr.level, 2)) ?? ''} ${
                    tr.status === 'met' && tr.date
                      ? k.status.met(tr.date)
                      : k.status[tr.status === 'met' ? 'waiting' : tr.status]
                  }`}
                </span>
              </li>
            ))}
          </ol>
          {plan.pausedOn && <p className="text-sm">{k.paused(plan.pausedOn)}</p>}
          {plan.reviewOn && <p className="text-sm">{k.review(plan.reviewOn)}</p>}
          <p className="text-sm">{k.exit}</p>
        </div>
      )}
      <p className="rounded-lg bg-down/10 px-3.5 py-3 text-[13px] leading-relaxed">{k.bearCase}</p>
      <Details>
        <Info>{k.intro}</Info>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{k.colCondition}</th>
                <th className={thNum}>{k.colValue}</th>
                <th className={th}>{k.colRule}</th>
                <th className={th}>{k.colMet}</th>
              </tr>
            </thead>
            <tbody>
              {latest.conditions.map((c) => (
                <tr key={c.key}>
                  <td className={td}>{k.names[c.key] ?? c.key}</td>
                  <td className={`${td} ${num}`}>{conditionValue(c)}</td>
                  <td className={td}>{needs(c.key)}</td>
                  <td className={td}>{k.met[String(c.met)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm">{k.history}</p>
        <ul className="text-sm">
          {HORIZONS.map((h) => {
            const x = proxy(h);
            return (
              <li key={h}>
                {r.study.horizon(h)}:{' '}
                {!x
                  ? r.noData
                  : x.sufficient && x.median !== null && x.q1 !== null && x.q3 !== null
                    ? r.study.cell(pct(x.median), pct(x.q1), pct(x.q3), x.n)
                    : r.study.insufficient(x.n)}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">{k.screen}</p>
        <p className="text-xs text-muted">
          {k.rules(
            CAPITULATION_RULES.vixMin,
            CAPITULATION_RULES.above50MaxPct,
            CAPITULATION_RULES.minMembers,
            CAPITULATION_RULES.compositeMax,
          )}
        </p>
      </Details>
    </Card>
  );
}

function BreadthCard({ data }: { data: RegimeData }) {
  const b = r.breadth;
  const last = data.breadth.at(-1);
  if (!last)
    return (
      <Card id="breadth" title={b.title} subtitle={b.intro}>
        <p className="text-muted">{b.none}</p>
      </Card>
    );
  const now = breadthReading(last);
  const monthAgoDay = data.breadth.at(-22);
  const before = monthAgoDay ? breadthReading(monthAgoDay) : null;
  const lastThrust = [...data.breadth].reverse().find((d) => d.zweigThrust);
  const pctText = (v: number | null) => (v === null ? r.noData : `${fixed(v, 1)}%`);
  const bar = (label: string, value: number | null, prior: number | null, n: number) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-[15px]">
        <span className="text-white">{label}</span>
        <span className="font-bold text-white">{pctText(value)}</span>
      </div>
      <div aria-hidden="true" className="relative h-2.5 rounded bg-faint/20">
        <span
          className="absolute inset-y-0 start-0 rounded bg-up"
          style={{ width: width((value ?? 0) / 100) }}
        />
        {prior !== null && (
          <span
            className="absolute -top-1 -bottom-1 w-0.5 bg-white"
            style={{ insetInlineStart: width(prior / 100) }}
          />
        )}
      </div>
      <span className="text-xs text-muted">
        {b.outOf(n)}
        {prior !== null ? `; ${b.monthAgo(pctText(prior))}` : ''}
      </span>
    </div>
  );
  return (
    <Card id="breadth" title={b.title} subtitle={b.asOf(last.date, last.members)}>
      {bar(b.above50, now.pctAbove50, before?.pctAbove50 ?? null, last.n50)}
      {bar(b.above200, now.pctAbove200, before?.pctAbove200 ?? null, last.n200)}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-bg p-3">
          <dt className="text-xs text-muted">{b.netHighs}</dt>
          <dd className="text-xl font-bold text-white">{signed(now.netNewHighs, 0)}</dd>
          <dd className="text-xs text-muted">{b.highsLows(last.newHighs, last.newLows)}</dd>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <dt className="text-xs text-muted">{b.advDec}</dt>
          <dd className="text-xl font-bold text-white">
            {b.advDecValue(last.advancers, last.decliners)}
          </dd>
          <dd className="text-xs text-muted">
            {b.upVolume}: {pctText(now.upVolumePct)}
          </dd>
        </div>
      </dl>
      {last.suspect > 0 && <p className="text-sm text-muted">{b.suspect(last.suspect)}</p>}
      <Details>
        <Info>{b.intro}</Info>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">{b.avg10}</dt>
            <dd className="font-medium">
              {last.advanceAvg10 === null ? r.noData : fixed(last.advanceAvg10, 3)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{b.mcclellan}</dt>
            <dd className="font-medium">
              {last.mcclellanOscillator === null
                ? r.noData
                : `${signed(last.mcclellanOscillator, 3)} (${last.mcclellanSummation === null ? '' : signed(last.mcclellanSummation, 2)})`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">{b.zweig}</dt>
            <dd className="font-medium">
              {lastThrust ? b.zweigLast(lastThrust.date) : b.zweigNone}
            </dd>
            <dd className="text-xs text-muted">{b.zweigRule}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">{b.outOf(last.n252)} (52-week highs and lows)</p>
        <Info>
          <p>{b.warmup}</p>
          <p>{b.source(`${UNIVERSE_VERSION}, ${BREADTH_VERSION}`)}</p>
        </Info>
      </Details>
    </Card>
  );
}

function componentValue(key: ComponentKey, v: number): string {
  switch (key) {
    case 'momentum':
    case 'volatility':
    case 'safeHaven':
      return pct(v);
    case 'strength':
      return `${pct(v)} of members`;
    case 'breadth':
      return signed(v, 1);
    case 'putCall':
      return fixed(v, 2);
    case 'junk':
      return `${fixed(v, 2)} points`;
  }
}

/** Short component names for the bars; the full names are in the details table. */
const SHORT: Record<ComponentKey, string> = {
  momentum: 'Momentum',
  strength: 'Strength',
  breadth: 'Breadth',
  putCall: 'Put/call',
  junk: 'Junk bonds',
  volatility: 'Volatility',
  safeHaven: 'Safe haven',
};

const toneOf = (score: number) =>
  score >= 56 ? 'var(--color-up)' : score <= 44 ? 'var(--color-down)' : 'var(--color-muted)';

function FearGreedCard({ data }: { data: RegimeData }) {
  const f = r.fearGreed;
  const withComposite = data.fearGreed.filter((d) => d.composite !== null);
  const last = withComposite.at(-1);
  const newest = data.fearGreed.at(-1);
  if (!last || last.composite === null)
    return (
      <Card id="fear-greed" title={f.title} subtitle={f.intro}>
        <p className="text-muted">{f.none}</p>
        {newest && <p className="text-sm text-muted">{f.newer(newest.date, newest.available)}</p>}
      </Card>
    );
  const monthAgo: StoredFearGreedDay | undefined = withComposite.at(-22);
  const v = Math.round(last.composite);
  const a = Math.PI * (1 - clamp01(last.composite / 100));
  const arc = `M10 50 A40 40 0 0 1 ${toFixedHalfUp(50 + 40 * Math.cos(a), 1)} ${toFixedHalfUp(50 - 40 * Math.sin(a), 1)}`;
  return (
    <Card
      id="fear-greed"
      title={f.title}
      subtitle={`${f.count(last.available)}. ${f.asOf(last.date, last.version)}`}
    >
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 100 56"
          role="img"
          aria-label={u.gaugeAria(v)}
          className="h-[67px] w-[120px] flex-none"
        >
          <path
            d="M10 50 A40 40 0 0 1 90 50"
            fill="none"
            stroke="rgba(138,153,178,0.25)"
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path d={arc} fill="none" stroke={toneOf(v)} strokeWidth="9" strokeLinecap="round" />
        </svg>
        <div className="flex flex-col">
          <p
            data-testid="fear-greed-value"
            className="text-[40px] leading-none font-bold text-white"
          >
            {f.headline(v, f.labels[last.label ?? ''] ?? '')}
          </p>
          {monthAgo?.composite != null && (
            <span className="text-xs text-muted">
              {f.monthAgo(Math.round(monthAgo.composite), monthAgo.date)}
            </span>
          )}
        </div>
      </div>
      {newest && newest.date !== last.date && (
        <p className="text-sm text-muted">{f.newer(newest.date, newest.available)}</p>
      )}
      <ul className="flex flex-col gap-2">
        {last.components.map((c) => (
          <li
            key={c.key}
            className="grid min-h-6 grid-cols-[96px_minmax(0,1fr)_88px] items-center gap-2.5 text-[13px]"
          >
            <span className={c.score === null ? 'text-muted' : 'text-white'}>{SHORT[c.key]}</span>
            <span
              aria-hidden="true"
              className="relative h-2 rounded"
              style={{
                background:
                  c.score === null
                    ? 'repeating-linear-gradient(135deg, rgba(138,153,178,0.25) 0 4px, transparent 4px 8px)'
                    : 'rgba(138,153,178,0.16)',
              }}
            >
              {c.score !== null && (
                <span
                  className="absolute inset-y-0 start-0 rounded"
                  style={{ width: width(c.score / 100), background: toneOf(c.score) }}
                />
              )}
            </span>
            <span className="text-end text-white">
              {c.score === null ? (
                <span className="text-[11px] text-muted">{u.unavailable}</span>
              ) : (
                Math.round(c.score)
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{f.bands}</p>
      <Details>
        <Info>{f.intro}</Info>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{f.colComponent}</th>
                <th className={thNum}>{f.colValue}</th>
                <th className={thNum}>{f.colScore}</th>
                <th className={th}>{f.colSource}</th>
              </tr>
            </thead>
            <tbody>
              {last.components.map((c) => (
                <tr key={c.key}>
                  <td className={td}>{f.names[c.key] ?? c.key}</td>
                  <td className={`${td} ${num}`}>
                    {c.value === null ? r.noData : componentValue(c.key, c.value)}
                  </td>
                  <td className={`${td} ${num}`}>
                    {c.score === null ? (
                      <span className="text-muted">{f.reasons[c.reason ?? 'no-data']}</span>
                    ) : (
                      <>
                        {Math.round(c.score)}
                        <span className="block text-xs text-muted">{f.windowNote(c.window)}</span>
                      </>
                    )}
                  </td>
                  <td className={td}>
                    <span className="text-xs text-muted">{COMPONENT_SOURCES[c.key]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Info>{f.method}</Info>
      </Details>
    </Card>
  );
}

const CONDITIONS = [
  'stress',
  'bear',
  'recovery',
  'bull-calm',
  'bull-correction',
  'vix-30',
  'vix-30-recession-not-high',
  'all-days',
];

function StudyCard({ data }: { data: RegimeData }) {
  const s = r.study;
  const today = data.days.at(-1)?.label;
  const [cond, setCond] = useState<string>(
    today && CONDITIONS.includes(today) ? today : 'all-days',
  );
  if (data.stats.length === 0) return null;
  const at = (c: string, h: number): StoredEventStat | undefined =>
    data.stats.find((x) => x.condition === c && x.horizon === h);
  const any = data.stats[0] as StoredEventStat;
  const name = (c: string) =>
    c === 'vix-30'
      ? s.vix30
      : c === 'vix-30-recession-not-high'
        ? s.proxy
        : c === 'all-days'
          ? s.allDays
          : (r.labels[c] ?? c);
  const rows = HORIZONS.map((h) => ({ h, x: at(cond, h) }));
  const ok = (
    x: StoredEventStat | undefined,
  ): x is StoredEventStat & {
    median: number;
    q1: number;
    q3: number;
  } => !!x && x.sufficient && x.median !== null && x.q1 !== null && x.q3 !== null;
  const span = Math.max(
    0.05,
    ...rows.flatMap(({ x }) => (ok(x) ? [Math.abs(x.q1), Math.abs(x.q3), Math.abs(x.median)] : [])),
  );
  const M = Math.ceil(span * 20) / 20;
  const pos = (v: number) => width((v + M) / (2 * M));
  return (
    <Card id="study" title={s.title} subtitle={u.studySub(monthYear(any.dataFrom))}>
      <div
        role="group"
        aria-label={s.colCondition}
        className="flex overflow-x-auto rounded-xl bg-bg p-[3px] [scrollbar-width:none]"
      >
        {CONDITIONS.map((c) => {
          const on = c === cond;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setCond(c)}
              className={`min-h-11 flex-[1_0_auto] rounded-[9px] px-2.5 text-[13px] font-semibold whitespace-nowrap ${on ? 'bg-raised text-white' : 'text-muted'}`}
            >
              {c === today ? u.today(name(c)) : name(c)}
            </button>
          );
        })}
      </div>
      <ul className="flex flex-col">
        {rows.map(({ h, x }) => (
          <li key={h} className="flex flex-col gap-1.5 border-t border-line-soft pt-2.5 pb-1">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[15px] text-white">
                {u.horizonSessions(h)}{' '}
                <span className="text-[13px] text-muted">{u.nEquals(x?.n ?? 0)}</span>
              </span>
              <span
                className={`text-lg font-bold tabular-nums ${ok(x) ? (x.median >= 0 ? 'text-up' : 'text-down') : 'text-muted'}`}
              >
                {ok(x) ? pct(x.median) : u.notEnough}
              </span>
            </div>
            {ok(x) ? (
              <>
                <div aria-hidden="true" className="relative h-[22px]">
                  <span className="absolute inset-x-0 top-2.5 h-0.5 bg-faint/20" />
                  <span className="absolute inset-y-0 start-1/2 w-px bg-muted/60" />
                  <span
                    className="absolute top-[5px] h-3 rounded bg-up/35"
                    style={{ insetInlineStart: pos(x.q1), width: width((x.q3 - x.q1) / (2 * M)) }}
                  />
                  <span
                    className="absolute top-px h-5 w-1 -ms-0.5 rounded-sm bg-white"
                    style={{ insetInlineStart: pos(x.median) }}
                  />
                </div>
                <span className="text-[13px] text-muted">{u.middleHalf(pct(x.q1), pct(x.q3))}</span>
              </>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-muted/40 px-3 py-2.5">
                <span className="text-sm text-fg">{x ? u.insufficientOf(x.n) : r.noData}</span>
                {x && (
                  <span aria-hidden="true" className="flex gap-0.5">
                    {Array.from({ length: 30 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-[1px] ${i < x.n ? 'bg-up' : 'bg-faint/25'}`}
                      />
                    ))}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Info>
        <p>{s.note(any.dataFrom, any.dataTo)}</p>
        <p>{u.scaleNote}</p>
      </Info>
      <Details>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{s.colCondition}</th>
                {HORIZONS.map((h) => (
                  <th key={h} className={th}>
                    {s.horizon(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONDITIONS.map((c) => (
                <tr key={c}>
                  <td className={td}>{name(c)}</td>
                  {HORIZONS.map((h) => {
                    const x = at(c, h);
                    return (
                      <td key={h} className={td}>
                        {!x
                          ? r.noData
                          : ok(x)
                            ? s.cell(pct(x.median), pct(x.q1), pct(x.q3), x.n)
                            : s.insufficient(x.n)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{s.depth}</p>
      </Details>
    </Card>
  );
}

function GeopoliticsCard({ data }: { data: RegimeData }) {
  const g = r.geopolitics;
  const last = data.topics.at(-1);
  const gpr = seriesSnapshot(data.gpr);
  const epu = seriesSnapshot(data.series['USEPUINDXD'] ?? []);
  const sum = last ? topicSummary(data.topics, last.date) : null;
  const top = sum
    ? [...sum.readings].sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))[0]?.topic
    : undefined;
  const [picked, setPicked] = useState<Topic | null>(null);
  const topic = picked ?? top ?? null;
  const samples = (tp: Topic) => [...data.topics].reverse().flatMap((d) => d.samples[tp] ?? []);
  const headline = (s: { title: string; url: string }) =>
    /^https:\/\//.test(s.url) ? (
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center underline underline-offset-2"
      >
        {s.title}
      </a>
    ) : (
      s.title
    );
  const chips = (
    <div className="flex flex-wrap gap-2">
      {gpr && (
        <span className="flex min-h-9 items-center rounded-full bg-bg px-3 text-[13px]">
          {u.percentileChip('GPR', r.ordinal(Math.round(gpr.percentile)), gpr.date)}
        </span>
      )}
      {epu && (
        <span className="flex min-h-9 items-center rounded-full bg-bg px-3 text-[13px]">
          {u.percentileChip('EPU', r.ordinal(Math.round(epu.percentile)), epu.date)}
        </span>
      )}
    </div>
  );
  const assets = (
    <>
      <h3 className="font-semibold text-white">{g.assetsTitle}</h3>
      <SnapshotTable
        rows={[
          { label: g.oil, obs: data.series['DCOILWTICO'] ?? [] },
          { label: g.dollar, obs: data.series['DTWEXBGS'] ?? [] },
          { label: g.dgs10, obs: data.series['DGS10'] ?? [] },
          { label: g.gld, obs: data.bars['GLD'] ?? [] },
          { label: g.ita, obs: data.bars['ITA'] ?? [] },
          { label: g.iyt, obs: data.bars['IYT'] ?? [] },
        ]}
      />
      <Info>{g.source}</Info>
    </>
  );
  if (!last || !sum)
    return (
      <Card id="geopolitics" title={g.title} subtitle={g.intro} aside={chips}>
        <p className="text-muted">{g.none}</p>
        <Details>{assets}</Details>
      </Card>
    );
  const sel = topic ? samples(topic).slice(0, 3) : [];
  return (
    <Card
      id="geopolitics"
      title={g.title}
      subtitle={g.asOf(last.date, sum.recentDays, sum.baselineDays)}
      aside={chips}
    >
      <Info>{g.intro}</Info>
      <div
        role="group"
        aria-label={g.colTopic}
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2"
      >
        {sum.readings.map((x) => {
          const on = x.topic === topic;
          const ratio = x.ratio;
          const tone =
            ratio === null
              ? 'var(--color-muted)'
              : ratio >= 1.5
                ? 'var(--color-warn)'
                : ratio >= 1
                  ? 'var(--color-fg)'
                  : 'var(--color-up)';
          return (
            <button
              key={x.topic}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(x.topic)}
              className={`flex min-h-24 flex-col gap-1.5 rounded-lg border-2 p-3 text-start text-white ${on ? 'border-up bg-raised' : 'border-transparent bg-bg'}`}
            >
              <span className="text-sm font-semibold">{g.names[x.topic] ?? x.topic}</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[22px] font-bold">{x.last7}</span>
                <span className="text-xs text-muted">{u.articles}</span>
              </span>
              <span className="flex w-full items-center gap-2">
                <span aria-hidden="true" className="h-1.5 flex-1 rounded-sm bg-faint/20">
                  <span
                    className="block h-full rounded-sm"
                    style={{ width: width((ratio ?? 0) / 2), background: tone }}
                  />
                </span>
                <span className="text-xs" style={{ color: tone }}>
                  {ratio === null ? g.noRatio : g.ratio(fixed(ratio, 1))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {topic && (
        <div className="flex flex-col rounded-lg bg-raised px-4 py-3.5">
          <h3 className="pb-1.5 text-[13px] font-normal text-muted">
            {u.topicHeadlines(g.names[topic] ?? topic, sel.length)}
          </h3>
          {sel.length === 0 && <p className="text-sm text-muted">{u.noHeadlines}</p>}
          <ul>
            {sel.map((s2) => (
              <li
                key={s2.url + s2.title}
                className="flex flex-col gap-0.5 border-t border-white/10 py-2 text-[15px]"
              >
                {headline(s2)}
                <span className="text-xs text-muted">
                  {s2.publisher}, {s2.publishedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Details>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{g.colTopic}</th>
                <th className={thNum}>{g.colLast7}</th>
                <th className={thNum}>{g.colShare}</th>
                <th className={thNum}>{g.colBaseline}</th>
                <th className={thNum}>{g.colRatio}</th>
                <th className={th}>{g.colLatest}</th>
              </tr>
            </thead>
            <tbody>
              {sum.readings.map((x) => {
                const s2 = samples(x.topic)[0];
                return (
                  <tr key={x.topic}>
                    <td className={td}>{g.names[x.topic] ?? x.topic}</td>
                    <td className={`${td} ${num}`}>{x.last7}</td>
                    <td className={`${td} ${num}`}>
                      {x.share7 === null ? r.noData : `${fixed(x.share7 * 100, 1)}%`}
                    </td>
                    <td className={`${td} ${num}`}>
                      {x.weeklyBaseline === null ? r.noData : fixed(x.weeklyBaseline, 1)}
                    </td>
                    <td className={`${td} ${num}`}>
                      {x.ratio === null ? g.noRatio : g.ratio(fixed(x.ratio, 1))}
                    </td>
                    <td className={td}>
                      {s2 && headline(s2)}
                      {s2 && (
                        <span className="block text-xs text-muted">
                          {s2.publisher}, {s2.publishedAt.slice(0, 10)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {assets}
      </Details>
    </Card>
  );
}

function MeasuresCard({
  id,
  title,
  rows,
  notes,
}: {
  id: string;
  title: string;
  rows: { label: string; obs: Obs[]; digits?: number }[];
  notes: string[];
}) {
  return (
    <Card id={id} title={title}>
      <SnapshotTable rows={rows} />
      {notes.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </Card>
  );
}

type GaugeKey = 'fg' | 'rec' | 'breadth' | 'cap';

interface Gauge {
  key: GaugeKey;
  title: string;
  meta: string;
  value: string;
  sub: string;
  /** One pip per input: met or high (up), not met (muted), no data (faint). Words carry the meaning. */
  pips: ('on' | 'off' | 'none')[];
  foot: string;
}

const PIP: Record<Gauge['pips'][number], string> = {
  on: 'bg-up',
  off: 'bg-muted/50',
  none: 'bg-faint/20',
};

function gaugesOf(data: RegimeData): Gauge[] {
  const out: Gauge[] = [];
  const fg = data.fearGreed.filter((d) => d.composite !== null).at(-1);
  out.push(
    fg && fg.composite !== null
      ? {
          key: 'fg',
          title: r.fearGreed.title,
          meta: r.fearGreed.count(fg.available),
          value: String(Math.round(fg.composite)),
          sub: fg.label ? (r.fearGreed.labels[fg.label] ?? fg.label) : '',
          pips: fg.components.map((c) =>
            c.score === null ? 'none' : c.score >= 55 ? 'on' : 'off',
          ),
          foot: fg.date,
        }
      : {
          key: 'fg',
          title: r.fearGreed.title,
          meta: '',
          value: u.unavailable,
          sub: '',
          pips: [],
          foot: r.fearGreed.none,
        },
  );
  const day = data.days.at(-1);
  out.push(
    day
      ? {
          key: 'rec',
          title: r.recession.title,
          meta: u.signalsOf(day.available, day.signals.length),
          value: r.recession.level[day.recessionLevel] ?? day.recessionLevel,
          sub: u.triggeredN(day.triggered),
          pips: day.signals.map((x) =>
            x.state === 'triggered' ? 'on' : x.state === 'clear' ? 'off' : 'none',
          ),
          foot: day.date,
        }
      : {
          key: 'rec',
          title: r.recession.title,
          meta: '',
          value: u.unavailable,
          sub: '',
          pips: [],
          foot: r.none,
        },
  );
  const b = data.breadth.at(-1);
  const pct = (a: number, n: number) => (n > 0 ? `${toFixedHalfUp((a / n) * 100, 1)}%` : null);
  out.push(
    b && pct(b.above50, b.n50)
      ? {
          key: 'breadth',
          title: r.breadth.title,
          meta: u.members(b.members),
          value: pct(b.above50, b.n50) as string,
          sub: u.above50Sub,
          pips: [],
          foot: `${b.date} \u00B7 ${u.above200(pct(b.above200, b.n200) ?? u.notEnough)}`,
        }
      : {
          key: 'breadth',
          title: r.breadth.title,
          meta: '',
          value: u.unavailable,
          sub: '',
          pips: [],
          foot: r.breadth.none,
        },
  );
  const cap = data.capitulation.latest;
  out.push(
    cap
      ? {
          key: 'cap',
          title: r.capitulation.title,
          meta: cap.date,
          value: r.capitulation.state[cap.state] ?? cap.state,
          sub: u.metCount(cap.conditions.filter((c) => c.met === true).length),
          pips: cap.conditions.map((c) => (c.met === null ? 'none' : c.met ? 'on' : 'off')),
          foot: r.capitulation.intro,
        }
      : {
          key: 'cap',
          title: r.capitulation.title,
          meta: '',
          value: u.unavailable,
          sub: '',
          pips: [],
          foot: r.capitulation.none,
        },
  );
  return out;
}

/** Phones: the four gauges as a swipe row; each opens its full card in a sheet (design handoff). */
function GaugeRow({ data }: { data: RegimeData }) {
  const [open, setOpen] = useState<GaugeKey | null>(null);
  const gauges = gaugesOf(data);
  const current = gauges.find((g) => g.key === open);
  return (
    <section aria-label={u.gauges} className="flex flex-col gap-2">
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1">
        {gauges.map((g) => (
          <li key={g.key} className="w-[78%] flex-none snap-start">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpen(g.key)}
              className="flex h-full w-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-start"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[0.9375rem] font-semibold text-white">{g.title}</span>
                <span className="text-xs text-muted">{g.meta}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span
                  className={`font-bold ${g.value === u.unavailable ? 'text-lg text-alarm' : 'text-[2rem] leading-none text-white'}`}
                >
                  {g.value}
                </span>
                {g.sub && <span className="text-sm text-fg">{g.sub}</span>}
              </span>
              {g.pips.length > 0 && (
                <span aria-hidden="true" className="flex gap-1">
                  {g.pips.map((p, i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${PIP[p]}`} />
                  ))}
                </span>
              )}
              <span className="line-clamp-2 text-[0.8125rem] text-muted">{g.foot}</span>
              <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-up">
                {u.details}
                <ChevronRight aria-hidden="true" size={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{u.swipeHint}</p>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={current?.title ?? ''}>
        {open === 'fg' && <FearGreedCard data={data} />}
        {open === 'rec' && <RecessionCard data={data} />}
        {open === 'breadth' && <BreadthCard data={data} />}
        {open === 'cap' && <CapitulationCard data={data} />}
      </Sheet>
    </section>
  );
}

/** Phones: the longer context cards, collapsed until tapped. */
function Collapsed({
  title,
  sum,
  value,
  children,
}: {
  title: string;
  sum: string;
  value?: string | null;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 text-white select-none">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-semibold">{title}</span>
          <span className="text-[13px] text-muted">{sum}</span>
        </span>
        {value && <span className="font-bold whitespace-nowrap text-up">{value}</span>}
        <ChevronDown
          aria-hidden="true"
          size={18}
          className="flex-none text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="flex flex-col gap-4 p-2 pt-0">{children}</div>
    </details>
  );
}

export function Regime() {
  const q = useQuery({ queryKey: ['regime'], queryFn: loadRegime });
  const v = r.volatility;
  const c = r.credit;
  const un = r.uncertainty;
  const grid = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-start gap-4';
  const wide = useWide();
  const capOn = q.data?.capitulation.latest?.state === 'on';
  const vixLast = q.data?.series['VIXCLS']?.at(-1)?.value;
  const vix3mLast = q.data?.series['VXVCLS']?.at(-1)?.value;
  const volRatio =
    vixLast !== undefined && vix3mLast ? toFixedHalfUp(vixLast / vix3mLast, 2) : null;
  const pctOf = (label: string, obs: Obs[]) => {
    const snap = seriesSnapshot(obs);
    return snap ? u.accPct(label, r.ordinal(Math.round(snap.percentile))) : null;
  };
  return (
    <section className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <div>
        {/* On a phone the top bar shows the page title. */}
        <h1 className="sr-only text-xl font-semibold text-white tablet:not-sr-only">{r.title}</h1>
        <Info>{r.intro}</Info>
      </div>
      {q.isPending && <SkeletonCards />}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data && !wide && (
        <>
          <Hero data={q.data} />
          <GaugeRow data={q.data} />
          <StudyCard data={q.data} />
          <h2 className="sr-only">{u.moreContext}</h2>
          <Collapsed
            title={t.regime.quality.title}
            sum={u.accQuality}
            value={capOn ? u.accActive : u.accInactive}
          >
            <div className={cardClass}>
              <QualityScreen capitulationOn={capOn} />
            </div>
          </Collapsed>
          <Collapsed title={r.geopolitics.title} sum={u.accGeo}>
            <GeopoliticsCard data={q.data} />
          </Collapsed>
          <Collapsed title={v.title} sum={u.accVol} value={volRatio}>
            <MeasuresCard
              id="volatility"
              title={v.title}
              rows={[
                { label: v.vix, obs: q.data.series['VIXCLS'] ?? [] },
                { label: v.vix3m, obs: q.data.series['VXVCLS'] ?? [] },
              ]}
              notes={[`${v.contango} ${v.backwardation}`, v.source]}
            />
          </Collapsed>
          <Collapsed title={un.title} sum={u.accUnc} value={pctOf(u.gprShort, q.data.gpr)}>
            <MeasuresCard
              id="uncertainty"
              title={un.title}
              rows={[
                { label: un.gpr, obs: q.data.gpr, digits: 1 },
                { label: un.epu, obs: q.data.series['USEPUINDXD'] ?? [], digits: 1 },
              ]}
              notes={[un.source]}
            />
          </Collapsed>
          <Collapsed
            title={c.title}
            sum={u.accCredit}
            value={pctOf(u.hyShort, q.data.series['BAMLH0A0HYM2'] ?? [])}
          >
            <MeasuresCard
              id="credit"
              title={c.title}
              rows={[
                { label: c.hy, obs: q.data.series['BAMLH0A0HYM2'] ?? [] },
                { label: c.ig, obs: q.data.series['BAMLC0A0CM'] ?? [] },
                {
                  label: c.hyIg,
                  obs: seriesDifference(
                    q.data.series['BAMLH0A0HYM2'] ?? [],
                    q.data.series['BAMLC0A0CM'] ?? [],
                  ),
                },
                { label: c.dgs10, obs: q.data.series['DGS10'] ?? [] },
                { label: c.curve3m, obs: q.data.series['T10Y3M'] ?? [] },
                { label: c.curve2y, obs: q.data.series['T10Y2Y'] ?? [] },
              ]}
              notes={[c.source]}
            />
          </Collapsed>
        </>
      )}
      {q.data && wide && (
        <>
          <Hero data={q.data} />
          <div className={grid}>
            <RecessionCard data={q.data} />
            <CapitulationCard data={q.data} />
          </div>
          <div className={grid}>
            <FearGreedCard data={q.data} />
            <StudyCard data={q.data} />
          </div>
          <div className={grid}>
            <BreadthCard data={q.data} />
            <div className={cardClass}>
              <QualityScreen capitulationOn={q.data.capitulation.latest?.state === 'on'} />
            </div>
          </div>
          <GeopoliticsCard data={q.data} />
          <h2 className="pt-2 text-[17px] font-semibold text-white">{u.moreMeasures}</h2>
          <div className={grid}>
            <MeasuresCard
              id="volatility"
              title={v.title}
              rows={[
                { label: v.vix, obs: q.data.series['VIXCLS'] ?? [] },
                { label: v.vix3m, obs: q.data.series['VXVCLS'] ?? [] },
              ]}
              notes={[`${v.contango} ${v.backwardation}`, v.source]}
            />
            <MeasuresCard
              id="uncertainty"
              title={un.title}
              rows={[
                { label: un.gpr, obs: q.data.gpr, digits: 1 },
                { label: un.epu, obs: q.data.series['USEPUINDXD'] ?? [], digits: 1 },
              ]}
              notes={[un.source]}
            />
          </div>
          <MeasuresCard
            id="credit"
            title={c.title}
            rows={[
              { label: c.hy, obs: q.data.series['BAMLH0A0HYM2'] ?? [] },
              { label: c.ig, obs: q.data.series['BAMLC0A0CM'] ?? [] },
              {
                label: c.hyIg,
                obs: seriesDifference(
                  q.data.series['BAMLH0A0HYM2'] ?? [],
                  q.data.series['BAMLC0A0CM'] ?? [],
                ),
              },
              { label: c.dgs10, obs: q.data.series['DGS10'] ?? [] },
              { label: c.curve3m, obs: q.data.series['T10Y3M'] ?? [] },
              { label: c.curve2y, obs: q.data.series['T10Y2Y'] ?? [] },
            ]}
            notes={[c.source]}
          />
        </>
      )}
    </section>
  );
}
