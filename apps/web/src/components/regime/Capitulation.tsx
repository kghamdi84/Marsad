import { CAPITULATION_RULES, type Condition } from '@marsad/core';
import { Info } from '../Info';
import { Card, Details, ScrollX } from '../Card';
import { Pill } from '../ui/kit';
import { num, td, th, thNum } from '../study/Panel';
import { CheckRow } from './CheckRow';
import { HORIZONS, fixed, pct } from './format';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const k = r.capitulation;
const C = CAPITULATION_RULES;

function conditionValue(c: Condition): string {
  if (c.value === null) return r.noData;
  if (c.key === 'recession') return r.recession.level[String(c.value)] ?? String(c.value);
  if (c.key === 'breadth') return `${fixed(Number(c.value), 1)}%`;
  if (c.key === 'composite') return fixed(Number(c.value), 1);
  return fixed(Number(c.value), 2);
}

const needs = (key: string) => k.needs(key, C.vixMin, C.above50MaxPct, C.compositeMax);

/** The capitulation watch: the 4 conditions, the staged plan when one is running, exits and the bear case. */
export function Capitulation({ data }: { data: RegimeData }) {
  const latest = data.capitulation.latest;
  const plan = data.capitulation.plan;
  const proxy = (h: number) =>
    data.stats.find((x) => x.condition === 'vix-30-recession-not-high' && x.horizon === h);
  if (!latest)
    return (
      <Card id="capitulation" title={k.title} subtitle={k.intro}>
        <p className="text-sm text-ink3">{k.none}</p>
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
      className={on ? 'border-warn' : ''}
      aside={
        <Pill tone={on ? 'warn' : 'neutral'} className="font-semibold">
          <span data-testid="capitulation-state">{k.state[latest.state]}</span>
          {` · ${u.metCount(met)}`}
        </Pill>
      }
    >
      <ul className="flex flex-col gap-1.5">
        {latest.conditions.map((c) => (
          <CheckRow
            key={c.key}
            text={u.capNames(c.key, C.vixMin, C.above50MaxPct, C.compositeMax)}
            pill={conditionValue(c)}
            tone={c.met === true ? 'up' : 'neutral'}
            note={
              c.met === null
                ? u.why.noData
                : c.met
                  ? u.why.met
                  : `${u.why.notMet} · ${needs(c.key)}`
            }
          />
        ))}
      </ul>
      <p className="text-xs text-ink3">{u.capFoot}</p>
      <p className="text-sm text-ink2">
        {data.capitulation.lastOn ? k.lastOn(data.capitulation.lastOn) : k.neverOn}
      </p>
      {showPlan && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">{k.planTitle(plan.triggerDate)}</h3>
          <p className="text-sm text-ink3">{k.planIntro}</p>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {plan.tranches.map((tr) => (
              <li
                key={tr.step}
                className={`flex flex-col gap-1.5 rounded-[10px] border p-3 text-sm ${tr.status === 'met' ? 'border-up bg-up-soft' : 'border-line bg-elev'}`}
              >
                <span className="text-lg font-semibold text-ink">1/3</span>
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
      <p className="rounded-[10px] bg-down-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink2">
        {k.bearCase}
      </p>
      <Details>
        <Info>{k.intro}</Info>
        <ScrollX label={u.tables.conditions}>
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
        </ScrollX>
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
        <p className="text-xs text-ink3">{k.screen}</p>
        <p className="text-xs text-ink3">
          {k.rules(C.vixMin, C.above50MaxPct, C.minMembers, C.compositeMax)}
        </p>
      </Details>
    </Card>
  );
}
