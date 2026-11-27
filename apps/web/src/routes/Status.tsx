import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_SOURCE_POLICIES,
  PLAN_COSTS,
  actionsMinutes,
  aiSpend,
  describeSourceHealth,
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
import { Card, ScrollX } from '../components/Card';
import { Num, PageTitle, Pill, type Tone } from '../components/ui/kit';
import { zoneName } from '../components/Clock';
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

/** "N of M sources healthy" (healthy: live, or quiet by design); stale or unavailable sources turn it yellow. */
function HealthyPill({ data }: { data: StatusData }) {
  const views = sourceViews(data).filter((x) => x.view !== null);
  if (views.length === 0) return null;
  const healthy = views.filter((x) => x.fresh === 'live' || x.fresh === 'delayed').length;
  return (
    <Pill tone={healthy === views.length ? 'up' : 'warn'} className="px-3! py-1! font-semibold">
      {s.hero.title(healthy, views.length)}
    </Pill>
  );
}

/** When the page checked, which sources are stale and whether the heartbeat that watches them is running. */
function CheckLine({ data }: { data: StatusData }) {
  const { zone } = useDisplay();
  const hb = heartbeatText(data.heartbeatAt, data.checkedAt);
  const checked = new Date(data.checkedAt);
  const stale = sourceViews(data).filter((x) => x.fresh === 'stale');
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <span className="text-ink3">
        <Num>{v.checked(hm(checked, 'America/New_York'), hm(checked, zone), zoneName(zone))}</Num>
      </span>
      {stale.length > 0 && (
        <span className="text-warn">{s.hero.stale(stale.map((x) => x.row.display_name))}</span>
      )}
      <span role="status" className={hb.warn ? 'text-warn' : 'text-ink3'}>
        {hb.text}
      </span>
    </div>
  );
}

function Sources({ data }: { data: StatusData }) {
  const d = s.design;
  return (
    <section aria-labelledby="src-h" className="flex flex-col gap-2">
      <h2 id="src-h" className="sr-only">
        {v.sourcesHeading}
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3">
        {sourceViews(data).map(({ row, view, fresh }) => {
          const note = [
            fresh === 'live' ? null : view ? view.label : row.state.toUpperCase(),
            row.note,
          ]
            .filter(Boolean)
            .join('. ');
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
                  {row.last_latency_ms === null
                    ? v.latencyNone
                    : v.latencyMs(thousands(row.last_latency_ms))}
                </span>
              </span>
              {note && <span className={`text-xs ${FRESH[fresh].note}`}>{note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
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
  const q = useQuery({ queryKey: ['costs'], queryFn: loadCosts });
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  const now = new Date();
  const caps =
    prefs.data?.ai.dailyUsd != null && prefs.data.ai.monthlyUsd != null
      ? { dailyUsd: prefs.data.ai.dailyUsd, monthlyUsd: prefs.data.ai.monthlyUsd }
      : null;
  const ai = q.data ? aiSpend(q.data.usage, now, caps) : null;
  const gh = q.data ? actionsMinutes(q.data.runs, now) : null;
  const money = (n: number) => toFixedHalfUp(n, 2);
  const total = PLAN_COSTS.reduce((n, c) => n + c.usdPerMonth, 0);
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

export function Status() {
  const q = useQuery({ queryKey: ['status'], queryFn: loadStatus, refetchInterval: 30_000 });
  const pair = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-5';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <PageTitle page="status" {...(q.data ? { aside: <HealthyPill data={q.data} /> } : {})} />
        {q.data ? (
          <CheckLine data={q.data} />
        ) : (
          <p role="status" className={`text-sm ${q.isError ? 'text-crit' : 'text-ink3'}`}>
            {q.isError ? s.dbError(q.error.message) : t.loading}
          </p>
        )}
      </div>
      {q.data && <Sources data={q.data} />}
      <div className={pair}>
        <JobStrips />
        <Costs />
      </div>
      <div className={pair}>
        <SystemAlerts data={q.data} />
        <Latency />
      </div>
    </div>
  );
}
