import { buildCalendar, latencyByKind, type UpcomingRow } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface SourceRow {
  source: string;
  display_name: string;
  last_message_at: string | null;
  last_latency_ms: number | null;
  plan_tier: string;
  state: string;
  note: string | null;
}

export interface SystemAlertRow {
  id: number;
  created_at: string;
  event: 'stale' | 'recovered' | 'mismatch';
  source: string;
  headline: string;
  paused_rules: string[];
}

interface HolidayRow {
  date: string;
  exchange: string;
  name: string;
  status: string;
  open_at: string | null;
  close_at: string | null;
}

/** Every row of `public.source_status`, the system alerts, the NYSE calendar and the latest heartbeat run. */
export async function loadStatus() {
  const c = client();
  const [sources, holidays, alerts, beat] = await Promise.all([
    c.from('source_status').select('*').order('source'),
    c.from('market_holidays').select('*').eq('exchange', 'NYSE'),
    c.from('system_alerts').select('*').order('created_at', { ascending: false }).limit(20),
    c
      .from('job_runs')
      .select('started_at')
      .eq('job', 'health-check')
      .order('started_at', { ascending: false })
      .limit(1),
  ]);
  if (sources.error) throw new Error(sources.error.message);
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
    alerts: alerts.data as SystemAlertRow[],
    heartbeatAt: (beat.data as { started_at: string }[])[0]?.started_at ?? null,
    calendar: buildCalendar(rows, 'NYSE'),
    checkedAt: new Date().toISOString(),
  };
}

export type StatusData = Awaited<ReturnType<typeof loadStatus>>;

/** Alert latency by kind over the last 30 days. */
export async function loadLatency() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const r = await client()
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

/** This month's AI usage rows and job runs, for the spend and GitHub Actions estimates. */
export async function loadCosts() {
  const c = client();
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  const [u, j] = await Promise.all([
    c.from('ai_usage').select('created_at, model, usd').gte('created_at', monthStart).limit(10000),
    c.from('job_runs').select('started_at, latency_ms').gte('started_at', monthStart).limit(10000),
  ]);
  if (u.error) throw new Error(u.error.message);
  if (j.error) throw new Error(j.error.message);
  return {
    usage: (u.data as { created_at: string; model: string; usd: number }[]).map((r) => ({
      createdAt: new Date(r.created_at).toISOString(),
      model: r.model,
      usd: Number(r.usd),
    })),
    runs: (j.data as { started_at: string; latency_ms: number | null }[]).map((r) => ({
      startedAt: new Date(r.started_at).toISOString(),
      latencyMs: r.latency_ms === null ? null : Number(r.latency_ms),
    })),
  };
}

/** Every job run of the last 24 hours, oldest first. */
export async function loadDayRuns() {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const r = await client()
    .from('job_runs')
    .select('job, started_at, status, error')
    .gte('started_at', since)
    .order('started_at', { ascending: true })
    .limit(2000);
  if (r.error) throw new Error(r.error.message);
  return {
    since,
    now: new Date().toISOString(),
    runs: (r.data ?? []) as {
      job: string;
      started_at: string;
      status: string;
      error: string | null;
    }[],
  };
}
