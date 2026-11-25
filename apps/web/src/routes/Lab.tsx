import { useQuery } from '@tanstack/react-query';
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

function PlaybookCard({ p, rule, run }: { p: Playbook; rule?: LabRule; run?: LabRun }) {
  const status = rule ? (l.status[rule.status] ?? rule.status) : l.status['none'];
  return (
    <li className="flex flex-col gap-2 rounded-sm border border-line p-3">
      <h2 className="font-semibold">{p.title}</h2>
      <p className="text-sm text-muted">
        {l.meta(
          p.number,
          l.rating[p.rating] ?? p.rating,
          l.horizon[p.horizon] ?? p.horizon,
          status ?? '',
        )}
      </p>
      <p className="text-sm">{p.summary}</p>
      {p.notTestableBecause ? (
        <p className="text-sm text-muted">{l.notTestable(p.notTestableBecause)}</p>
      ) : run ? (
        <RunSummary run={run} />
      ) : (
        <p className="text-sm text-muted">{l.noRun}</p>
      )}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted">{l.sources}</summary>
        <ul className="list-disc ps-5">
          {p.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
      {p.rule && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">{l.rule}</summary>
          <pre className="overflow-x-auto rounded-sm bg-raised p-2 text-xs">
            {JSON.stringify(p.rule, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

export function Lab() {
  const q = useQuery({ queryKey: ['lab'], queryFn: loadLab });
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{l.title}</h1>
        <p className="text-sm text-muted">{l.intro}</p>
      </div>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {PLAYBOOKS.map((p) => (
          <PlaybookCard
            key={p.id}
            p={p}
            {...(q.data?.rules.find((r) => r.id === p.id)
              ? { rule: q.data.rules.find((r) => r.id === p.id) as LabRule }
              : {})}
            {...(q.data?.runs.find((r) => r.ruleId === p.id)
              ? { run: q.data.runs.find((r) => r.ruleId === p.id) as LabRun }
              : {})}
          />
        ))}
      </ul>
      <section aria-labelledby="left-out" className="flex flex-col gap-2">
        <h2 id="left-out" className="font-semibold">
          {l.leftOut}
        </h2>
        <ul className="list-disc ps-5 text-sm">
          {LEFT_OUT.map((x) => (
            <li key={x.title}>
              <span className="font-medium">{x.title}.</span> {x.why}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
