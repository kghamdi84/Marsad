import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_SOURCE_POLICIES,
  PLAN_COSTS,
  actionsMinutes,
  aiSpend,
  describeSourceHealth,
  effectiveCaps,
  formatAge,
  toFixedHalfUp,
} from '@marsad/core';
import { loadPreferences } from '../lib/settings';
import {
  loadCosts,
  loadDayRuns,
  loadLatency,
  loadStatus,
  type StatusData,
  type SystemAlertRow,
} from '../lib/status';
import { useDisplay } from '../lib/display';
import { Card, ScrollX, Segmented } from '../components/Card';
import { Num, PageTitle, Pill, type Tone } from '../components/ui/kit';
import { zoneName } from '../components/Clock';
import { useView } from '../lib/view';
import { t } from '../strings';

const s = t.status;
const v = t.status.v2;

/** The heartbeat runs every 15 minutes in trading hours and every 3 hours otherwise. */
const HEARTBEAT_LATE_SEC = 4 * 3600;

function heartbeatText(at: string | null, checkedAt: string): { text: string; warn: boolean } {
  if (!at) return { text: s.heartbeatNone, warn: true };
  const sec = (new Date(checkedAt).getTime() - new Date(at).getTime()) / 1000;
  const age = formatAge(Math.max(0, sec));
  return sec > HEARTBEAT_LATE_SEC
    ? { text: s.heartbeatLate(age), warn: true }
    : { text: s.heartbeat(age), warn: false };
}

const hm = (d: Date, zone: string) =>
  d.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
const dayHm = (d: Date, zone: string) =>
  d
    .toLocaleString('en-GB', {
      timeZone: zone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
/** "25 Nov 16:02 ET". */
const etWhen = (iso: string | null) =>
  iso ? `${dayHm(new Date(iso), 'America/New_York')} ET` : s.never;
/** "25 Nov 16:02 ET · 00:02 Riyadh": New York first, then the chosen second zone. */
const dual = (iso: string | null, zone: string) =>
  iso ? `${etWhen(iso)} · ${hm(new Date(iso), zone)} ${zoneName(zone)}` : s.never;
const thousands = (n: number) => new Intl.NumberFormat('en-US').format(n);

type Fresh = 'live' | 'delayed' | 'stale' | 'unavailable';
const FRESH: Record<Fresh, { tone: Tone; note: string; border: string }> = {
  live: { tone: 'up', note: 'text-ink3', border: 'border-line' },
  delayed: { tone: 'neutral', note: 'text-ink3', border: 'border-line' },
  stale: { tone: 'warn', note: 'text-warn', border: 'border-warn' },
  unavailable: { tone: 'crit', note: 'text-crit', border: 'border-crit' },
};
const freshOf = (state: string): Fresh =>
  state === 'ok'
    ? 'live'
    : state === 'not-expected'
      ? 'delayed'
      : state === 'stale'
        ? 'stale'
        : 'unavailable';

function sourceViews(data: StatusData) {
  return data.sources.map((row) => {
    const policy = DEFAULT_SOURCE_POLICIES.find((p) => p.source === row.source);
    const view = policy
      ? describeSourceHealth(
          policy,
          row.last_message_at ? new Date(row.last_message_at) : null,
          new Date(data.checkedAt),
          data.calendar,
        )
      : null;
    return { row, view, fresh: freshOf(view ? view.state : 'never') };
  });
}

const needsLook = (f: Fresh) => f === 'stale' || f === 'unavailable';

/** The state note under a source: why it is not live (the policy's label), then the adapter's own note. */
function sourceNote({ row, view, fresh }: ReturnType<typeof sourceViews>[number]): string {
  return [fresh === 'live' ? null : view ? view.label : row.state.toUpperCase(), row.note]
    .filter(Boolean)
    .join('. ');
}

/**
 * The Supabase Cron dispatcher (ADR 0008) in one line: whether GitHub accepted the last window's starts, or why not
 * (no token, GitHub's refusal, no reply). Silence is said too: no check yet means the cron jobs are not running.
 */
function schedulerText(data: StatusData): { text: string; warn: boolean } {
  const x = data.scheduler;
  const sc = s.scheduler;
  if (!x) return { text: sc.none, warn: true };
  const age = formatAge(Math.max(0, (Date.parse(data.checkedAt) - Date.parse(x.at)) / 1000));
  const late = Date.parse(data.checkedAt) - Date.parse(x.at) > 45 * 60_000;
  const text =
    x.status === 'ok'
      ? sc.ok(x.started ?? 0, age)
      : x.status === 'skipped'
        ? sc.skipped(age)
        : sc.error(x.error ?? sc.unknown, age);
  return { text: late ? `${text} ${sc.late}` : text, warn: x.status !== 'ok' || late };
}

/** Plan costs and AI spend (from ai_usage) against the caps in force; shared by the summary row and the costs card. */
function useCosts() {
  const q = useQuery({ queryKey: ['costs'], queryFn: loadCosts });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const now = new Date();
  // The approved caps (ADR 0007 addendum), lowered by any saved in Settings: the same caps the jobs enforce.
  const caps = effectiveCaps(prefs.data?.ai ?? null);
  return {
    q,
    ai: q.data ? aiSpend(q.data.usage, now, caps) : null,
    gh: q.data ? actionsMinutes(q.data.runs, now) : null,
    total: PLAN_COSTS.reduce((n, c) => n + c.usdPerMonth, 0),
  };
}

const money = (n: number) => toFixedHalfUp(n, 2);

/** One summary row (the squeezed Watch pattern): the label on the start side, the answer and its context after. */
function SumRow({ k, onGo, children }: { k: string; onGo: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onGo}
      className="grid min-h-11 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-2 py-2 text-start text-ink hover:bg-elev"
    >
      <span className="pt-0.5 text-xs text-ink3">{k}</span>
      <span className="flex min-w-0 flex-col items-start gap-0.5 text-[13px]">{children}</span>
    </button>
  );
}

/**
 * What matters now, in five rows: how many sources are healthy and which need a look by name, the heartbeat that
 * watches them, the scheduler that starts the jobs, this month's cost and the latest system alert. Each row
 * scrolls to its detail (switching the area below when it lives there).
 */
function Summary({ data, go }: { data: StatusData; go: (target: 'sources' | DetailKey) => void }) {
  const { zone } = useDisplay();
  const x = s.squeeze;
  const views = sourceViews(data);
  const judged = views.filter((y) => y.view !== null);
  const healthy = judged.filter((y) => !needsLook(y.fresh)).length;
  const look = views.filter((y) => needsLook(y.fresh));
  const hb = heartbeatText(data.heartbeatAt, data.checkedAt);
  const sched = schedulerText(data);
  const { q, ai, total } = useCosts();
  const checked = new Date(data.checkedAt);
  const latest = data.alerts[0];
  return (
    <Card
      id="status-now"
      title={x.title}
      subtitle={
        <Num>{v.checked(hm(checked, 'America/New_York'), hm(checked, zone), zoneName(zone))}</Num>
      }
    >
      <div className="-mx-2 grid grid-cols-1 gap-x-6 tablet:grid-cols-2">
        <SumRow k={x.sources} onGo={() => go('sources')}>
          {judged.length > 0 && (
            <Pill tone={healthy === judged.length ? 'up' : 'warn'} className="font-semibold">
              {s.hero.title(healthy, judged.length)}
            </Pill>
          )}
          <span className={look.length ? 'text-warn' : 'text-ink3'}>
            {look.length
              ? x.needLook(
                  look.map((y) => x.lookPart(y.row.display_name, x.lookState[y.fresh] ?? y.fresh)),
                )
              : x.allLooked}
          </span>
        </SumRow>
        <SumRow k={x.heartbeat} onGo={() => go('jobs')}>
          <span className={hb.warn ? 'text-warn' : 'text-ink2'}>{hb.text}</span>
        </SumRow>
        <SumRow k={x.scheduler} onGo={() => go('jobs')}>
          <span className={sched.warn ? 'text-warn' : 'text-ink2'}>{sched.text}</span>
        </SumRow>
        <SumRow k={x.month} onGo={() => go('costs')}>
          <span className={ai && !ai.budget ? 'text-warn' : 'text-ink2'}>
            {ai
              ? x.monthValue(money(total), ai.budget ? x.aiSoFar(money(ai.monthUsd)) : x.aiOff)
              : q.isError
                ? v.unavailable
                : t.loading}
          </span>
        </SumRow>
        <SumRow k={x.alerts} onGo={() => go('alerts')}>
          <span className="text-ink2">
            {latest ? (
              <Num>
                {x.alertsLatest(
                  data.alerts.length,
                  s.eventsDesign[latest.event] ?? latest.event,
                  dual(latest.created_at, zone),
                )}
              </Num>
            ) : (
              x.alertsNone
            )}
          </span>
        </SumRow>
      </div>
    </Card>
  );
}

/**
 * Every source: the ones that need a look (stale or unavailable) as full cards with their note, then each healthy
 * source as one short row whose tier, latency, both clocks and note are one tap away.
 */
function Sources({ data }: { data: StatusData }) {
  const { zone } = useDisplay();
  const d = s.design;
  const x = s.squeeze;
  const views = sourceViews(data);
  const look = views.filter((y) => needsLook(y.fresh));
  const ok = views.filter((y) => !needsLook(y.fresh));
  const latency = (ms: number | null) => (ms === null ? v.latencyNone : v.latencyMs(thousands(ms)));
  return (
    <Card
      id="src-h"
      title={v.sourcesHeading}
      subtitle={look.length ? x.sourcesLook(look.length, views.length) : x.sourcesOk(views.length)}
    >
      {look.length > 0 && (
        <ul
          aria-label={x.lookList}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3"
        >
          {look.map((y) => {
            const { row, fresh } = y;
            const note = sourceNote(y);
            return (
              <li
                key={row.source}
                className={`flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3.5 ${FRESH[fresh].border}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{row.display_name}</span>
                  <Pill tone={FRESH[fresh].tone} className="font-semibold">
                    {d.fresh[fresh]}
                  </Pill>
                </span>
                <span className="flex items-start justify-between gap-2 text-xs text-ink2">
                  <span>
                    <span className="sr-only">{d.last} </span>
                    {v.tierWhen(row.plan_tier, etWhen(row.last_message_at))}
                  </span>
                  <span className="flex-none tabular-nums">
                    <span className="sr-only">{d.latency} </span>
                    {latency(row.last_latency_ms)}
                  </span>
                </span>
                {note && <span className={`text-xs ${FRESH[fresh].note}`}>{note}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {ok.length > 0 && (
        <ul aria-label={x.okList} className="-mx-2 grid grid-cols-1 gap-x-6 tablet:grid-cols-2">
          {ok.map((y) => {
            const { row, fresh } = y;
            const note = sourceNote(y);
            return (
              <li key={row.source} className="min-w-0 border-b border-line">
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 select-none hover:bg-elev [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden="true"
                      className="flex-none text-[10px] text-ink3 group-open:rotate-90"
                    >
                      {'▸'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {row.display_name}
                    </span>
                    <span className="flex-none text-xs text-ink3 tabular-nums">
                      <span className="sr-only">{d.last} </span>
                      {etWhen(row.last_message_at)}
                    </span>
                    <Pill tone={FRESH[fresh].tone} className="flex-none font-semibold">
                      {d.fresh[fresh]}
                    </Pill>
                  </summary>
                  <div className="flex flex-col gap-1 px-2 pb-2.5 ps-7 text-xs text-ink2">
                    <span>{x.tier(row.plan_tier)}</span>
                    <span>
                      <Num>{x.last(dual(row.last_message_at, zone))}</Num>
                    </span>
                    <span className="tabular-nums">{x.latency(latency(row.last_latency_ms))}</span>
                    {note && <span className="text-ink3">{note}</span>}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const TICK: Record<string, string> = {
  ok: 'bg-up',
  skipped: 'bg-ink3',
  error: 'bg-crit',
  running: 'bg-warn',
};

/** One strip per job over the last 24 hours, a tick at each run, coloured by outcome (and said in words). */
function JobStrips() {
  const q = useQuery({ queryKey: ['day-runs'], queryFn: loadDayRuns, refetchInterval: 60_000 });
  const x = s.strips;
  const { zone } = useDisplay();
  const data = q.data;
  const start = data ? Date.parse(data.since) : 0;
  const span = data ? Date.parse(data.now) - start : 1;
  const jobs = data ? [...new Set(data.runs.map((r) => r.job))].sort() : [];
  const lastErr = data?.runs.filter((r) => r.status === 'error' && r.error).at(-1);
  const axis = (ms: number) => hm(new Date(ms), 'America/New_York');
  const cols = 'grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_70px] items-center gap-2.5';
  return (
    <Card
      id="h-jobs"
      title={s.jobs}
      aside={<span className="text-xs text-ink3">{v.jobsLegend}</span>}
    >
      {q.isError && (
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      )}
      {data && jobs.length === 0 && <p className="text-sm text-ink3">{x.none}</p>}
      {data && jobs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const runs = data.runs.filter((r) => r.job === job);
            const n = (st: string) => runs.filter((r) => r.status === st).length;
            const bad = n('error');
            const skipped = n('skipped');
            const summary =
              bad > 0 ? x.sumError(bad) : skipped > 0 ? x.sumSkipped(skipped) : x.sumOk(n('ok'));
            return (
              <li key={job} className={`${cols} text-xs`}>
                <span className="truncate font-mono text-ink2" title={job}>
                  {job}
                </span>
                <span
                  role="img"
                  aria-label={x.aria(job, runs.length, bad, skipped)}
                  className="relative h-3.5 rounded bg-sub"
                >
                  {runs.map((r, i) => (
                    <span
                      key={`${r.started_at}-${i}`}
                      title={dual(r.started_at, zone)}
                      className={`absolute top-0.5 bottom-0.5 -ms-0.5 w-[5px] rounded-[2px] ${TICK[r.status] ?? 'bg-ink3'}`}
                      style={{
                        insetInlineStart: `${Math.min(99, Math.max(0, ((Date.parse(r.started_at) - start) / span) * 100)).toFixed(2)}%`,
                      }}
                    />
                  ))}
                </span>
                <span
                  className={`text-end ${bad > 0 ? 'text-crit' : skipped > 0 ? 'text-ink2' : 'text-ink3'}`}
                >
                  {summary}
                </span>
              </li>
            );
          })}
          <li className={`${cols} text-[11px] text-ink3`} aria-hidden="true">
            <span />
            <span className="flex justify-between gap-1">
              <span>{x.axisStart(axis(start))}</span>
              <span>{x.axisMid(axis(start + span / 2))}</span>
              <span>{x.axisNow}</span>
            </span>
            <span />
          </li>
        </ul>
      )}
      {lastErr?.error && (
        <span className="text-xs text-crit">
          {x.latestError(lastErr.job, hm(new Date(lastErr.started_at), 'UTC'), lastErr.error)}
        </span>
      )}
    </Card>
  );
}

/** A spend bar against a cap with the 80% warning tick. */
function CapBar({ label, pct }: { label: string; pct: number }) {
  const x = s.capBars;
  const width = Math.min(100, Math.max(0, pct));
  const tone = pct >= 100 ? 'bg-crit' : pct >= 80 ? 'bg-warn' : 'bg-up';
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between gap-2 text-xs">
        <span className="text-ink2">{label}</span>
        <span className="text-ink3 tabular-nums">{x.pct(toFixedHalfUp(pct, 0))}</span>
      </span>
      <span aria-hidden="true" className="relative h-1.5 rounded-full bg-sub">
        <span
          className={`absolute inset-y-0 start-0 rounded-full ${tone}`}
          style={{ width: `${width}%` }}
        />
        <span className="absolute -top-1 start-[80%] h-3.5 w-0.5 bg-ink" />
      </span>
    </div>
  );
}

/** One label and value row with an optional note, as in the design's costs card. */
function CostRow({
  k,
  value,
  tone = 'text-ink',
  note,
  children,
}: {
  k: string;
  value: string;
  tone?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line py-2.5">
      <span className="text-sm text-ink2">{k}</span>
      <span className={`text-end text-sm font-semibold whitespace-nowrap ${tone}`}>{value}</span>
      {note && <span className="col-span-2 text-xs text-ink3">{note}</span>}
      {children && <div className="col-span-2 flex flex-col gap-2 pt-1">{children}</div>}
    </li>
  );
}

function Costs() {
  const { q, ai, gh, total } = useCosts();
  return (
    <Card
      id="h-cost"
      title={v.costsTitle}
      aside={
        <span className="font-semibold text-ink tabular-nums">
          ${money(total)} <span className="text-xs font-normal text-ink3">{s.design.aMonth}</span>
        </span>
      }
    >
      {q.isError && (
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      )}
      <ul className="-mt-1 flex flex-col [&>li:first-child]:border-t-0">
        {PLAN_COSTS.map((c) => {
          if (c.service === 'Anthropic API')
            return (
              <CostRow
                key={c.service}
                k={c.service}
                value={
                  !ai
                    ? q.isError
                      ? v.unavailable
                      : t.loading
                    : ai.budget
                      ? v.aiMonth(money(ai.monthUsd))
                      : v.aiOff
                }
                tone={ai && !ai.budget ? 'text-warn' : ai ? 'text-ink' : 'text-ink3'}
                {...(ai
                  ? {
                      note: ai.budget
                        ? s.design.aiSpendValue(money(ai.todayUsd), money(ai.monthUsd), ai.calls)
                        : s.design.aiOffWarn,
                    }
                  : {})}
              >
                {ai?.budget && (
                  <>
                    <span
                      className={`text-xs ${ai.budget.state === 'ok' ? 'text-ink3' : 'text-warn'}`}
                    >
                      {s.aiBudget(
                        ai.budget.message,
                        String(ai.budget.dailyPct),
                        String(ai.budget.monthlyPct),
                      )}
                    </span>
                    <CapBar label={s.capBars.daily} pct={ai.budget.dailyPct} />
                    <CapBar label={s.capBars.monthly} pct={ai.budget.monthlyPct} />
                    <p className="text-xs text-ink3">{s.capBars.tick}</p>
                  </>
                )}
              </CostRow>
            );
          if (c.service === 'GitHub Actions')
            return (
              <CostRow
                key={c.service}
                k={c.service}
                value={gh ? v.actionsValue(gh.minutes) : q.isError ? v.unavailable : t.loading}
                tone={gh ? 'text-ink' : 'text-ink3'}
                note={`${gh ? `${v.actionsNote(gh.runs)}. ` : ''}${v.planValue(c.plan, money(c.usdPerMonth))}`}
              />
            );
          return (
            <CostRow
              key={c.service}
              k={c.service}
              value={v.planValue(c.plan, money(c.usdPerMonth))}
              note={c.note}
            />
          );
        })}
      </ul>
    </Card>
  );
}

const EVENT_TONE: Record<SystemAlertRow['event'], Tone> = {
  stale: 'warn',
  mismatch: 'neutral',
  recovered: 'up',
};

function SystemAlerts({ data }: { data: StatusData | undefined }) {
  const { zone } = useDisplay();
  return (
    <Card id="sa-h" title={s.alerts}>
      {data && data.alerts.length === 0 && <p className="text-sm text-ink3">{s.noAlerts}</p>}
      {data && data.alerts.length > 0 && (
        <ul className="-mt-1 flex flex-col">
          {data.alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0"
            >
              <Pill tone={EVENT_TONE[a.event]} className="mt-0.5 flex-none font-semibold">
                {s.eventsDesign[a.event]}
              </Pill>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm text-ink">{a.headline}</span>
                <span className="text-xs text-ink3">
                  <Num>{dual(a.created_at, zone)}</Num>
                </span>
                {a.paused_rules.length > 0 && (
                  <span className="text-xs text-ink3">
                    {s.design.paused(a.paused_rules.join(', '))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const th = 'border-b border-line px-2 py-2 text-start font-medium text-ink3';
// A header over right-aligned numbers: text-start on `th` would fight text-end, so this has no text-start.
const thEnd = 'border-b border-line px-2 py-2 text-end font-medium text-ink3';
const td = 'border-b border-line px-2 py-2 align-top';

function Latency() {
  const q = useQuery({ queryKey: ['latency'], queryFn: loadLatency });
  return (
    <Card id="lat-h" title={v.latencyTitle} subtitle={s.latencyIntro}>
      {q.isError && (
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      )}
      {q.data && q.data.length === 0 && <p className="text-sm text-ink3">{s.noLatency}</p>}
      {q.data && q.data.length > 0 && (
        <ScrollX label={s.latency}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{s.colKind}</th>
                <th className={thEnd}>{s.colN}</th>
                <th className={thEnd}>{s.colMedian}</th>
                <th className={thEnd}>{s.colP90}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((x) => (
                <tr key={x.kind}>
                  <td className={td}>{x.kind}</td>
                  <td className={`${td} text-end tabular-nums`}>{x.n}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatAge(x.median / 1000)}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatAge(x.p90 / 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
    </Card>
  );
}

const DETAIL_TABS = ['jobs', 'costs', 'alerts', 'latency'] as const;
type DetailKey = (typeof DETAIL_TABS)[number];

/**
 * Status (Marsad v2, squeezed): a summary card first (healthy sources and the ones that need a look, heartbeat,
 * scheduler, this month's cost, the latest system alert), then every source (healthy ones as one short row each),
 * then one switchable area for job runs, costs and caps, system alerts and alert latency. Nothing is dropped:
 * every view is one tap away and the choice is remembered on this device.
 */
export function Status() {
  const q = useQuery({ queryKey: ['status'], queryFn: loadStatus, refetchInterval: 30_000 });
  const [tab, setTab] = useView('marsad.status.detail', DETAIL_TABS, 'jobs');
  const x = s.squeeze;
  const go = (target: 'sources' | DetailKey) => {
    if (target !== 'sources') setTab(target);
    requestAnimationFrame(() =>
      document
        .getElementById(target === 'sources' ? 'status-sources' : 'status-details')
        ?.scrollIntoView({
          block: 'start',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        }),
    );
  };
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="status" />
      {q.data ? (
        <>
          <Summary data={q.data} go={go} />
          <div id="status-sources" className="scroll-mt-4">
            <Sources data={q.data} />
          </div>
        </>
      ) : (
        <p role="status" className={`text-sm ${q.isError ? 'text-crit' : 'text-ink3'}`}>
          {q.isError ? s.dbError(q.error.message) : t.loading}
        </p>
      )}
      <div id="status-details" className="flex scroll-mt-4 flex-col gap-2.5">
        <Segmented
          label={x.detailLabel}
          options={DETAIL_TABS.map((key) => ({ key, label: x.detail[key] ?? key }))}
          value={tab}
          onChange={setTab}
        />
        {tab === 'jobs' && <JobStrips />}
        {tab === 'costs' && <Costs />}
        {tab === 'alerts' && <SystemAlerts data={q.data} />}
        {tab === 'latency' && <Latency />}
      </div>
    </div>
  );
}
