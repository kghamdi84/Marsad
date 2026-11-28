import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiSpend, toFixedHalfUp } from '@marsad/core';
import { downloadExport, listExports } from '../lib/exports';
import { loadPreferences, savePreferences, type Preferences as Prefs } from '../lib/settings';
import { loadQuoteView, saveQuoteSource, type QuoteSource } from '../lib/quotes';
import { loadCosts } from '../lib/status';
import { supabase } from '../lib/supabase';
import { ZONES, useDisplay, type Lang, type Theme } from '../lib/display';
import { NotificationsCard, PushSetup } from '../components/status/Notifications';
import { Card, Segmented } from '../components/Card';
import { PageTitle, Pill } from '../components/ui/kit';
import { zoneName } from '../components/Clock';
import { Info } from '../components/Info';
import { useView } from '../lib/view';
import { t } from '../strings';

const s = t.settings;

const SECTIONS = ['display', 'notifications', 'prefs', 'data'] as const;
type Section = (typeof SECTIONS)[number];
const pair = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-5';

/**
 * Settings (Marsad v2, squeezed): four sections under one switch (display and security, notifications and push
 * setup, the Shariah aid and AI caps, the quote source and weekly exports), the choice remembered on this device.
 * Every section stays mounted and is only hidden, so an unsaved edit survives a switch. Display choices stay on
 * this device; everything else is saved to Supabase as before, with the same columns and values.
 */
export function Settings() {
  const [section, setSection] = useView<Section>('marsad.settings.section', SECTIONS, 'display');
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="settings" />
      <Segmented
        label={s.sectionsLabel}
        options={SECTIONS.map((key) => ({ key, label: s.sections[key] ?? key }))}
        value={section}
        onChange={setSection}
      />
      <div hidden={section !== 'display'} className={pair}>
        <DisplayCard />
        <SecurityCard />
      </div>
      <div hidden={section !== 'notifications'} className="flex flex-col gap-5">
        <NotificationsCard />
        <PushSetup />
      </div>
      <div hidden={section !== 'prefs'} className={pair}>
        <PreferenceCards />
      </div>
      <div hidden={section !== 'data'} className={pair}>
        <QuoteSourceCard />
        <Exports />
      </div>
    </div>
  );
}

/** A settings row: the label on the start side, the value or control on the end side, an optional note under. */
function Row({
  k,
  children,
  note,
  stack = false,
}: {
  k: ReactNode;
  children: ReactNode;
  note?: ReactNode;
  /** Put the control under the label (wide controls). */
  stack?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <div
        className={
          stack
            ? 'flex flex-col gap-2'
            : 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2'
        }
      >
        <span className="text-sm text-ink2">{k}</span>
        {children}
      </div>
      {note && <p className="text-xs text-ink3">{note}</p>}
    </div>
  );
}

const value = 'text-end text-sm font-semibold text-ink';

function DisplayCard() {
  const d = useDisplay();
  return (
    <Card id="set-display" title={s.display}>
      <div className="flex flex-col">
        <Row k={s.language}>
          <Segmented<Lang>
            label={s.language}
            options={[
              { key: 'en', label: s.english },
              { key: 'ar', label: s.arabic },
            ]}
            value={d.lang}
            onChange={(lang) => d.set({ lang })}
          />
        </Row>
        <Row k={s.theme}>
          <Segmented<Theme>
            label={s.theme}
            options={[
              { key: 'dark', label: s.navy },
              { key: 'light', label: s.daylight },
            ]}
            value={d.theme}
            onChange={(theme) => d.set({ theme })}
          />
        </Row>
        <Row k={s.zone} note={s.zoneNote}>
          <Segmented<string>
            label={s.zone}
            options={ZONES.map((z) => ({ key: z, label: zoneName(z) }))}
            value={d.zone}
            onChange={(zone) => d.set({ zone })}
          />
        </Row>
        <Row k={s.numberFormat}>
          <span className={value}>{s.numberFormatValue}</span>
        </Row>
      </div>
      <p className="text-xs text-ink3">{s.displayNote}</p>
    </Card>
  );
}

function SecurityCard() {
  return (
    <Card id="set-security" title={s.security}>
      <div className="flex flex-col">
        {s.securityRows.map((r) => (
          <Row key={r.k} k={r.k} note={r.note}>
            <span className={`${value} ${r.warn ? 'text-warn!' : ''}`}>{r.v}</span>
          </Row>
        ))}
      </div>
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
    <Card id="quote-source-h" title={qs.title}>
      {q.isError ? (
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2" disabled={!q.data || save.isPending}>
          <legend className="mb-1 text-sm text-ink2">{qs.legend}</legend>
          {options.map((o) => (
            <label
              key={o.key}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border p-3 ${
                current === o.key ? 'border-ink3 bg-elev' : 'border-line'
              }`}
            >
              <input
                type="radio"
                name="quote-source"
                value={o.key}
                className="mt-1 size-4 accent-current"
                checked={current === o.key}
                onChange={() => {
                  setMsg(null);
                  setChosen(o.key);
                  save.mutate(o.key);
                }}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{o.label}</span>
                <span className="text-xs text-ink3">{o.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Info>{qs.intro}</Info>
      {save.isError && (
        <p role="alert" className="text-sm text-crit">
          {save.error.message}
        </p>
      )}
      {msg && (
        <p role="status" className="text-sm text-ink2">
          {msg}
        </p>
      )}
    </Card>
  );
}

/** The Shariah and AI caps cards, both saved to `user_settings`; loading and errors show in their place. */
function PreferenceCards() {
  const q = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  if (q.isError)
    return (
      <Card id="set-prefs-error" title={s.shariah.title}>
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      </Card>
    );
  if (!q.data)
    return (
      <>
        <Card id="set-shariah-loading" title={s.shariah.title}>
          <p className="text-sm text-ink3">{t.loading}</p>
        </Card>
        <Card id="set-ai-loading" title={s.ai.title}>
          <p className="text-sm text-ink3">{t.loading}</p>
        </Card>
      </>
    );
  return <PreferenceForms initial={q.data} />;
}

const field =
  'min-h-11 w-24 rounded-lg border border-line-strong bg-elev px-3 text-end text-[15px] text-ink tabular-nums';

/**
 * Each card saves its own part over the last saved preferences, so an unsaved edit in one card never rides along
 * with the other card's save. The row written is the same six columns as before.
 */
function PreferenceForms({ initial }: { initial: Prefs }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<Prefs>(initial);
  const [sh, setSh] = useState<Prefs['shariah']>(initial.shariah);
  const [ai, setAi] = useState<Prefs['ai']>(initial.ai);
  const [shMsg, setShMsg] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const costs = useQuery({ queryKey: ['costs'], queryFn: loadCosts });
  const done = (p: Prefs) => {
    setSaved(p);
    void qc.invalidateQueries({ queryKey: ['preferences'] });
  };
  const saveSh = useMutation({
    mutationFn: (p: Prefs) => savePreferences(p).then(() => p),
    onSuccess: (p) => {
      done(p);
      setShMsg(t.status.preferencesSaved);
    },
  });
  const saveAi = useMutation({
    mutationFn: (p: Prefs) => savePreferences(p).then(() => p),
    onSuccess: (p) => {
      done(p);
      setAiMsg(s.ai.saved);
    },
  });
  const pct = (v: number) => String(Math.round(v * 1000) / 10);
  const setS = (patch: Partial<Prefs['shariah']>) => setSh({ ...sh, ...patch });
  const cap = (v: string) => (v.trim() === '' ? null : Number(v));
  const aiOff = saved.ai.dailyUsd === null || saved.ai.monthlyUsd === null;
  const month = costs.data
    ? aiSpend(
        costs.data.usage,
        new Date(),
        aiOff ? null : { dailyUsd: saved.ai.dailyUsd ?? 0, monthlyUsd: saved.ai.monthlyUsd ?? 0 },
      ).monthUsd
    : null;
  const submit =
    'min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50';
  return (
    <>
      <form
        aria-labelledby="set-shariah"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-[18px] py-4"
        onSubmit={(e) => {
          e.preventDefault();
          setShMsg(null);
          const ok = [sh.debtMax, sh.cashMax].every((v) => v > 0 && v < 1);
          if (!ok) return setShMsg(t.status.preferencesInvalid);
          saveSh.mutate({ ...saved, shariah: sh });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="set-shariah" className="text-base font-semibold text-ink">
            {s.shariah.title}
          </h2>
          <span className="flex items-center gap-2">
            <Pill tone={sh.enabled ? 'up' : 'neutral'}>
              {sh.enabled ? s.shariah.on : s.shariah.off}
            </Pill>
            <button
              type="button"
              role="switch"
              aria-checked={sh.enabled}
              aria-label={s.shariah.title}
              onClick={() => setS({ enabled: !sh.enabled })}
              className={`relative h-8 w-[52px] flex-none rounded-full border border-line-strong ${sh.enabled ? 'bg-accent' : 'bg-sub'}`}
            >
              <span
                className={`absolute top-[3px] size-6 rounded-full ${sh.enabled ? 'start-[23px] bg-accent-ink' : 'start-[3px] bg-ink3'}`}
              />
            </button>
          </span>
        </div>
        <div className="flex flex-col">
          <Row k={s.shariah.basis} stack>
            <div
              role="radiogroup"
              aria-label={s.shariah.basis}
              className="grid grid-cols-2 gap-1.5"
            >
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
                  onClick={() => setS({ basis: k })}
                  className={`min-h-11 rounded-lg border px-2 text-[13px] font-semibold ${
                    sh.basis === k
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line-strong text-ink3'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row k={<label htmlFor="set-debt">{s.shariah.debt}</label>}>
            <span className="flex items-center gap-1.5 text-sm text-ink3">
              <input
                id="set-debt"
                aria-label={t.status.debtMax}
                inputMode="decimal"
                className={field}
                defaultValue={pct(sh.debtMax)}
                onChange={(e) => setS({ debtMax: Number(e.target.value) / 100 })}
              />
              %
            </span>
          </Row>
          <Row k={<label htmlFor="set-cash">{s.shariah.cash}</label>}>
            <span className="flex items-center gap-1.5 text-sm text-ink3">
              <input
                id="set-cash"
                aria-label={t.status.cashMax}
                inputMode="decimal"
                className={field}
                defaultValue={pct(sh.cashMax)}
                onChange={(e) => setS({ cashMax: Number(e.target.value) / 100 })}
              />
              %
            </span>
          </Row>
        </div>
        <p className="text-xs text-ink3">{s.shariah.note}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saveSh.isPending} className={submit}>
            {t.status.savePreferences}
          </button>
          {saveSh.isError && (
            <p role="alert" className="text-[13px] text-crit">
              {saveSh.error.message}
            </p>
          )}
          {shMsg && (
            <p role="status" className="text-[13px] text-ink2">
              {shMsg}
            </p>
          )}
        </div>
      </form>
      <form
        aria-labelledby="set-ai"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-[18px] py-4"
        onSubmit={(e) => {
          e.preventDefault();
          setAiMsg(null);
          const capsOk = [ai.dailyUsd, ai.monthlyUsd].every((v) => v === null || v > 0);
          if (!capsOk) return setAiMsg(t.status.capsInvalid);
          saveAi.mutate({ ...saved, ai });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="set-ai" className="text-base font-semibold text-ink">
            {s.ai.title}
          </h2>
          <Pill tone={aiOff ? 'warn' : 'up'}>{aiOff ? s.shariah.off : s.shariah.on}</Pill>
        </div>
        <div className="flex flex-col">
          {(
            [
              ['set-ai-daily', s.ai.daily, t.status.aiDailyCap, 'dailyUsd'],
              ['set-ai-monthly', s.ai.monthly, t.status.aiMonthlyCap, 'monthlyUsd'],
            ] as const
          ).map(([id, label, aria, key]) => (
            <Row key={id} k={<label htmlFor={id}>{label}</label>}>
              <span className="flex items-center gap-1.5 text-sm text-ink3">
                $
                <input
                  id={id}
                  aria-label={aria}
                  inputMode="decimal"
                  placeholder={s.ai.blank}
                  className={field}
                  defaultValue={ai[key] ?? ''}
                  onChange={(e) => setAi({ ...ai, [key]: cap(e.target.value) })}
                />
              </span>
            </Row>
          ))}
          <Row k={s.ai.spend}>
            <span className={`${value} ${month === null ? 'text-ink3!' : ''}`}>
              {month !== null
                ? `$${toFixedHalfUp(month, 2)}`
                : costs.isError
                  ? t.status.v2.unavailable
                  : t.loading}
            </span>
          </Row>
        </div>
        <p className="text-xs text-ink3">{s.ai.note}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saveAi.isPending} className={submit}>
            {s.ai.save}
          </button>
          {saveAi.isError && (
            <p role="alert" className="text-[13px] text-crit">
              {saveAi.error.message}
            </p>
          )}
          {aiMsg && (
            <p role="status" className="text-[13px] text-ink2">
              {aiMsg}
            </p>
          )}
        </div>
      </form>
    </>
  );
}

function Exports() {
  const q = useQuery({ queryKey: ['exports'], queryFn: listExports });
  const dl = useMutation({
    mutationFn: (x: { date: string; file: string }) => downloadExport(x.date, x.file),
  });
  return (
    <Card id="set-exports" title={t.status.exports} subtitle={t.status.exportsIntro}>
      {q.isError && (
        <p role="alert" className="text-sm text-crit">
          {q.error.message}
        </p>
      )}
      {q.data && q.data.length === 0 && <p className="text-sm text-ink3">{t.status.noExports}</p>}
      {q.data?.map((e) => (
        <ul key={e.date} className="flex flex-wrap gap-2">
          {e.files.map((f) => (
            <li key={f}>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-line-strong px-3 text-sm text-ink"
                onClick={() => dl.mutate({ date: e.date, file: f })}
              >
                {t.status.exportFile(e.date, f)}
              </button>
            </li>
          ))}
        </ul>
      ))}
      {dl.isError && (
        <p role="alert" className="text-sm text-crit">
          {dl.error.message}
        </p>
      )}
    </Card>
  );
}
