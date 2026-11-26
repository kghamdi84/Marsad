import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, ChevronDown, Clock, Lock } from 'lucide-react';
import { cardClass } from '../components/Card';
import { LEFT_OUT, PLAYBOOKS, toFixedHalfUp, type Playbook } from '@marsad/core';
import { loadLab, type LabRule, type LabRun } from '../lib/lab';
import { t } from '../strings';

const l = t.lab;
const pct = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, 2)}%`;

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
  const y = (v: number) => H - ((v - lo) / span) * H;
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const fmt = (v: number) => toFixedHalfUp(v, 2);
  const low = Math.min(...values);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs font-semibold text-fg">{l.equityTitle}</figcaption>
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
          className="stroke-faint"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        <polyline
          points={path}
          fill="none"
          className={last.equity >= 1 ? 'stroke-up' : 'stroke-down'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="text-xs text-muted" aria-hidden="true">
        {first.date} to {last.date} {'\u00B7'} {l.equitySummary(fmt(last.equity), fmt(low))}
      </p>
      <p className="text-xs text-muted">{l.equityNote}</p>
    </figure>
  );
}

function RunSummary({ run }: { run: LabRun }) {
  const o = run.report.outOfSample;
  const c = run.params.costs;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {l.lastRun(
          run.createdAt.slice(0, 16).replace('T', ' ') + ' UTC',
          (run.params.tickers ?? []).join(', '),
        )}
      </p>
      {o && <p>{l.trades(run.report.trades ?? 0, o.stats.n)}</p>}
      {o && o.stats.sufficient && o.expectancy.value !== null && o.expectancy.ci90 ? (
        <>
          <p>
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
      ) : (
        o && <p className="text-muted">{l.insufficient(o.stats.n)}</p>
      )}
      {o?.benchmark && <p>{l.benchmark(o.benchmark.ticker, pct(o.benchmark.ret))}</p>}
      {o?.equity && <EquityChart points={o.equity} />}
      {run.report.gate && <p>{l.gate(run.report.gate.reason)}</p>}
      {c && (
        <p className="text-xs text-muted">{l.costs(c.commissionBps, c.slippageBps, c.fxBps)}</p>
      )}
    </div>
  );
}

const EVIDENCE: Record<string, number> = {
  weak: 1,
  'weak-to-moderate': 2,
  moderate: 3,
  strong: 4,
};

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
const BADGE: Record<Stage, string> = {
  notTestable: 'bg-muted/15 text-muted',
  notRun: 'bg-muted/15 text-fg',
  draft: 'bg-muted/20 text-white',
  backtested: 'bg-up/15 text-up',
  shadow: 'bg-warn/15 text-warn',
  live: 'bg-ink text-white',
  demoted: 'bg-down/15 text-down',
};
const COUNT_TONE: Record<Stage, string> = {
  notTestable: 'text-muted',
  notRun: 'text-fg',
  draft: 'text-white',
  backtested: 'text-up',
  shadow: 'text-warn',
  live: 'text-up',
  demoted: 'text-down',
};

function stageOf(p: Playbook, rule?: LabRule): Stage {
  if (p.notTestableBecause) return 'notTestable';
  const s = rule?.status;
  return s === 'draft' || s === 'backtested' || s === 'shadow' || s === 'live' || s === 'demoted'
    ? s
    : 'notRun';
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${l.ui.months[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;
};

function PlaybookCard({ p, stage, run }: { p: Playbook; stage: Stage; run?: LabRun }) {
  const [open, setOpen] = useState(false);
  const level = EVIDENCE[p.rating] ?? 0;
  const o = run?.report.outOfSample;
  const c = run?.params.costs;
  const insufficient = !!run && !!o && !o.stats.sufficient;
  const oos = o?.stats.n ?? 0;
  const bodyId = `lab-more-${p.number}`;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="text-sm font-bold text-faint">{String(p.number).padStart(2, '0')}</span>
          <h2 className="text-base leading-[1.3] font-semibold text-white">{p.title}</h2>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap ${BADGE[stage]}`}
        >
          {l.stage[stage]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">
            {l.ui.evidenceDot(l.rating[p.rating] ?? p.rating)}
          </span>
          <span aria-hidden="true" className="flex gap-[3px]">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-[22px] rounded-[3px] ${i <= level ? 'bg-up' : 'bg-faint/25'}`}
              />
            ))}
          </span>
        </span>
        <span className="rounded-md bg-raised px-2 py-[3px] text-xs">
          {l.horizon[p.horizon] ?? p.horizon}
        </span>
      </div>
      <p className="sr-only">
        {l.meta(
          p.number,
          l.rating[p.rating] ?? p.rating,
          l.horizon[p.horizon] ?? p.horizon,
          l.stage[stage] ?? stage,
        )}
      </p>
      <p className="text-sm leading-[1.45] text-pretty text-fg">{p.summary}</p>
      {run && o ? (
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-bg p-3">
          {insufficient ? (
            <>
              <div className="flex justify-between gap-2 text-[13px]">
                <span className="font-semibold">{l.ui.insufficientHistory}</span>
                <span>{l.ui.oosOf30(oos)}</span>
              </div>
              <div aria-hidden="true" className="flex gap-0.5">
                {Array.from({ length: 30 }, (_, i) => (
                  <span
                    key={i}
                    className={`h-3.5 flex-1 rounded-[2px] ${i < oos ? 'bg-up' : 'bg-faint/20'}`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted">
                {l.ui.lastRunDate(day(run.createdAt), run.report.trades ?? 0, oos)}
              </span>
              <p className="sr-only">{l.insufficient(oos)}</p>
            </>
          ) : (
            <RunSummary run={run} />
          )}
        </div>
      ) : stage === 'notRun' ? (
        <p className="flex items-center gap-2.5 rounded-[10px] bg-bg p-3 text-[13px] text-fg">
          <Clock aria-hidden="true" size={16} className="flex-none" />
          {l.ui.queued}
        </p>
      ) : null}
      {p.notTestableBecause && (
        <p className="flex gap-2.5 rounded-[10px] border border-dashed border-muted/40 p-3 text-[13px] leading-[1.4] text-fg">
          <Lock aria-hidden="true" size={16} className="mt-0.5 flex-none" />
          <span>{p.notTestableBecause}</span>
        </p>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-1.5 self-start text-sm text-up"
      >
        {open ? l.ui.hideDetails : l.ui.showDetails}
        <ChevronDown aria-hidden="true" size={14} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2.5 border-t border-line pt-2.5 text-[13px]">
          {run && (
            <div className="grid grid-cols-2 gap-2">
              {[
                ...(c
                  ? [[l.ui.costsPerSide, l.ui.costsValue(c.commissionBps, c.slippageBps, c.fxBps)]]
                  : []),
                [l.ui.trialsCounted, '1'],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 rounded-lg bg-bg px-2.5 py-2">
                  <span className="text-[11px] text-muted">{k}</span>
                  <span className="text-[13px] font-semibold">{v}</span>
                </div>
              ))}
            </div>
          )}
          {p.rule && (
            <code className="rounded-lg bg-bg px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-fg">
              {JSON.stringify(p.rule, null, 2)}
            </code>
          )}
          <span className="text-xs text-muted">{l.sources}</span>
          {p.sources.map((src) => (
            <span key={src} className="text-xs leading-[1.4]">
              {src}
            </span>
          ))}
          {p.testOn.length > 0 && (
            <span className="text-xs text-muted">{l.ui.testedOn(p.testOn.join(', '))}</span>
          )}
        </div>
      )}
    </li>
  );
}

export function Lab() {
  const q = useQuery({ queryKey: ['lab'], queryFn: loadLab });
  const [filter, setFilter] = useState<Stage | null>(null);
  const ruleOf = (id: string) => q.data?.rules.find((r) => r.id === id);
  const runOf = (id: string) => q.data?.runs.find((r) => r.ruleId === id);
  const stages = PLAYBOOKS.map((p) => stageOf(p, ruleOf(p.id)));
  const counts = Object.fromEntries(
    STAGES.map((k) => [k, stages.filter((x) => x === k).length]),
  ) as Record<Stage, number>;
  return (
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-bold text-white">{l.title}</h1>
        <p className="text-[13px] text-muted">{l.intro(PLAYBOOKS.length)}</p>
      </div>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      <section aria-label={l.ui.lifecycle} className={`${cardClass} gap-3!`}>
        <div className="flex items-stretch gap-1.5 overflow-x-auto">
          {STAGES.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter((f) => (f === k ? null : k))}
              className={`flex min-h-16 flex-[1_0_92px] flex-col items-start gap-0.5 rounded-[10px] border-2 px-2.5 py-2 text-start text-white ${
                filter === k ? 'border-up bg-raised' : 'border-transparent bg-bg'
              }`}
            >
              <span className={`text-[22px] font-bold ${COUNT_TONE[k]}`}>{counts[k]}</span>
              <span className="text-xs whitespace-nowrap text-fg">{l.stage[k]}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{l.ui.gateNote}</p>
      </section>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-start gap-3">
        {PLAYBOOKS.map((p, i) => {
          if (filter && stages[i] !== filter) return null;
          const run = runOf(p.id);
          return (
            <PlaybookCard key={p.id} p={p} stage={stages[i] as Stage} {...(run ? { run } : {})} />
          );
        })}
      </ul>
      <section aria-labelledby="left-out" className={`${cardClass} p-5!`}>
        <h2 id="left-out" className="text-[17px] font-semibold text-white">
          {l.leftOut}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-2.5">
          {LEFT_OUT.map((x) => (
            <li key={x.title} className="flex gap-2.5 rounded-[10px] bg-bg p-3">
              <Ban aria-hidden="true" size={18} className="mt-px flex-none text-down" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{x.title}</span>
                <span className="text-[13px] text-muted">{x.why}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
