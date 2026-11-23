import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  DEFAULT_SOURCE_POLICIES,
  buildCalendar,
  describeSourceHealth,
  dualClock,
  type UpcomingRow,
} from '@marsad/core';
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
  const [sources, jobs, holidays] = await Promise.all([
    supabase.from('source_status').select('*').order('source'),
    supabase.from('job_runs').select('*').order('started_at', { ascending: false }).limit(20),
    supabase.from('market_holidays').select('*').eq('exchange', 'NYSE'),
  ]);
  if (sources.error) throw new Error(sources.error.message);
  if (jobs.error) throw new Error(jobs.error.message);
  if (holidays.error) throw new Error(holidays.error.message);
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
    calendar: buildCalendar(rows, 'NYSE'),
    checkedAt: new Date().toISOString(),
  };
}

const th = 'border-b border-line px-2 py-2 text-start font-medium text-muted';
const td = 'border-b border-line px-2 py-2 align-top';

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
              <th className={`${th} text-end`}>{t.status.colLatency}</th>
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
                <th className={`${th} text-end`}>{t.status.colRows}</th>
                <th className={`${th} text-end`}>{t.status.colLatency}</th>
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
