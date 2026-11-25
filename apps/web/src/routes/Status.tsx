import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  DEFAULT_SOURCE_POLICIES,
  buildCalendar,
  describeSourceHealth,
  dualClock,
  formatAge,
  latencyByKind,
  type UpcomingRow,
} from '@marsad/core';
import { downloadExport, listExports } from '../lib/exports';
import { supabase } from '../lib/supabase';
import { t } from '../strings';

interface SourceRow {
  source: string;
  display_name: string;
  last_message_at: string | null;
  last_latency_ms: number | null;
  plan_tier: string;
  state: string;
  note: string | null;
}

interface JobRow {
  id: number;
  job: string;
  started_at: string;
  status: string;
  rows_written: number | null;
  latency_ms: number | null;
  error: string | null;
}

function when(iso: string | null): string {
  if (!iso) return t.status.never;
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${dualClock(d, DEFAULT_LOCAL_ZONE).label}`;
}

interface AlertRow {
  id: number;
  created_at: string;
  event: 'stale' | 'recovered' | 'mismatch';
  source: string;
  headline: string;
  paused_rules: string[];
}

/** The heartbeat runs every 15 minutes in trading hours and every 3 hours otherwise. */
const HEARTBEAT_LATE_SEC = 4 * 3600;

interface HolidayRow {
  date: string;
  exchange: string;
  name: string;
  status: string;
  open_at: string | null;
  close_at: string | null;
}

async function load() {
  if (!supabase) throw new Error('not configured');
  const [sources, jobs, holidays, alerts, beat] = await Promise.all([
    supabase.from('source_status').select('*').order('source'),
    supabase.from('job_runs').select('*').order('started_at', { ascending: false }).limit(20),
    supabase.from('market_holidays').select('*').eq('exchange', 'NYSE'),
    supabase.from('system_alerts').select('*').order('created_at', { ascending: false }).limit(20),
    supabase
      .from('job_runs')
      .select('started_at')
      .eq('job', 'health-check')
      .order('started_at', { ascending: false })
      .limit(1),
  ]);
  if (sources.error) throw new Error(sources.error.message);
  if (jobs.error) throw new Error(jobs.error.message);
  if (holidays.error) throw new Error(holidays.error.message);
  if (alerts.error) throw new Error(alerts.error.message);
  if (beat.error) throw new Error(beat.error.message);
  const rows: UpcomingRow[] = (holidays.data as HolidayRow[]).map((h) => ({
    date: h.date,
    exchange: h.exchange,
    name: h.name,
    status: h.status,
    ...(h.open_at ? { open: h.open_at } : {}),
    ...(h.close_at ? { close: h.close_at } : {}),
  }));
  return {
    sources: sources.data as SourceRow[],
    jobs: jobs.data as JobRow[],
    alerts: alerts.data as AlertRow[],
    heartbeatAt: (beat.data as { started_at: string }[])[0]?.started_at ?? null,
    calendar: buildCalendar(rows, 'NYSE'),
    checkedAt: new Date().toISOString(),
  };
}

function heartbeatText(at: string | null, checkedAt: string): { text: string; warn: boolean } {
  if (!at) return { text: t.status.heartbeatNone, warn: true };
  const sec = (new Date(checkedAt).getTime() - new Date(at).getTime()) / 1000;
  const age = formatAge(Math.max(0, sec));
  return sec > HEARTBEAT_LATE_SEC
    ? { text: t.status.heartbeatLate(age), warn: true }
    : { text: t.status.heartbeat(age), warn: false };
}

const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';
// A header over right-aligned numbers: text-start on `th` would fight text-end, so this has no text-start.
const thEnd = 'border-b border-line px-2 py-2 text-end font-medium text-muted';
const td = 'border-b border-line px-2 py-2 align-top';

async function loadLatency() {
  if (!supabase) throw new Error('not configured');
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const r = await supabase
    .from('alerts')
    .select('kind, latency_ms')
    .gte('created_at', since)
    .not('latency_ms', 'is', null)
    .limit(5000);
  if (r.error) throw new Error(r.error.message);
  return latencyByKind(
    (r.data as { kind: string; latency_ms: number | null }[]).map((x) => ({
      kind: x.kind,
      latencyMs: x.latency_ms === null ? null : Number(x.latency_ms),
    })),
  );
}

function Latency() {
  const q = useQuery({ queryKey: ['latency'], queryFn: loadLatency });
  return (
    <div className="overflow-x-auto">
      <h2 className="mb-2 font-semibold">{t.status.latency}</h2>
      <p className="mb-2 text-sm text-muted">{t.status.latencyIntro}</p>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {!q.data ? null : q.data.length === 0 ? (
        <p className="text-muted">{t.status.noLatency}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{t.status.colKind}</th>
              <th className={thEnd}>{t.status.colN}</th>
              <th className={thEnd}>{t.status.colMedian}</th>
              <th className={thEnd}>{t.status.colP90}</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((l) => (
              <tr key={l.kind}>
                <td className={td}>{l.kind}</td>
                <td className={`${td} text-end tabular-nums`}>{l.n}</td>
                <td className={`${td} text-end tabular-nums`}>{formatAge(l.median / 1000)}</td>
                <td className={`${td} text-end tabular-nums`}>{formatAge(l.p90 / 1000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Exports() {
  const q = useQuery({ queryKey: ['exports'], queryFn: listExports });
  const dl = useMutation({
    mutationFn: (x: { date: string; file: string }) => downloadExport(x.date, x.file),
  });
  return (
    <div>
      <h2 className="mb-2 font-semibold">{t.status.exports}</h2>
      <p className="mb-2 text-sm text-muted">{t.status.exportsIntro}</p>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data && q.data.length === 0 && <p className="text-muted">{t.status.noExports}</p>}
      {q.data?.map((e) => (
        <ul key={e.date} className="mb-2 flex flex-wrap gap-2">
          {e.files.map((f) => (
            <li key={f}>
              <button
                type="button"
                className="min-h-11 rounded-sm border border-line px-3 text-sm"
                onClick={() => dl.mutate({ date: e.date, file: f })}
              >
                {t.status.exportFile(e.date, f)}
              </button>
            </li>
          ))}
        </ul>
      ))}
      {dl.isError && (
        <p role="alert" className="text-down">
          {dl.error.message}
        </p>
      )}
    </div>
  );
}

export function Status() {
  const q = useQuery({ queryKey: ['status'], queryFn: load, refetchInterval: 30_000 });

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-xl font-semibold">{t.status.title}</h1>
      <p role="status" className={q.isError ? 'text-down' : 'text-muted'}>
        {q.isError
          ? t.status.dbError(q.error.message)
          : q.data
            ? t.status.dbOk(when(q.data.checkedAt))
            : t.loading}
      </p>

      <div className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">{t.status.sources}</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{t.status.colSource}</th>
              <th className={th}>{t.status.colState}</th>
              <th className={th}>{t.status.colTier}</th>
              <th className={th}>{t.status.colLast}</th>
              <th className={thEnd}>{t.status.colLatency}</th>
              <th className={th}>{t.status.colNote}</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.sources.map((s) => {
              const policy = DEFAULT_SOURCE_POLICIES.find((p) => p.source === s.source);
              const view = policy
                ? describeSourceHealth(
                    policy,
                    s.last_message_at ? new Date(s.last_message_at) : null,
                    new Date(q.data.checkedAt),
                    q.data.calendar,
                  )
                : null;
              return (
                <tr key={s.source}>
                  <td className={td}>{s.display_name}</td>
                  {/* State is always spelled out; color is never the only signal. */}
                  <td className={td}>{view ? view.label : s.state.toUpperCase()}</td>
                  <td className={td}>{s.plan_tier}</td>
                  <td className={td}>{when(s.last_message_at)}</td>
                  <td className={`${td} text-end`}>
                    {s.last_latency_ms === null ? t.status.none : `${s.last_latency_ms} ms`}
                  </td>
                  <td className={`${td} text-muted`}>{s.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {q.data && (
        <p
          role="status"
          className={
            heartbeatText(q.data.heartbeatAt, q.data.checkedAt).warn ? 'text-down' : 'text-muted'
          }
        >
          {heartbeatText(q.data.heartbeatAt, q.data.checkedAt).text}
        </p>
      )}

      <Latency />

      <div className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">{t.status.alerts}</h2>
        {q.data && q.data.alerts.length === 0 ? (
          <p className="text-muted">{t.status.noAlerts}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{t.status.colWhen}</th>
                <th className={th}>{t.status.colEvent}</th>
                <th className={th}>{t.status.colHeadline}</th>
                <th className={th}>{t.status.colPaused}</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.alerts.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{when(a.created_at)}</td>
                  <td className={td}>{t.status.events[a.event]}</td>
                  <td className={td}>{a.headline}</td>
                  <td className={`${td} text-muted`}>{a.paused_rules.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Exports />

      <div className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">{t.status.jobs}</h2>
        {q.data && q.data.jobs.length === 0 ? (
          <p className="text-muted">{t.status.noJobs}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{t.status.colJob}</th>
                <th className={th}>{t.status.colStarted}</th>
                <th className={th}>{t.status.colStatus}</th>
                <th className={thEnd}>{t.status.colRows}</th>
                <th className={thEnd}>{t.status.colLatency}</th>
                <th className={th}>{t.status.colError}</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.jobs.map((j) => (
                <tr key={j.id}>
                  <td className={td}>{j.job}</td>
                  <td className={td}>{when(j.started_at)}</td>
                  <td className={`${td} uppercase`}>{j.status}</td>
                  <td className={`${td} text-end`}>{j.rows_written ?? t.status.none}</td>
                  <td className={`${td} text-end`}>
                    {j.latency_ms === null ? t.status.none : `${j.latency_ms} ms`}
                  </td>
                  <td className={`${td} text-down`}>{j.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
