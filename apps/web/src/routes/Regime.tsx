import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BREADTH_VERSION,
  CAPITULATION_RULES,
  COMPONENT_SOURCES,
  type ComponentKey,
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
import { t } from '../strings';

const r = t.regime;
const fixed = (v: number, d = 2) => toFixedHalfUp(v, d);
const signed = (v: number, d = 2) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v, d)}`;
const pct = (v: number, d = 1) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, d)}%`;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One measure per row: latest value, change over a month, one-year percentile and the date of the value. */
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

function LabelSection({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  const run = currentRun(data.days);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of data.days) c[d.label] = (c[d.label] ?? 0) + 1;
    return c;
  }, [data.days]);
  if (!last || !run) return <p className="text-muted">{r.none}</p>;
  const x = last.inputs;
  const tone =
    last.label === 'stress' || last.label === 'bear'
      ? 'text-down'
      : last.label.startsWith('bull')
        ? 'text-up'
        : '';
  return (
    <Section id="label" title={r.labelTitle}>
      <p className={`text-2xl font-semibold ${tone}`}>{r.labels[last.label] ?? last.label}</p>
      <p>{r.reasons[last.reason] ?? last.reason}</p>
      <p className="text-sm text-muted">{r.asOf(last.date, last.ruleVersion)}</p>
      <p className="text-sm">{r.since(run.since, run.sessions)}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">{r.inputs.sp500}</dt>
          <dd className="font-medium">{fixed(x.sp500)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.sma50}</dt>
          <dd className="font-medium">{x.sma50 === null ? '' : fixed(x.sma50)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.sma200}</dt>
          <dd className="font-medium">
            {x.sma200 === null ? '' : fixed(x.sma200)}
            {x.sma200 !== null && x.sma200Prior !== null && (
              <span className="ms-1 text-xs text-muted">
                {x.sma200 < x.sma200Prior ? r.inputs.falling : r.inputs.rising}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.drawdown}</dt>
          <dd className="font-medium">{x.drawdown === null ? '' : pct(x.drawdown)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.vix}</dt>
          <dd className="font-medium">{x.vix === null ? '' : fixed(x.vix)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.vix3m}</dt>
          <dd className="font-medium">{x.vix3m === null ? '' : fixed(x.vix3m)}</dd>
        </div>
        <div>
          <dt className="text-muted">{r.inputs.ratio}</dt>
          <dd className="font-medium">
            {x.vix === null || x.vix3m === null ? '' : fixed(x.vix / x.vix3m, 3)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">{r.inputsSource}</p>
      <h3 className="mt-2 text-sm font-medium">{r.pastYear}</h3>
      <p className="text-sm">
        {Object.entries(counts)
          .map(([k, v]) => `${r.labels[k] ?? k} ${v}`)
          .join(', ')}
      </p>
    </Section>
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

function RecessionSection({ data }: { data: RegimeData }) {
  const last = data.days.at(-1);
  if (!last) return null;
  const rec = r.recession;
  return (
    <Section id="recession" title={rec.title}>
      <p className="text-lg font-semibold">
        {rec.level[last.recessionLevel] ?? last.recessionLevel}
      </p>
      <p className="text-sm">{rec.summary(last.available, last.triggered)}</p>
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
    </Section>
  );
}

function BreadthSection({ data }: { data: RegimeData }) {
  const b = r.breadth;
  const last = data.breadth.at(-1);
  if (!last)
    return (
      <Section id="breadth" title={b.title}>
        <p className="text-sm text-muted">{b.intro}</p>
        <p className="text-muted">{b.none}</p>
      </Section>
    );
  const now = breadthReading(last);
  const monthAgoDay = data.breadth.at(-22);
  const before = monthAgoDay ? breadthReading(monthAgoDay) : null;
  const lastThrust = [...data.breadth].reverse().find((d) => d.zweigThrust);
  const pctText = (v: number | null) => (v === null ? r.noData : `${fixed(v, 1)}%`);
  return (
    <Section id="breadth" title={b.title}>
      <p className="text-sm text-muted">{b.intro}</p>
      <p className="text-sm">{b.asOf(last.date, last.members)}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{b.above50}</dt>
          <dd className="text-lg font-medium">{pctText(now.pctAbove50)}</dd>
          <dd className="text-xs text-muted">
            {b.outOf(last.n50)}
            {before?.pctAbove50 != null ? `; ${b.monthAgo(pctText(before.pctAbove50))}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{b.above200}</dt>
          <dd className="text-lg font-medium">{pctText(now.pctAbove200)}</dd>
          <dd className="text-xs text-muted">
            {b.outOf(last.n200)}
            {before?.pctAbove200 != null ? `; ${b.monthAgo(pctText(before.pctAbove200))}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{b.netHighs}</dt>
          <dd className="text-lg font-medium">{signed(now.netNewHighs, 0)}</dd>
          <dd className="text-xs text-muted">
            {b.highsLows(last.newHighs, last.newLows)}; {b.outOf(last.n252)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{b.advDec}</dt>
          <dd className="text-lg font-medium">{b.advDecValue(last.advancers, last.decliners)}</dd>
          <dd className="text-xs text-muted">
            {b.upVolume}: {pctText(now.upVolumePct)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{b.avg10}</dt>
          <dd className="text-lg font-medium">
            {last.advanceAvg10 === null ? r.noData : fixed(last.advanceAvg10, 3)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{b.mcclellan}</dt>
          <dd className="text-lg font-medium">
            {last.mcclellanOscillator === null
              ? r.noData
              : `${signed(last.mcclellanOscillator, 3)} (${last.mcclellanSummation === null ? '' : signed(last.mcclellanSummation, 2)})`}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">{b.zweig}</dt>
          <dd className="font-medium">{lastThrust ? b.zweigLast(lastThrust.date) : b.zweigNone}</dd>
          <dd className="text-xs text-muted">{b.zweigRule}</dd>
        </div>
      </dl>
      {last.suspect > 0 && <p className="text-sm text-muted">{b.suspect(last.suspect)}</p>}
      <p className="text-xs text-muted">{b.warmup}</p>
      <p className="text-xs text-muted">{b.source(`${UNIVERSE_VERSION}, ${BREADTH_VERSION}`)}</p>
    </Section>
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

function FearGreedSection({ data }: { data: RegimeData }) {
  const f = r.fearGreed;
  const withComposite = data.fearGreed.filter((d) => d.composite !== null);
  const last = withComposite.at(-1);
  const newest = data.fearGreed.at(-1);
  if (!last || last.composite === null)
    return (
      <Section id="fear-greed" title={f.title}>
        <p className="text-sm text-muted">{f.intro}</p>
        <p className="text-muted">{f.none}</p>
        {newest && <p className="text-sm text-muted">{f.newer(newest.date, newest.available)}</p>}
      </Section>
    );
  const monthAgo: StoredFearGreedDay | undefined = withComposite.at(-22);
  return (
    <Section id="fear-greed" title={f.title}>
      <p className="text-sm text-muted">{f.intro}</p>
      <p className="text-2xl font-semibold" data-testid="fear-greed-value">
        {f.headline(Math.round(last.composite), f.labels[last.label ?? ''] ?? '')}
      </p>
      <p className="text-sm">
        {f.count(last.available)}. {f.asOf(last.date, last.version)}
      </p>
      {newest && newest.date !== last.date && (
        <p className="text-sm text-muted">{f.newer(newest.date, newest.available)}</p>
      )}
      {monthAgo?.composite != null && (
        <p className="text-sm text-muted">
          {f.monthAgo(Math.round(monthAgo.composite), monthAgo.date)}
        </p>
      )}
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
      <p className="text-xs text-muted">{f.bands}</p>
      <p className="text-xs text-muted">{f.method}</p>
    </Section>
  );
}

function conditionValue(c: Condition): string {
  if (c.value === null) return r.noData;
  if (c.key === 'recession') return r.recession.level[String(c.value)] ?? String(c.value);
  if (c.key === 'breadth') return `${fixed(Number(c.value), 1)}%`;
  if (c.key === 'composite') return fixed(Number(c.value), 1);
  return fixed(Number(c.value), 2);
}

function CapitulationSection({ data }: { data: RegimeData }) {
  const k = r.capitulation;
  const latest = data.capitulation.latest;
  const plan = data.capitulation.plan;
  const proxy = (h: number) =>
    data.stats.find((x) => x.condition === 'vix-30-recession-not-high' && x.horizon === h);
  if (!latest)
    return (
      <Section id="capitulation" title={k.title}>
        <p className="text-sm text-muted">{k.intro}</p>
        <p className="text-muted">{k.none}</p>
      </Section>
    );
  const showPlan = plan !== null && !plan.expired;
  return (
    <Section id="capitulation" title={k.title}>
      <p className="text-sm text-muted">{k.intro}</p>
      <p className="text-2xl font-semibold" data-testid="capitulation-state">
        {k.state[latest.state]}
      </p>
      <p className="text-sm">
        {k.asOf(latest.date, latest.version)}{' '}
        {data.capitulation.lastOn ? k.lastOn(data.capitulation.lastOn) : k.neverOn}
      </p>
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
                <td className={td}>
                  {k.needs(
                    c.key,
                    CAPITULATION_RULES.vixMin,
                    CAPITULATION_RULES.above50MaxPct,
                    CAPITULATION_RULES.compositeMax,
                  )}
                </td>
                <td className={td}>{k.met[String(c.met)]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showPlan && (
        <div className="flex flex-col gap-2 rounded-sm border border-line p-3">
          <h3 className="font-semibold">{k.planTitle(plan.triggerDate)}</h3>
          <p className="text-sm text-muted">{k.planIntro}</p>
          <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
            {plan.tranches.map((tr) => (
              <li key={tr.step}>
                {k.steps[tr.step]?.(tr.level === null ? r.noData : fixed(tr.level, 2))}{' '}
                <span className="text-muted">
                  {tr.status === 'met' && tr.date
                    ? k.status.met(tr.date)
                    : k.status[tr.status === 'met' ? 'waiting' : tr.status]}
                </span>
              </li>
            ))}
          </ol>
          {plan.pausedOn && <p className="text-sm">{k.paused(plan.pausedOn)}</p>}
          {plan.reviewOn && <p className="text-sm">{k.review(plan.reviewOn)}</p>}
          <p className="text-sm">{k.exit}</p>
          <p className="text-sm">{k.bearCase}</p>
        </div>
      )}
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
      {!showPlan && <p className="text-xs text-muted">{k.bearCase}</p>}
      <p className="text-xs text-muted">{k.screen}</p>
      <p className="text-xs text-muted">
        {k.rules(
          CAPITULATION_RULES.vixMin,
          CAPITULATION_RULES.above50MaxPct,
          CAPITULATION_RULES.minMembers,
          CAPITULATION_RULES.compositeMax,
        )}
      </p>
    </Section>
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
const HORIZONS = [21, 63, 126];

function StudySection({ data }: { data: RegimeData }) {
  const s = r.study;
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
  return (
    <Section id="study" title={s.title}>
      <p className="text-sm text-muted">{s.note(any.dataFrom, any.dataTo)}</p>
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
                        : x.sufficient && x.median !== null && x.q1 !== null && x.q3 !== null
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
    </Section>
  );
}

export function Regime() {
  const q = useQuery({ queryKey: ['regime'], queryFn: loadRegime });
  const v = r.volatility;
  const c = r.credit;
  const u = r.uncertainty;
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{r.title}</h1>
        <p className="text-sm text-muted">{r.intro}</p>
      </div>
      {q.isPending && <p className="text-muted">{t.loading}</p>}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          <LabelSection data={q.data} />
          <RecessionSection data={q.data} />
          <BreadthSection data={q.data} />
          <FearGreedSection data={q.data} />
          <CapitulationSection data={q.data} />
          <StudySection data={q.data} />
          <Section id="volatility" title={v.title}>
            <SnapshotTable
              rows={[
                { label: v.vix, obs: q.data.series['VIXCLS'] ?? [] },
                { label: v.vix3m, obs: q.data.series['VXVCLS'] ?? [] },
              ]}
            />
            <p className="text-sm text-muted">
              {v.contango} {v.backwardation}
            </p>
            <p className="text-xs text-muted">{v.source}</p>
          </Section>
          <Section id="credit" title={c.title}>
            <SnapshotTable
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
            />
            <p className="text-xs text-muted">{c.source}</p>
          </Section>
          <Section id="uncertainty" title={u.title}>
            <SnapshotTable
              rows={[
                { label: u.gpr, obs: q.data.gpr, digits: 1 },
                { label: u.epu, obs: q.data.series['USEPUINDXD'] ?? [], digits: 1 },
              ]}
            />
            <p className="text-xs text-muted">{u.source}</p>
          </Section>
        </>
      )}
    </section>
  );
}
