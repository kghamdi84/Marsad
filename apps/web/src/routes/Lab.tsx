import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Lock } from 'lucide-react';
import { Details, Segmented, cardClass } from '../components/Card';
import { panelTitle } from '../components/study/Panel';
import { LEFT_OUT, PLAYBOOKS, toFixedHalfUp, type Playbook } from '@marsad/core';
import { loadLab, type LabRule, type LabRun } from '../lib/lab';
import { t } from '../strings';

const l = t.lab;
const pct = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, 2)}%`;

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
const STATUS_TONE: Record<string, string> = {
  live: 'bg-up/15 text-up',
  shadow: 'bg-warn/15 text-warn',
  backtested: 'bg-muted/15 text-fg',
  draft: 'bg-muted/15 text-fg',
  demoted: 'border border-down/60 text-down',
  none: 'bg-muted/10 text-muted',
};

function PlaybookCard({ p, rule, run }: { p: Playbook; rule?: LabRule; run?: LabRun }) {
  const key = rule?.status ?? 'none';
  const status = l.status[key] ?? key;
  const level = EVIDENCE[p.rating] ?? 0;
  return (
    <li className={`${cardClass} gap-3!`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 flex-none items-center justify-center rounded-full bg-raised text-sm font-bold text-white"
        >
          {p.number}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-[1.0625rem] leading-snug font-semibold text-white">{p.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[key] ?? STATUS_TONE['none']}`}
            >
              {status}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-fg">
              {l.horizon[p.horizon] ?? p.horizon}
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden="true" className="flex gap-0.5">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-2 w-3 rounded-sm ${i <= level ? 'bg-up' : 'bg-faint/25'}`}
                  />
                ))}
              </span>
              {l.ui.evidence(l.rating[p.rating] ?? p.rating)}
            </span>
          </div>
        </div>
      </div>
      <p className="sr-only">
        {l.meta(
          p.number,
          l.rating[p.rating] ?? p.rating,
          l.horizon[p.horizon] ?? p.horizon,
          status,
        )}
      </p>
      <p className="text-sm leading-snug text-fg">{p.summary}</p>
      {p.notTestableBecause ? (
        <p className="flex gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-muted">
          <Lock aria-hidden="true" size={16} className="mt-0.5 flex-none" />
          <span>{l.notTestable(p.notTestableBecause)}</span>
        </p>
      ) : run ? (
        <div className="rounded-xl bg-bg/45 p-3">
          <RunSummary run={run} />
        </div>
      ) : (
        <p className="text-sm text-muted">{l.noRun}</p>
      )}
      <Details>
        <h3 className="text-[0.8125rem] font-bold text-muted">{l.sources}</h3>
        <ul className="list-disc ps-5 text-sm">
          {p.sources.map((src) => (
            <li key={src}>{src}</li>
          ))}
        </ul>
        {p.rule && (
          <>
            <h3 className="text-[0.8125rem] font-bold text-muted">{l.rule}</h3>
            <pre className="overflow-x-auto rounded-lg bg-bg p-2 text-xs">
              {JSON.stringify(p.rule, null, 2)}
            </pre>
          </>
        )}
      </Details>
    </li>
  );
}

type Filter = 'all' | 'testable' | 'untestable';

export function Lab() {
  const q = useQuery({ queryKey: ['lab'], queryFn: loadLab });
  const [filter, setFilter] = useState<Filter>('all');
  const ruleOf = (id: string) => q.data?.rules.find((r) => r.id === id);
  const runOf = (id: string) => q.data?.runs.find((r) => r.ruleId === id);
  const counts: Record<string, number> = {};
  for (const r of q.data?.rules ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const untestable = PLAYBOOKS.filter((p) => p.notTestableBecause).length;
  const notRun = PLAYBOOKS.filter((p) => !p.notTestableBecause && !runOf(p.id)).length;
  const shown = PLAYBOOKS.filter((p) =>
    filter === 'all'
      ? true
      : filter === 'testable'
        ? !p.notTestableBecause
        : !!p.notTestableBecause,
  );
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{l.title}</h1>
        <p className="text-sm text-muted">{l.intro}</p>
      </div>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      <section aria-label={l.ui.lifecycle} className="flex flex-col gap-2">
        <ol className="grid grid-cols-5 gap-1.5">
          {(['draft', 'backtested', 'shadow', 'live', 'demoted'] as const).map((k) => (
            <li
              key={k}
              className={`flex flex-col items-center gap-0.5 rounded-xl p-2 text-center ${
                (counts[k] ?? 0) > 0 ? 'bg-raised' : 'bg-surface'
              }`}
            >
              <span className="text-lg font-bold text-white tabular-nums">{counts[k] ?? 0}</span>
              <span className="text-[0.6875rem] text-muted">{l.status[k]}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">
          {l.ui.notTestableN(untestable)} {'\u00B7'} {l.ui.notRunN(notRun)}
        </p>
      </section>
      <Segmented
        label={l.ui.filter}
        options={(['all', 'testable', 'untestable'] as const).map((k) => ({
          key: k,
          label: l.ui.filters[k] ?? k,
        }))}
        value={filter}
        onChange={setFilter}
      />
      <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
        {shown.map((p) => {
          const rule = ruleOf(p.id);
          const run = runOf(p.id);
          return (
            <PlaybookCard key={p.id} p={p} {...(rule ? { rule } : {})} {...(run ? { run } : {})} />
          );
        })}
      </ul>
      <section aria-labelledby="left-out" className={`${cardClass} gap-3!`}>
        <h2 id="left-out" className={panelTitle}>
          {l.leftOut}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {LEFT_OUT.map((x) => (
            <li key={x.title} className="flex gap-2">
              <Ban aria-hidden="true" size={16} className="mt-0.5 flex-none text-down" />
              <span>
                <span className="font-medium text-white">{x.title}.</span> {x.why}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
