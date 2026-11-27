import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LEFT_OUT, PLAYBOOKS, ruleLines, toFixedHalfUp, type Playbook } from '@marsad/core';
import { Info } from '../components/Info';
import { Card, Tile, cardClass, useWide } from '../components/Card';
import { Num, PageTitle } from '../components/ui/kit';
import { loadLab, type LabRule, type LabRun } from '../lib/lab';
import { t } from '../strings';

const l = t.lab;
const v = t.lab.v2;
const pct = (x: number) => `${x > 0 ? '+' : ''}${toFixedHalfUp(x * 100, 2)}%`;

type EquityPoints = NonNullable<NonNullable<LabRun['report']['outOfSample']>['equity']>;

/** The stored out-of-sample equity curve, drawn only when the report carries one (the design's rule). */
function EquityChart({ points }: { points: EquityPoints }) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) return null;
  const values = points.map((p) => p.equity);
  const lo = Math.min(1, ...values);
  const hi = Math.max(1, ...values);
  const span = hi - lo || 1;
  const W = 320;
  const H = 96;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (e: number) => H - ((e - lo) / span) * H;
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const fmt = (e: number) => toFixedHalfUp(e, 2);
  const low = Math.min(...values);
  return (
    <figure className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev p-3.5">
      <figcaption className="text-sm font-semibold text-ink">{l.equityTitle}</figcaption>
      <svg
        role="img"
        aria-label={l.equityAria(points.length, first.date, last.date, fmt(last.equity), fmt(low))}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
      >
        <line
          x1="0"
          x2={W}
          y1={y(1)}
          y2={y(1)}
          className="stroke-ink3"
          strokeDasharray="3 3"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={path}
          fill="none"
          className={last.equity >= 1 ? 'stroke-up' : 'stroke-down'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="text-xs text-ink3" aria-hidden="true">
        <Num>
          {first.date} to {last.date}
        </Num>{' '}
        {'·'} {l.equitySummary(fmt(last.equity), fmt(low))}
      </p>
      <Info>{l.equityNote}</Info>
    </figure>
  );
}

type Stage = 'notTestable' | 'notRun' | 'draft' | 'backtested' | 'shadow' | 'live' | 'demoted';
const STAGES: Stage[] = [
  'notTestable',
  'notRun',
  'draft',
  'backtested',
  'shadow',
  'live',
  'demoted',
];
/** Stage pills: the words carry the stage; the tint only repeats it. */
const PILL: Record<Stage, string> = {
  notTestable: 'bg-sub text-ink3',
  notRun: 'bg-sub text-ink2',
  draft: 'bg-warn-soft text-warn',
  backtested: 'bg-up-soft text-up',
  shadow: 'bg-up-soft text-up',
  live: 'bg-accent text-accent-ink',
  demoted: 'bg-down-soft text-down',
};

function stageOf(p: Playbook, rule?: LabRule): Stage {
  if (p.notTestableBecause) return 'notTestable';
  const s = rule?.status;
  return s === 'draft' || s === 'backtested' || s === 'shadow' || s === 'live' || s === 'demoted'
    ? s
    : 'notRun';
}

function StagePill({ stage }: { stage: Stage }) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${PILL[stage]}`}
    >
      {l.stage[stage]}
    </span>
  );
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${l.ui.months[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;
};
const num2 = (n: number) => String(n).padStart(2, '0');
const horizonOf = (p: Playbook) => l.horizon[p.horizon] ?? p.horizon;
const ratingOf = (p: Playbook) => l.rating[p.rating] ?? p.rating;

/** The gate as the main visual: out-of-sample trades against the 30 needed, one tick each. */
function Gate({ run }: { run: LabRun }) {
  const o = run.report.outOfSample;
  if (!o) return null;
  const n = o.stats.n;
  const insufficient = !o.stats.sufficient;
  const head = insufficient
    ? l.ui.insufficientHistory
    : run.report.gate
      ? run.report.gate.ok
        ? v.gatePassed
        : v.gateNotPassed
      : v.oosTrades;
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev p-3.5">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{head}</span>
        <span className="text-lg font-semibold text-ink tabular-nums">
          {n < 30 ? v.ofThirty(n) : n}{' '}
          <span className="text-xs font-normal text-ink3">
            {n < 30 ? v.outOfSample : v.outOfSampleMet}
          </span>
        </span>
      </span>
      <span aria-hidden="true" className="flex gap-0.5">
        {Array.from({ length: 30 }, (_, i) => (
          <span key={i} className={`h-3.5 flex-1 rounded-[2px] ${i < n ? 'bg-up' : 'bg-sub'}`} />
        ))}
      </span>
      <span className="text-xs text-ink3">
        {l.ui.lastRunDate(day(run.createdAt), run.report.trades ?? 0, n)}.{' '}
        {o.equity ? '' : v.noCurve}
      </span>
      {insufficient && <p className="sr-only">{l.insufficient(n)}</p>}
    </div>
  );
}

/** Interval, win rate, drawdown and benchmark: only from 30 out-of-sample trades up (no percentage below). */
function RunStats({ run }: { run: LabRun }) {
  const o = run.report.outOfSample;
  return (
    <div className="flex flex-col gap-1 text-sm text-ink2">
      {run.params.tickers && run.params.tickers.length > 0 && (
        <p>
          {l.lastRun(
            run.createdAt.slice(0, 16).replace('T', ' ') + ' UTC',
            run.params.tickers.join(', '),
          )}
        </p>
      )}
      {o && <p>{l.trades(run.report.trades ?? 0, o.stats.n)}</p>}
      {o && o.stats.sufficient && o.expectancy.value !== null && o.expectancy.ci90 && (
        <>
          <p className="font-semibold text-ink">
            {l.expectancy(
              pct(o.expectancy.value),
              pct(o.expectancy.ci90.low),
              pct(o.expectancy.ci90.high),
            )}
          </p>
          {o.stats.winRate !== null && (
            <p>{l.winRate(`${toFixedHalfUp(o.stats.winRate * 100, 1)}%`)}</p>
          )}
          {o.stats.maxDrawdown !== null && o.monteCarlo && (
            <p>{l.drawdown(pct(o.stats.maxDrawdown), pct(o.monteCarlo.worst5))}</p>
          )}
        </>
      )}
      {o?.benchmark && <p>{l.benchmark(o.benchmark.ticker, pct(o.benchmark.ret))}</p>}
      {run.report.gate && <p>{l.gate(run.report.gate.reason)}</p>}
    </div>
  );
}

/** Costs, walk-forward, holdout and trials, each from the stored run; "Not recorded" when the row lacks it. */
function Facts({ run }: { run?: LabRun }) {
  if (!run) return <Tile label={l.ui.trialsCounted} value="0" note={v.noRunTrials} />;
  const c = run.params.costs;
  const f = run.params.folds;
  const h = run.params.holdoutFraction;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5">
      {c ? (
        <Tile
          label={l.ui.costsPerSide}
          value={v.costsValue(c.commissionBps + c.slippageBps + c.fxBps)}
          note={v.costsSub(c.commissionBps, c.slippageBps, c.fxBps)}
        />
      ) : (
        <Tile label={l.ui.costsPerSide} value={v.notRecorded} note={v.notRecordedSub} />
      )}
      <Tile
        label={v.walkForward}
        value={typeof f === 'number' ? v.walkValue(f) : v.notRecorded}
        note={typeof f === 'number' ? v.walkSub : v.notRecordedSub}
      />
      <Tile
        label={v.holdout}
        value={typeof h === 'number' ? v.holdoutValue(toFixedHalfUp(h * 100, 0)) : v.notRecorded}
        note={typeof h === 'number' ? v.holdoutSub : v.notRecordedSub}
      />
      <Tile
        label={l.ui.trialsCounted}
        value={run.trials === null ? v.notRecorded : String(run.trials)}
        {...(run.trials === null ? { note: v.notRecordedSub } : {})}
      />
    </div>
  );
}

function Detail({ p, stage, run }: { p: Playbook; stage: Stage; run?: LabRun }) {
  const o = run?.report.outOfSample;
  return (
    <section aria-labelledby="lab-detail-h" className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink3">
          {v.detailMeta(num2(p.number), horizonOf(p), ratingOf(p))}
          <StagePill stage={stage} />
        </span>
        <h2 id="lab-detail-h" className="text-xl leading-[1.3] font-semibold text-ink">
          {p.title}
        </h2>
        <p className="text-sm leading-[1.55] text-ink2">{p.summary}</p>
        <p className="sr-only">
          {l.meta(p.number, ratingOf(p), horizonOf(p), l.stage[stage] ?? '')}
        </p>
      </div>
      {run && <Gate run={run} />}
      {run && <RunStats run={run} />}
      {o?.equity && <EquityChart points={o.equity} />}
      {p.notTestableBecause ? (
        <p className="rounded-[10px] border border-dashed border-line-strong p-3.5 text-sm leading-normal text-ink2">
          {l.notTestable(p.notTestableBecause)}
        </p>
      ) : (
        !run && (
          <p className="rounded-[10px] border border-dashed border-line-strong p-3.5 text-sm leading-normal text-ink2">
            {l.ui.queued}
          </p>
        )
      )}
      {p.rule && (
        <>
          <code className="rounded-lg border border-line bg-canvas p-3 font-mono text-xs leading-normal whitespace-pre-wrap text-ink2">
            {[
              ...ruleLines(p.rule),
              ...(p.testOn.length ? [`test on: ${p.testOn.join(', ')}`] : []),
            ].join('\n')}
          </code>
          <details className="group rounded-lg border border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] text-ink3 select-none">
              {v.ruleJson}
            </summary>
            <code className="block border-t border-line p-3 font-mono text-xs whitespace-pre-wrap text-ink2">
              {JSON.stringify(p.rule, null, 2)}
            </code>
          </details>
        </>
      )}
      {!p.notTestableBecause && <Facts {...(run ? { run } : {})} />}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink3">{l.sources}</span>
        <ul className="flex flex-col">
          {p.sources.map((src) => (
            <li key={src} className="border-t border-line py-1.5 text-[13px] text-ink2">
              {src}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Lab() {
  const q = useQuery({ queryKey: ['lab'], queryFn: loadLab });
  const wide = useWide();
  const [filter, setFilter] = useState<Stage | null>(null);
  const [picked, setPicked] = useState<string>(PLAYBOOKS[0]?.id ?? '');
  const detailRef = useRef<HTMLDivElement>(null);
  const ruleOf = (id: string) => q.data?.rules.find((r) => r.id === id);
  const runOf = (id: string) => q.data?.runs.find((r) => r.ruleId === id);
  const stages = PLAYBOOKS.map((p) => stageOf(p, ruleOf(p.id)));
  const counts = Object.fromEntries(
    STAGES.map((k) => [k, stages.filter((x) => x === k).length]),
  ) as Record<Stage, number>;
  const shown = PLAYBOOKS.map((p, i) => ({ p, stage: stages[i] as Stage })).filter(
    (x) => !filter || x.stage === filter,
  );
  const sel = PLAYBOOKS.findIndex((p) => p.id === picked);
  const selP = PLAYBOOKS[sel] ?? PLAYBOOKS[0];
  const selRun = selP ? runOf(selP.id) : undefined;
  const pick = (id: string) => {
    setPicked(id);
    // One column on a phone: bring the detail into view under the list.
    if (!wide)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        }),
      );
  };
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="lab" />
      {q.isError && (
        <p role="alert" className="text-crit">
          {q.error.message}
        </p>
      )}
      <section aria-label={v.counts} className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-2">
          {STAGES.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter((f) => (f === k ? null : k))}
              className={`flex min-h-11 flex-col items-center gap-0.5 rounded-xl border bg-surface p-3 text-center ${
                filter === k ? 'border-ink3 bg-elev' : 'border-line'
              }`}
            >
              <span className="text-xs text-ink3">{v.count[k]}</span>
              <span
                className={`text-xl font-semibold tabular-nums ${counts[k] ? 'text-ink' : 'text-ink3'}`}
              >
                {counts[k]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p role="status" className="text-xs text-ink3">
            {filter ? v.showingStage(l.stage[filter] ?? filter) : v.showingAll}
          </p>
          <Info>{l.ui.gateNote}</Info>
        </div>
      </section>
      <section
        aria-labelledby="lab-list-h"
        className={`${cardClass} grid! gap-5! p-[18px]! ${wide ? 'grid-cols-[minmax(0,4fr)_minmax(0,7fr)]' : 'grid-cols-1'}`}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="lab-list-h" className="pb-1 text-base font-semibold text-ink">
            {v.listTitle(PLAYBOOKS.length)}
          </h2>
          {shown.length === 0 && <p className="text-sm text-ink3">{v.noneAtStage}</p>}
          <ul aria-labelledby="lab-list-h" className="flex flex-col gap-1.5">
            {shown.map(({ p, stage }) => {
              const on = selP?.id === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(p.id)}
                    className={`flex min-h-[52px] w-full flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-start text-ink ${
                      on ? 'border-ink3 bg-elev' : 'border-line hover:bg-elev'
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-ink3 tabular-nums">
                        {num2(p.number)}
                      </span>
                      <span className="text-[13px] leading-[1.35] font-semibold">{p.title}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StagePill stage={stage} />
                      <span className="text-xs text-ink3">
                        {v.listMeta(horizonOf(p), ratingOf(p))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div ref={detailRef} className="min-w-0 scroll-mt-4">
          {selP && (
            <Detail p={selP} stage={stages[sel] ?? 'notRun'} {...(selRun ? { run: selRun } : {})} />
          )}
        </div>
      </section>
      <Card id="left-out" title={l.leftOut}>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2.5">
          {LEFT_OUT.map((x) => (
            <li
              key={x.title}
              className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-elev p-3"
            >
              <span className="text-[13px] font-semibold text-ink">{x.title}</span>
              <span className="text-xs text-ink3">{x.why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
