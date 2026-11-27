import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadExport, listExports } from '../lib/exports';
import { loadPreferences, savePreferences, type Preferences as Prefs } from '../lib/settings';
import { loadQuoteView, saveQuoteSource, type QuoteSource } from '../lib/quotes';
import { supabase } from '../lib/supabase';
import { ZONES, useDisplay, type Lang, type Theme } from '../lib/display';
import { Notifications } from '../components/status/Notifications';
import { Card, Segmented, cardClass } from '../components/Card';
import { PageTitle } from '../components/ui/kit';
import { zoneName } from '../components/Clock';
import { Info } from '../components/Info';
import { panelTitle } from '../components/study/Panel';
import { t } from '../strings';

/**
 * Settings (Marsad v2, new route): display, notifications, the quote source, preferences (Shariah limits, AI
 * caps, risk), weekly exports and security. Display choices stay on this device; everything else is saved to
 * Supabase as before (moved here from the Status page).
 */
export function Settings() {
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="settings" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-5">
        <DisplayCard />
        <SecurityCard />
      </div>
      <Notifications />
      <QuoteSourceCard />
      <Preferences />
      <Exports />
    </div>
  );
}

function DisplayCard() {
  const d = useDisplay();
  const s = t.settings;
  return (
    <Card id="set-display" title={s.display}>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink3">{s.language}</span>
        <Segmented<Lang>
          label={s.language}
          options={[
            { key: 'en', label: s.english },
            { key: 'ar', label: s.arabic },
          ]}
          value={d.lang}
          onChange={(lang) => d.set({ lang })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink3">{s.theme}</span>
        <Segmented<Theme>
          label={s.theme}
          options={[
            { key: 'dark', label: s.navy },
            { key: 'light', label: s.daylight },
          ]}
          value={d.theme}
          onChange={(theme) => d.set({ theme })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink3">{s.zone}</span>
        <Segmented<string>
          label={s.zone}
          options={ZONES.map((z) => ({ key: z, label: zoneName(z) }))}
          value={d.zone}
          onChange={(zone) => d.set({ zone })}
        />
        <p className="text-xs text-ink3">{s.zoneNote}</p>
      </div>
      <p className="text-xs text-ink3">{s.displayNote}</p>
    </Card>
  );
}

function SecurityCard() {
  const s = t.settings;
  return (
    <Card id="set-security" title={s.security}>
      <ul className="flex flex-col gap-2 text-sm text-ink2">
        {s.securityLines.map((line) => (
          <li key={line} className="border-b border-line pb-2 last:border-b-0">
            {line}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void supabase?.auth.signOut()}
        className="min-h-11 self-start rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold text-ink"
      >
        {t.nav.signOut}
      </button>
    </Card>
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
      <Info>{qs.intro}</Info>
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
                <span className="text-sm font-semibold text-ink">{o.label}</span>
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
    'min-h-12 w-full rounded-[10px] border border-muted/35 bg-surface px-3 text-[17px] text-ink';
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
      <h2 className="text-[17px] font-semibold text-ink">{t.status.preferences}</h2>
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
              className={`relative h-8 w-[52px] flex-none rounded-full ${sh.enabled ? 'bg-fill' : 'bg-faint/40'}`}
            >
              <span
                className={`absolute top-1 size-6 rounded-full bg-ink ${sh.enabled ? 'start-7' : 'start-1'}`}
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
                className={`min-h-11 rounded-[10px] border text-[13px] text-ink ${
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
          className="min-h-12 rounded-xl bg-accent px-[22px] text-[15px] font-bold text-accent-ink disabled:opacity-50"
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
