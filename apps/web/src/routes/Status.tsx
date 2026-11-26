import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  DEFAULT_SOURCE_POLICIES,
  PLAN_COSTS,
  actionsMinutes,
  aiSpend,
  buildCalendar,
  describeSourceHealth,
  dualClock,
  formatAge,
  latencyByKind,
  toFixedHalfUp,
  type UpcomingRow,
} from '@marsad/core';
import { downloadExport, listExports } from '../lib/exports';
import { loadPreferences, savePreferences, type Preferences as Prefs } from '../lib/settings';
import { supabase } from '../lib/supabase';
import { Notifications } from '../components/status/Notifications';
import { ScrollX, cardClass } from '../components/Card';
import { panelTitle } from '../components/study/Panel';
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
    <ScrollX label={t.status.latency} className={`${cardClass} gap-3!`}>
      <h2 className={panelTitle}>{t.status.latency}</h2>
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
    </ScrollX>
  );
}

function Preferences() {
  const q = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  if (q.isError)
    return (
      <p role="alert" className="text-down">
        {q.error.message}
      </p>
    );
  return q.data ? <PreferencesForm initial={q.data} /> : null;
}

function PreferencesForm({ initial }: { initial: Prefs }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Prefs>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: savePreferences,
    onSuccess: () => {
      setMsg(t.status.preferencesSaved);
      void qc.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
  const pct = (v: number) => String(Math.round(v * 1000) / 10);
  const sh = p.shariah;
  const set = (patch: Partial<Prefs['shariah']>) => setP({ ...p, shariah: { ...sh, ...patch } });
  const cap = (v: string) => (v.trim() === '' ? null : Number(v));
  return (
    <form
      aria-label={t.status.preferences}
      className={`${cardClass} gap-3!`}
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const ok = [sh.debtMax, sh.cashMax].every((v) => v > 0 && v < 1);
        if (!ok) return setMsg(t.status.preferencesInvalid);
        const capsOk = [p.ai.dailyUsd, p.ai.monthlyUsd].every((v) => v === null || v > 0);
        if (!capsOk) return setMsg(t.status.capsInvalid);
        save.mutate(p);
      }}
    >
      <h2 className={panelTitle}>{t.status.preferences}</h2>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sh.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        {t.status.shariahToggle}
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t.status.shariahBasis}
          <select
            className="min-h-11 rounded-sm border border-line bg-bg px-2 text-fg"
            value={sh.basis}
            onChange={(e) => set({ basis: e.target.value === 'assets' ? 'assets' : 'market-cap' })}
          >
            <option value="market-cap">{t.status.basisMarketCap}</option>
            <option value="assets">{t.status.basisAssets}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t.status.debtMax}
          <input
            inputMode="decimal"
            className="min-h-11 w-24 rounded-sm border border-line bg-bg px-2 text-fg"
            defaultValue={pct(sh.debtMax)}
            onChange={(e) => set({ debtMax: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t.status.cashMax}
          <input
            inputMode="decimal"
            className="min-h-11 w-24 rounded-sm border border-line bg-bg px-2 text-fg"
            defaultValue={pct(sh.cashMax)}
            onChange={(e) => set({ cashMax: Number(e.target.value) / 100 })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t.status.aiDailyCap}
          <input
            inputMode="decimal"
            className="min-h-11 w-32 rounded-sm border border-line bg-bg px-2 text-fg"
            defaultValue={p.ai.dailyUsd ?? ''}
            onChange={(e) => setP({ ...p, ai: { ...p.ai, dailyUsd: cap(e.target.value) } })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t.status.aiMonthlyCap}
          <input
            inputMode="decimal"
            className="min-h-11 w-32 rounded-sm border border-line bg-bg px-2 text-fg"
            defaultValue={p.ai.monthlyUsd ?? ''}
            onChange={(e) => setP({ ...p, ai: { ...p.ai, monthlyUsd: cap(e.target.value) } })}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={save.isPending}
        className="min-h-11 self-start rounded-sm border border-line px-3 text-sm"
      >
        {t.status.savePreferences}
      </button>
      {save.isError && (
        <p role="alert" className="text-down">
          {save.error.message}
        </p>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

async function loadCosts() {
  if (!supabase) throw new Error('not configured');
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
  const [u, j] = await Promise.all([
    supabase
      .from('ai_usage')
      .select('created_at, model, usd')
      .gte('created_at', monthStart)
      .limit(10000),
    supabase
      .from('job_runs')
      .select('started_at, latency_ms')
      .gte('started_at', monthStart)
      .limit(10000),
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
  const money = (v: number) => toFixedHalfUp(v, 2);
  return (
    <ScrollX label={t.status.costs} className={`${cardClass} gap-3!`}>
      <h2 className={panelTitle}>{t.status.costs}</h2>
      <p className="mb-2 text-sm text-muted">{t.status.costsIntro}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>{t.status.colService}</th>
            <th className={th}>{t.status.colPlan}</th>
            <th className={thEnd}>{t.status.colMonthly}</th>
          </tr>
        </thead>
        <tbody>
          {PLAN_COSTS.map((c) => (
            <tr key={c.service}>
              <td className={td}>
                {c.service}
                <span className="block text-xs text-muted">{c.note}</span>
              </td>
              <td className={td}>{c.plan}</td>
              <td className={`${td} text-end tabular-nums`}>{money(c.usdPerMonth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {ai && (
        <p className="mt-2 text-sm">
          {t.status.aiSpend(money(ai.todayUsd), money(ai.monthUsd), ai.calls)}{' '}
          {ai.budget ? (
            <span className={ai.budget.state === 'ok' ? '' : 'font-medium text-down'}>
              {t.status.aiBudget(
                ai.budget.message,
                String(ai.budget.dailyPct),
                String(ai.budget.monthlyPct),
              )}
            </span>
          ) : (
            t.status.aiOff
          )}
        </p>
      )}
      {ai?.budget && (
        <div className="flex flex-col gap-2">
          <CapBar label={t.status.capBars.daily} pct={ai.budget.dailyPct} />
          <CapBar label={t.status.capBars.monthly} pct={ai.budget.monthlyPct} />
          <p className="text-xs text-muted">{t.status.capBars.tick}</p>
        </div>
      )}
      {gh && <p className="text-sm">{t.status.actions(gh.minutes, gh.runs)}</p>}
    </ScrollX>
  );
}

function Exports() {
  const q = useQuery({ queryKey: ['exports'], queryFn: listExports });
  const dl = useMutation({
    mutationFn: (x: { date: string; file: string }) => downloadExport(x.date, x.file),
  });
  return (
    <div className={`${cardClass} gap-3!`}>
      <h2 className={panelTitle}>{t.status.exports}</h2>
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

/** "N of M sources healthy", one cell per source; the state of each is in words for screen readers and on hover. */
function HealthHero({ data }: { data: Awaited<ReturnType<typeof load>> }) {
  const h = t.status.hero;
  const views = data.sources.flatMap((s) => {
    const policy = DEFAULT_SOURCE_POLICIES.find((p) => p.source === s.source);
    if (!policy) return [];
    const v = describeSourceHealth(
      policy,
      s.last_message_at ? new Date(s.last_message_at) : null,
      new Date(data.checkedAt),
      data.calendar,
    );
    return [{ name: s.display_name, state: v.state, label: v.label }];
  });
  if (views.length === 0) return null;
  const healthy = views.filter((v) => v.state === 'ok' || v.state === 'not-expected').length;
  const stale = views.filter((v) => v.state === 'stale').length;
  const cell = (state: string) =>
    state === 'ok' || state === 'not-expected'
      ? 'bg-up'
      : state === 'stale'
        ? 'bg-warn'
        : 'bg-faint/40';
  return (
    <section
      aria-labelledby="health-h"
      className="flex flex-col gap-3 rounded-2xl bg-raised p-4 tablet:rounded-xl tablet:p-5"
    >
      <h2 id="health-h" className="text-xl font-bold text-white">
        {h.title(healthy, views.length)}
      </h2>
      {stale > 0 && <p className="text-sm font-semibold text-warn">{h.stale(stale)}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <li
            key={v.name}
            title={`${v.name}: ${v.label}`}
            className={`h-6 w-6 rounded-md ${cell(v.state)}`}
          >
            <span className="sr-only">
              {v.name}: {v.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{h.legend}</p>
    </section>
  );
}

async function loadDayRuns() {
  if (!supabase) throw new Error('not configured');
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const r = await supabase
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

const TICK: Record<string, string> = {
  ok: 'bg-up',
  skipped: 'bg-muted/60',
  error: 'bg-alarm',
  running: 'bg-warn',
};

/** One strip per job over the last 24 hours, a tick at each run, coloured by outcome (and said in words). */
function JobStrips() {
  const q = useQuery({ queryKey: ['day-runs'], queryFn: loadDayRuns, refetchInterval: 60_000 });
  const x = t.status.strips;
  if (!q.data) return null;
  const start = Date.parse(q.data.since);
  const span = Date.parse(q.data.now) - start;
  const jobs = [...new Set(q.data.runs.map((r) => r.job))].sort();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[0.8125rem] font-bold text-muted">{x.title}</h3>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">{x.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const runs = q.data.runs.filter((r) => r.job === job);
            const errors = runs.filter((r) => r.status === 'error');
            const lastErr = errors.at(-1);
            return (
              <li
                key={job}
                className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3"
              >
                <span className="truncate text-sm text-fg">{job}</span>
                <span
                  role="img"
                  aria-label={x.aria(
                    job,
                    runs.length,
                    errors.length,
                    runs.filter((r) => r.status === 'skipped').length,
                  )}
                  className="relative h-5 rounded-md bg-bg"
                >
                  {runs.map((r, i) => (
                    <span
                      key={`${r.started_at}-${i}`}
                      className={`absolute top-1 h-3 w-0.5 rounded-full ${TICK[r.status] ?? 'bg-faint'}`}
                      style={{
                        insetInlineStart: `${Math.min(99.5, Math.max(0, ((Date.parse(r.started_at) - start) / span) * 100)).toFixed(2)}%`,
                      }}
                    />
                  ))}
                </span>
                {lastErr?.error && (
                  <span className="col-span-2 text-xs text-alarm">
                    {x.latestError(when(lastErr.started_at), lastErr.error)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">{x.legend}</p>
    </div>
  );
}

/** A spend bar against a cap with the 80% warning tick. */
function CapBar({ label, pct }: { label: string; pct: number }) {
  const x = t.status.capBars;
  const width = Math.min(100, Math.max(0, pct));
  const tone = pct >= 100 ? 'bg-alarm' : pct >= 80 ? 'bg-warn' : 'bg-up';
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between gap-2 text-sm">
        <span className="text-fg">{label}</span>
        <span className="text-muted tabular-nums">{x.pct(toFixedHalfUp(pct, 0))}</span>
      </span>
      <span aria-hidden="true" className="relative h-2 rounded-full bg-faint/20">
        <span
          className={`absolute inset-y-0 start-0 rounded-full ${tone}`}
          style={{ width: `${width}%` }}
        />
        <span className="absolute -top-1 start-[80%] h-4 w-0.5 bg-white" />
      </span>
    </div>
  );
}

export function Status() {
  const q = useQuery({ queryKey: ['status'], queryFn: load, refetchInterval: 30_000 });

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">
        {t.status.title}
      </h1>
      {q.data && <HealthHero data={q.data} />}
      <p role="status" className={q.isError ? 'text-down' : 'text-muted'}>
        {q.isError
          ? t.status.dbError(q.error.message)
          : q.data
            ? t.status.dbOk(when(q.data.checkedAt))
            : t.loading}
      </p>

      <ScrollX label={t.status.sources} className={`${cardClass} gap-3!`}>
        <h2 className={panelTitle}>{t.status.sources}</h2>
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
      </ScrollX>

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

      <ScrollX label={t.status.alerts} className={`${cardClass} gap-3!`}>
        <h2 className={panelTitle}>{t.status.alerts}</h2>
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
      </ScrollX>

      <Costs />

      <Notifications />

      <Preferences />

      <Exports />

      <ScrollX label={t.status.jobs} className={`${cardClass} gap-3!`}>
        <h2 className={panelTitle}>{t.status.jobs}</h2>
        <JobStrips />
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
      </ScrollX>
    </section>
  );
}
