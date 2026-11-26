import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SOURCE_POLICIES,
  PLAN_COSTS,
  actionsMinutes,
  aiSpend,
  buildCalendar,
  describeSourceHealth,
  formatAge,
  latencyByKind,
  toFixedHalfUp,
  type UpcomingRow,
} from '@marsad/core';
import { downloadExport, listExports } from '../lib/exports';
import { loadPreferences, savePreferences, type Preferences as Prefs } from '../lib/settings';
import { loadQuoteView, saveQuoteSource, type QuoteSource } from '../lib/quotes';
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

/**
 * Quote source (ADR 0041): one choice of two, so radio buttons. Saved as soon as it is picked; it changes only
 * which latest price the screens show, never the data rules, charts or alerts use.
 */
function QuoteSourceCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['quote-view'], queryFn: loadQuoteView });
  const [msg, setMsg] = useState<string | null>(null);
  // The picked option shows at once and stays while the saved setting reloads; a failed save puts it back.
  const [chosen, setChosen] = useState<QuoteSource | null>(null);
  const qs = t.status.quoteSource;
  const save = useMutation({
    mutationFn: saveQuoteSource,
    onSuccess: (_v, source) => {
      setMsg(qs.saved(source === 'tauric' ? qs.tauric : qs.massive));
      void qc.invalidateQueries({ queryKey: ['quote-view'] });
    },
    onError: () => setChosen(null),
  });
  const current: QuoteSource = chosen ?? q.data?.source ?? 'massive';
  const options: { key: QuoteSource; label: string; note: string }[] = [
    { key: 'massive', label: qs.massive, note: qs.massiveNote },
    { key: 'tauric', label: qs.tauric, note: qs.tauricNote },
  ];
  return (
    <section aria-labelledby="quote-source-h" className={`${cardClass} gap-3!`}>
      <h2 id="quote-source-h" className={panelTitle}>
        {qs.title}
      </h2>
      <p className="text-sm text-muted">{qs.intro}</p>
      {q.isError ? (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2" disabled={!q.data || save.isPending}>
          <legend className="mb-1 text-sm text-fg">{qs.legend}</legend>
          {options.map((o) => (
            <label
              key={o.key}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                current === o.key ? 'border-up/60 bg-raised' : 'border-line'
              }`}
            >
              <input
                type="radio"
                name="quote-source"
                value={o.key}
                className="mt-1 size-4"
                checked={current === o.key}
                onChange={() => {
                  setMsg(null);
                  setChosen(o.key);
                  save.mutate(o.key);
                }}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-white">{o.label}</span>
                <span className="text-xs text-muted">{o.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {save.isError && (
        <p role="alert" className="text-down">
          {save.error.message}
        </p>
      )}
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
    </section>
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
  const d = t.status.design;
  const set = (patch: Partial<Prefs['shariah']>) => setP({ ...p, shariah: { ...sh, ...patch } });
  const cap = (v: string) => (v.trim() === '' ? null : Number(v));
  const aiOff = p.ai.dailyUsd === null || p.ai.monthlyUsd === null;
  const field =
    'min-h-12 w-full rounded-[10px] border border-muted/35 bg-surface px-3 text-[17px] text-white';
  return (
    <form
      aria-label={t.status.preferences}
      className={`${cardClass} gap-4! p-5!`}
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
      <h2 className="text-[17px] font-semibold text-white">{t.status.preferences}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
        <div className="flex flex-col gap-3 rounded-xl bg-bg p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">{d.shariahTitle}</span>
              <span className="text-xs text-muted">{d.shariahNote}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sh.enabled}
              aria-label={d.shariahTitle}
              onClick={() => set({ enabled: !sh.enabled })}
              className={`relative h-8 w-[52px] flex-none rounded-full ${sh.enabled ? 'bg-ink' : 'bg-faint/40'}`}
            >
              <span
                className={`absolute top-1 size-6 rounded-full bg-white ${sh.enabled ? 'start-7' : 'start-1'}`}
              />
            </button>
          </div>
          <div role="radiogroup" aria-label={d.basis} className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['market-cap', t.status.basisMarketCap],
                ['assets', t.status.basisAssets],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={sh.basis === k}
                onClick={() => set({ basis: k })}
                className={`min-h-11 rounded-[10px] border text-[13px] text-white ${
                  sh.basis === k ? 'border-up bg-raised' : 'border-muted/35 bg-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t.status.debtMax}
              <input
                inputMode="decimal"
                className={field}
                defaultValue={pct(sh.debtMax)}
                onChange={(e) => set({ debtMax: Number(e.target.value) / 100 })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t.status.cashMax}
              <input
                inputMode="decimal"
                className={field}
                defaultValue={pct(sh.cashMax)}
                onChange={(e) => set({ cashMax: Number(e.target.value) / 100 })}
              />
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-bg p-3.5">
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">{d.aiTitle}</span>
            <span className="text-xs text-muted">{d.aiNote}</span>
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t.status.aiDailyCap}
              <input
                inputMode="decimal"
                placeholder={d.off}
                className={field}
                defaultValue={p.ai.dailyUsd ?? ''}
                onChange={(e) => setP({ ...p, ai: { ...p.ai, dailyUsd: cap(e.target.value) } })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {t.status.aiMonthlyCap}
              <input
                inputMode="decimal"
                placeholder={d.off}
                className={field}
                defaultValue={p.ai.monthlyUsd ?? ''}
                onChange={(e) => setP({ ...p, ai: { ...p.ai, monthlyUsd: cap(e.target.value) } })}
              />
            </label>
          </div>
          <span className={`text-[13px] ${aiOff ? 'text-muted' : 'text-up'}`}>
            {aiOff ? d.aiOffNote : d.aiOnNote}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="min-h-12 rounded-xl bg-white px-[22px] text-[15px] font-bold text-raised disabled:opacity-50"
        >
          {t.status.savePreferences}
        </button>
        {save.isError && (
          <p role="alert" className="text-[13px] text-down">
            {save.error.message}
          </p>
        )}
        {msg && (
          <p role="status" className="text-[13px] text-fg">
            {msg}
          </p>
        )}
      </div>
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
  const total = PLAN_COSTS.reduce((n, c) => n + c.usdPerMonth, 0);
  const d = t.status.design;
  return (
    <section aria-labelledby="cost-h" className={`${cardClass} p-5!`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cost-h" className="text-[17px] font-semibold text-white">
          {t.status.costs}
        </h2>
        <span className="text-[22px] font-bold">
          ${money(total)} <span className="text-[13px] font-normal text-muted">{d.aMonth}</span>
        </span>
      </div>
      <ul className="flex flex-col">
        {PLAN_COSTS.map((c) => (
          <li
            key={c.service}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line-soft py-2"
          >
            <span className="text-sm font-semibold">{c.service}</span>
            <span className="text-end text-[13px]">
              {c.plan} {'\u00B7'} ${money(c.usdPerMonth)}
            </span>
            <span className="col-span-2 text-xs text-muted">{c.note}</span>
          </li>
        ))}
      </ul>
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-[10px] bg-bg p-3">
        {ai && (
          <>
            <div className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span>{d.aiSpend}</span>
              <span>{d.aiSpendValue(money(ai.todayUsd), money(ai.monthUsd), ai.calls)}</span>
            </div>
            {ai.budget ? (
              <>
                <span
                  className={`text-xs ${ai.budget.state === 'ok' ? 'text-muted' : 'text-down'}`}
                >
                  {t.status.aiBudget(
                    ai.budget.message,
                    String(ai.budget.dailyPct),
                    String(ai.budget.monthlyPct),
                  )}
                </span>
                <CapBar label={t.status.capBars.daily} pct={ai.budget.dailyPct} />
                <CapBar label={t.status.capBars.monthly} pct={ai.budget.monthlyPct} />
                <p className="text-xs text-muted">{t.status.capBars.tick}</p>
              </>
            ) : (
              <span className="text-xs text-warn">{d.aiOffWarn}</span>
            )}
          </>
        )}
        {gh && (
          <div className="flex flex-wrap justify-between gap-x-3 border-t border-line-soft pt-1.5 text-sm">
            <span>{d.actions}</span>
            <span>{d.actionsValue(gh.minutes, gh.runs)}</span>
          </div>
        )}
      </div>
    </section>
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

const hm = (d: Date, zone: string) =>
  d.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
const dayHm = (d: Date, zone: string) =>
  d.toLocaleString('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
/** "25 Nov 16:02 ET \u00B7 00:02 Riyadh": the New York time first, then Riyadh. */
function dual(iso: string | null): string {
  if (!iso) return t.status.never;
  const d = new Date(iso);
  return `${dayHm(d, 'America/New_York')} ET \u00B7 ${hm(d, 'Asia/Riyadh')} Riyadh`;
}

type Fresh = 'live' | 'delayed' | 'stale' | 'unavailable';
const FRESH_STYLE: Record<Fresh, { badge: string; note: string; border: string }> = {
  live: { badge: 'bg-up/15 text-up', note: 'text-up', border: 'border-line' },
  delayed: { badge: 'bg-muted/15 text-fg', note: 'text-muted', border: 'border-line' },
  stale: { badge: 'bg-warn/20 text-warn', note: 'text-warn', border: 'border-warn/60' },
  unavailable: { badge: 'bg-crit/20 text-alarm', note: 'text-alarm', border: 'border-crit/60' },
};
const freshOf = (state: string): Fresh =>
  state === 'ok'
    ? 'live'
    : state === 'not-expected'
      ? 'delayed'
      : state === 'stale'
        ? 'stale'
        : 'unavailable';

function sourceViews(data: Awaited<ReturnType<typeof load>>) {
  return data.sources.map((s) => {
    const policy = DEFAULT_SOURCE_POLICIES.find((p) => p.source === s.source);
    const v = policy
      ? describeSourceHealth(
          policy,
          s.last_message_at ? new Date(s.last_message_at) : null,
          new Date(data.checkedAt),
          data.calendar,
        )
      : null;
    return { row: s, view: v, fresh: freshOf(v ? v.state : 'never') };
  });
}

/** "N of M sources healthy", one bar per source; each state is in words for screen readers and on hover. */
function HealthHero({ data }: { data: Awaited<ReturnType<typeof load>> }) {
  const h = t.status.hero;
  const views = sourceViews(data).filter((v) => v.view !== null);
  const hb = heartbeatText(data.heartbeatAt, data.checkedAt);
  const checked = new Date(data.checkedAt);
  const healthy = views.filter((v) => v.fresh === 'live' || v.fresh === 'delayed').length;
  const quiet = views.filter((v) => v.fresh === 'delayed').length;
  const stale = views.filter((v) => v.fresh === 'stale');
  const cell = (f: Fresh) =>
    f === 'live'
      ? 'bg-up'
      : f === 'delayed'
        ? 'bg-muted'
        : f === 'stale'
          ? 'bg-warn'
          : 'bg-faint/40';
  return (
    <section
      aria-labelledby="health-h"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-raised p-5"
    >
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">
          {h.line(hm(checked, 'America/New_York'), hm(checked, 'Asia/Riyadh'))}
        </span>
        <h1 id="health-h" className="text-[28px] leading-[1.15] font-bold text-white">
          {views.length === 0 ? t.status.title : h.title(healthy, views.length)}
        </h1>
        {stale.length > 0 && (
          <span className="text-sm text-fg">{h.stale(stale.map((v) => v.row.display_name))}</span>
        )}
        <span role="status" className={`text-[13px] ${hb.warn ? 'text-warn' : 'text-muted'}`}>
          {hb.text}
        </span>
      </div>
      {views.length > 0 && (
        <ul aria-label={h.aria(healthy - quiet, quiet, stale.length)} className="flex gap-1">
          {views.map((v) => (
            <li
              key={v.row.source}
              title={`${v.row.display_name}: ${v.view?.label ?? ''}`}
              className={`h-8 w-2.5 rounded-[3px] ${cell(v.fresh)}`}
            >
              <span className="sr-only">
                {v.row.display_name}: {v.view?.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Sources({ data }: { data: Awaited<ReturnType<typeof load>> }) {
  const d = t.status.design;
  return (
    <section aria-labelledby="src-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="src-h" className="text-[17px] font-semibold text-white">
          {t.status.sources}
        </h2>
        <ul className="flex flex-wrap gap-2.5 text-xs">
          {(Object.keys(FRESH_STYLE) as Fresh[]).map((f) => (
            <li key={f} className={`rounded px-2 py-0.5 ${FRESH_STYLE[f].badge}`}>
              {d.fresh[f]}
            </li>
          ))}
        </ul>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-2">
        {sourceViews(data).map(({ row, view, fresh }) => (
          <li
            key={row.source}
            className={`flex flex-col gap-2 rounded-xl border bg-surface p-3.5 ${FRESH_STYLE[fresh].border}`}
          >
            <div className="flex items-start justify-between gap-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold">{row.display_name}</span>
                <span className="text-[11px] text-muted">
                  {row.source} {'\u00B7'} {row.plan_tier}
                </span>
              </span>
              <span
                className={`flex-none rounded px-2 py-[3px] text-xs font-semibold ${FRESH_STYLE[fresh].badge}`}
              >
                {d.fresh[fresh]}
              </span>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2.5 text-xs">
              <span>
                <span className="text-muted">{d.last}</span> {dual(row.last_message_at)}
              </span>
              <span>
                <span className="text-muted">{d.latency}</span>{' '}
                {row.last_latency_ms === null
                  ? t.status.none
                  : `${new Intl.NumberFormat('en-US').format(row.last_latency_ms)} ms`}
              </span>
            </div>
            <span className={`text-xs ${FRESH_STYLE[fresh].note}`}>
              {view ? view.label : row.state.toUpperCase()}
              {row.note ? `. ${row.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
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
  skipped: 'bg-muted',
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
  const errors = q.data.runs.filter((r) => r.status === 'error' && r.error);
  const lastErr = errors.at(-1);
  const axis = (ms: number) => hm(new Date(ms), 'America/New_York');
  return (
    <section aria-labelledby="job-h" className={`${cardClass} p-5!`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="job-h" className="text-[17px] font-semibold text-white">
          {t.status.jobs}
        </h2>
        <ul className="flex flex-wrap gap-3 text-xs text-fg">
          {(
            [
              ['bg-up', x.ok],
              ['bg-muted', x.skipped],
              ['bg-alarm', x.error],
            ] as const
          ).map(([c, label]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-2.5 rounded-[2px] ${c}`} />
              {label}
            </li>
          ))}
        </ul>
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">{x.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <ul className="flex min-w-[600px] flex-col gap-1">
            {jobs.map((job) => {
              const runs = q.data.runs.filter((r) => r.job === job);
              const n = (st: string) => runs.filter((r) => r.status === st).length;
              const bad = n('error');
              const skipped = n('skipped');
              const summary =
                bad > 0 ? x.sumError(bad) : skipped > 0 ? x.sumSkipped(skipped) : x.sumOk(n('ok'));
              return (
                <li
                  key={job}
                  className="grid min-h-[30px] grid-cols-[150px_minmax(0,1fr)_96px] items-center gap-3"
                >
                  <span className="font-mono text-[13px]">{job}</span>
                  <span
                    role="img"
                    aria-label={x.aria(job, runs.length, bad, skipped)}
                    className="relative h-[18px] rounded bg-muted/10"
                  >
                    {runs.map((r, i) => (
                      <span
                        key={`${r.started_at}-${i}`}
                        title={dual(r.started_at)}
                        className={`absolute top-0.5 bottom-0.5 -ms-[3px] w-1.5 rounded-[2px] ${TICK[r.status] ?? 'bg-faint'}`}
                        style={{
                          insetInlineStart: `${Math.min(99.5, Math.max(0, ((Date.parse(r.started_at) - start) / span) * 100)).toFixed(2)}%`,
                        }}
                      />
                    ))}
                  </span>
                  <span
                    className={`text-end text-xs ${bad > 0 ? 'text-alarm' : skipped > 0 ? 'text-fg' : 'text-muted'}`}
                  >
                    {summary}
                  </span>
                </li>
              );
            })}
            <li className="grid grid-cols-[150px_minmax(0,1fr)_96px] gap-3 text-[11px] text-muted">
              <span />
              <span className="flex justify-between">
                <span>{x.axisStart(axis(start))}</span>
                <span>{x.axisMid(axis(start + span / 2))}</span>
                <span>{x.axisNow}</span>
              </span>
              <span />
            </li>
          </ul>
        </div>
      )}
      {lastErr?.error && (
        <span className="text-xs text-alarm">
          {x.latestError(lastErr.job, hm(new Date(lastErr.started_at), 'UTC'), lastErr.error)}
        </span>
      )}
    </section>
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

const EVENT_STYLE: Record<AlertRow['event'], string> = {
  stale: 'bg-warn/20 text-warn',
  mismatch: 'bg-muted/15 text-fg',
  recovered: 'bg-up/15 text-up',
};

export function Status() {
  const q = useQuery({ queryKey: ['status'], queryFn: load, refetchInterval: 30_000 });
  return (
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      {q.data ? (
        <HealthHero data={q.data} />
      ) : (
        <>
          <h1 className="text-[28px] font-bold text-white">{t.status.title}</h1>
          <p role="status" className={q.isError ? 'text-down' : 'text-muted'}>
            {q.isError ? t.status.dbError(q.error.message) : t.loading}
          </p>
        </>
      )}

      {q.data && <Sources data={q.data} />}

      <JobStrips />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-start gap-4">
        <section aria-labelledby="sa-h" className={`${cardClass} gap-1! p-5!`}>
          <h2 id="sa-h" className="mb-1.5 text-[17px] font-semibold text-white">
            {t.status.alerts}
          </h2>
          {q.data && q.data.alerts.length === 0 && (
            <p className="text-muted">{t.status.noAlerts}</p>
          )}
          {q.data?.alerts.map((a) => (
            <div key={a.id} className="flex items-start gap-3 border-t border-line-soft py-3">
              <span
                className={`flex-none rounded px-2 py-0.5 text-[11px] font-semibold ${EVENT_STYLE[a.event]}`}
              >
                {t.status.eventsDesign[a.event]}
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm">{a.headline}</span>
                <span className="text-xs text-muted">{dual(a.created_at)}</span>
                {a.paused_rules.length > 0 && (
                  <span className="text-xs text-muted">
                    {t.status.design.paused(a.paused_rules.join(', '))}
                  </span>
                )}
              </span>
            </div>
          ))}
        </section>
        <Costs />
      </div>

      <Notifications />

      <QuoteSourceCard />

      <Preferences />

      <Latency />

      <Exports />
    </div>
  );
}
