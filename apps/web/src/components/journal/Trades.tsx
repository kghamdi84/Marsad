import { useEffect, useState, type FormEvent } from 'react';
import { Info } from '../Info';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHECKLIST,
  FOLLOWED,
  PLAYBOOKS,
  adherence,
  adherenceVsResult,
  daysBetween,
  etDate,
  normalizeTicker,
  pnl,
  rMultiple,
  statsBySetup,
  toFixedHalfUp,
  type ChecklistKey,
  type FollowedKey,
  type JournalTrade,
} from '@marsad/core';
import { Button, ErrorText, Field } from '../ui';
import { addScreenshot, addTrade, closeTrade, loadTrades, screenshotUrl } from '../../lib/journal';
import { Sheet } from '../Sheet';
import { TickerLink } from '../QuickLook';
import { dayMonth } from '../../lib/dates';
import { t } from '../../strings';

const x = t.journal.trades;
const money = (v: number) => toFixedHalfUp(v, 2);
const signed = (v: number, unit: string) =>
  `${v > 0 ? '▲ +' : v < 0 ? '▼ ' : ''}${toFixedHalfUp(v, 2)}${unit}`;
const select = 'min-h-11 rounded-sm border border-line bg-bg px-2 text-fg';

function Shot({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    screenshotUrl(path).then(
      (v) => {
        u = v;
        setUrl(v);
      },
      (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [path]);
  if (err) return <ErrorText message={err} />;
  return url ? (
    <img src={url} alt={alt} className="max-h-40 rounded-sm border border-line" />
  ) : (
    <span className="text-xs text-muted">{t.loading}</span>
  );
}

function TradeCard({ tr }: { tr: JournalTrade }) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['trades'] });
  const [exitDate, setExitDate] = useState(etDate(new Date()));
  const [exitPrice, setExitPrice] = useState('');
  const [perPlan, setPerPlan] = useState(false);
  const close = useMutation({
    mutationFn: () =>
      closeTrade(tr, { date: exitDate, price: Number(exitPrice), exitedPerPlan: perPlan }),
    onSuccess: done,
  });
  const shot = useMutation({ mutationFn: (f: File) => addScreenshot(tr, f), onSuccess: done });
  const a = adherence(tr);
  const r = rMultiple(tr);
  const p = pnl(tr);
  return (
    <li className="flex flex-col gap-2 rounded-sm border border-line p-3 text-sm">
      <h3 className="font-semibold">
        <TickerLink ticker={tr.ticker} /> {tr.side === 'short' ? `(${x.short})` : ''}{' '}
        {tr.setup && `· ${tr.setup}`}
      </h3>
      <p>{x.entered(tr.entryDate, money(tr.entryPrice), tr.shares)}</p>
      {tr.exitDate !== null && tr.exitPrice !== null ? (
        <p>
          {x.exited(tr.exitDate, money(tr.exitPrice))}{' '}
          {p !== null && x.result(r === null ? '–' : signed(r, 'R'), signed(p, ''))}
        </p>
      ) : (
        <p className="text-muted">{x.open}</p>
      )}
      <p className="font-medium">
        {x.adherence(toFixedHalfUp(a.score, 0), a.honored, a.applicable)}
      </p>
      <p className="text-xs text-muted">
        {a.principles.map((q) => `${q.label} ${q.honored}/${q.applicable}`).join(' · ')}
      </p>
      {a.broken.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">{x.brokenTitle}</p>
          <ul className="list-disc ps-5 text-xs">
            {a.broken.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {tr.notes && <p className="whitespace-pre-wrap">{tr.notes}</p>}
      {tr.screenshots.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={x.screenshots}>
          {tr.screenshots.map((s, i) => (
            <Shot key={s} path={s} alt={x.screenshotAlt(tr.ticker, i + 1)} />
          ))}
        </div>
      )}
      {tr.screenshots.length < 6 && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {x.addScreenshot}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="min-h-11 text-sm text-fg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) shot.mutate(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {shot.isError && <ErrorText message={shot.error.message} />}
      {tr.exitDate === null && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(exitPrice) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(exitDate)) close.mutate();
          }}
        >
          <Field
            id={`exit-date-${tr.id}`}
            label={x.exitDate}
            value={exitDate}
            onChange={(e) => setExitDate(e.target.value)}
          />
          <Field
            id={`exit-price-${tr.id}`}
            label={x.exitPrice}
            inputMode="decimal"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={perPlan}
              onChange={(e) => setPerPlan(e.target.checked)}
            />
            {x.exitedPerPlan}
          </label>
          <Button type="submit" disabled={close.isPending}>
            {x.close}
          </Button>
          {close.isError && <ErrorText message={close.error.message} />}
        </form>
      )}
    </li>
  );
}

function NewTrade({
  alerts,
}: {
  alerts: { id: string; ticker: string | null; headline: string; createdAt: string }[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    ticker: '',
    side: 'long' as 'long' | 'short',
    setup: '',
    entryDate: etDate(new Date()),
    entryPrice: '',
    shares: '',
    stop: '',
    target: '',
    tags: '',
    alertId: '',
    notes: '',
  });
  const [checks, setChecks] = useState<Partial<Record<ChecklistKey, boolean>>>({});
  const [followed, setFollowed] = useState<Partial<Record<FollowedKey, boolean>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const save = useMutation({
    mutationFn: addTrade,
    onSuccess: () => {
      setMsg(x.saved);
      void qc.invalidateQueries({ queryKey: ['trades'] });
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const ticker = normalizeTicker(f.ticker);
    const ok =
      ticker !== null &&
      /^\d{4}-\d{2}-\d{2}$/.test(f.entryDate) &&
      Number(f.entryPrice) > 0 &&
      Number(f.shares) > 0;
    setBad(!ok);
    if (!ok) return;
    save.mutate({
      ticker,
      side: f.side,
      setup: f.setup.trim().slice(0, 60),
      tags: f.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
      alertId: f.alertId || null,
      entryDate: f.entryDate,
      entryPrice: Number(f.entryPrice),
      shares: Number(f.shares),
      stop: Number(f.stop) > 0 ? Number(f.stop) : null,
      target: Number(f.target) > 0 ? Number(f.target) : null,
      checklist: checks,
      followed,
      notes: f.notes.slice(0, 4000),
    });
  };
  const forTicker = alerts.filter((a) => !f.ticker || a.ticker === normalizeTicker(f.ticker));
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={x.add}>
      <h3 className="text-sm font-semibold">{x.add}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field id="tr-ticker" label={x.ticker} value={f.ticker} onChange={set('ticker')} />
        <label className="flex flex-col gap-1 text-sm text-muted">
          {x.side}
          <select className={select} value={f.side} onChange={set('side')}>
            <option value="long">{x.long}</option>
            <option value="short">{x.short}</option>
          </select>
        </label>
        <Field
          id="tr-setup"
          label={x.setup}
          list="tr-setups"
          value={f.setup}
          onChange={set('setup')}
        />
        <datalist id="tr-setups">
          {PLAYBOOKS.map((p) => (
            <option key={p.id} value={p.id} />
          ))}
        </datalist>
        <Field
          id="tr-entry-date"
          label={x.entryDate}
          value={f.entryDate}
          onChange={set('entryDate')}
        />
        <Field
          id="tr-entry-price"
          label={x.entryPrice}
          inputMode="decimal"
          value={f.entryPrice}
          onChange={set('entryPrice')}
        />
        <Field
          id="tr-shares"
          label={x.shares}
          inputMode="decimal"
          value={f.shares}
          onChange={set('shares')}
        />
        <Field
          id="tr-stop"
          label={x.stop}
          inputMode="decimal"
          value={f.stop}
          onChange={set('stop')}
        />
        <Field
          id="tr-target"
          label={x.target}
          inputMode="decimal"
          value={f.target}
          onChange={set('target')}
        />
        <Field id="tr-tags" label={x.tags} value={f.tags} onChange={set('tags')} />
        <label className="col-span-2 flex flex-col gap-1 text-sm text-muted sm:col-span-3">
          {x.alert}
          <select className={select} value={f.alertId} onChange={set('alertId')}>
            <option value="">{x.noAlert}</option>
            {forTicker.map((a) => (
              <option key={a.id} value={a.id}>
                {a.createdAt.slice(0, 10)}: {a.headline}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{x.checklist}</legend>
        {CHECKLIST.map((c) => (
          <label key={c.key} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checks[c.key] === true}
              onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{x.followed}</legend>
        {FOLLOWED.filter((q) => !q.closedOnly).map((q) => (
          <label key={q.key} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={followed[q.key] === true}
              onChange={(e) => setFollowed({ ...followed, [q.key]: e.target.checked })}
            />
            {q.label}
          </label>
        ))}
      </fieldset>
      <label htmlFor="tr-notes" className="text-sm font-medium">
        {x.notes}
      </label>
      <textarea
        id="tr-notes"
        rows={3}
        className="rounded-sm border border-line bg-bg p-2 text-sm text-fg"
        value={f.notes}
        onChange={set('notes')}
      />
      <Button type="submit" disabled={save.isPending}>
        {x.save}
      </Button>
      {bad && <ErrorText message={x.invalid} />}
      {save.isError && <ErrorText message={save.error.message} />}
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

/** "Followed the plan": an adherence score of 80 or more, the same line the result comparison uses. */
const FOLLOWED_AT = 80;

/** One closed or open trade as the design's row; a tap opens the full card (exits, screenshots, notes). */
function TradeRow({ tr, onOpen }: { tr: JournalTrade; onOpen: () => void }) {
  const r = rMultiple(tr);
  const a = adherence(tr);
  const ok = a.score >= FOLLOWED_AT;
  const end = tr.exitDate ?? etDate(new Date());
  const held = daysBetween(tr.entryDate, end);
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 py-2.5 text-start"
      >
        <span className="font-bold text-white">
          {tr.ticker}{' '}
          <span className="text-[13px] font-normal text-muted">
            {dayMonth(tr.exitDate ?? tr.entryDate)}
          </span>
        </span>
        <span
          className={`text-end font-bold tabular-nums ${r === null ? 'text-muted' : r >= 0 ? 'text-up' : 'text-down'}`}
        >
          {tr.exitDate === null
            ? x.openShort
            : r === null
              ? '–'
              : `${r >= 0 ? '▲ +' : '▼ −'}${toFixedHalfUp(Math.abs(r), 1)}R`}
        </span>
        <span className="text-[13px] text-muted">
          {x.rowSub(tr.setup.trim() || x.noSetup, held)}
        </span>
        <span
          className={`justify-self-end rounded-sm px-1.5 py-px text-xs ${ok ? 'bg-up/14 text-up' : 'bg-down/16 text-down'}`}
        >
          {ok ? x.followedPlan : x.brokePlan}
        </span>
      </button>
    </li>
  );
}

export function Trades() {
  const q = useQuery({ queryKey: ['trades'], queryFn: loadTrades });
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const stats = q.data ? statsBySetup(q.data.trades) : [];
  const vs = q.data ? adherenceVsResult(q.data.trades) : null;
  const r2 = (v: number | null) => (v === null ? '–' : signed(v, 'R'));
  const trades = q.data?.trades ?? [];
  const scores = trades.map((tr) => adherence(tr).score);
  const mean = scores.length ? scores.reduce((p, c) => p + c, 0) / scores.length : null;
  const followed = scores.filter((sc) => sc >= FOLLOWED_AT).length;
  const opened = trades.find((tr) => tr.id === openId);
  return (
    <section aria-labelledby="trades" className="flex flex-col gap-2.5">
      <h2 id="trades" className="sr-only">
        {x.title}
      </h2>
      <Info>{x.intro}</Info>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data && (
        <>
          {trades.length === 0 ? (
            <p className="text-muted">{x.none}</p>
          ) : (
            <>
              {mean !== null && (
                <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4">
                  <svg
                    viewBox="0 0 36 36"
                    role="img"
                    aria-label={x.ringAria(Math.round(mean))}
                    className="size-[72px] flex-none -rotate-90"
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke="rgba(138,153,178,0.18)"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke="var(--color-up)"
                      strokeWidth="3.5"
                      strokeDasharray={`${Math.round(mean)} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="flex flex-col">
                    <span className="text-[13px] text-muted">{x.ringTitle}</span>
                    <span className="text-[1.75rem] font-bold tabular-nums">
                      {Math.round(mean)}
                    </span>
                    <span className="text-[13px] text-fg">
                      {x.followedOf(followed, trades.length)}
                    </span>
                  </span>
                </div>
              )}
              <ul className="rounded-2xl border border-line bg-surface px-4 py-1">
                {trades.map((tr) => (
                  <TradeRow key={tr.id} tr={tr} onOpen={() => setOpenId(tr.id)} />
                ))}
              </ul>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
                <h3 className="font-semibold">{x.statsTitle}</h3>
                <ul className="flex flex-col gap-2">
                  {stats.map((st) => (
                    <li key={st.setup} className="flex justify-between gap-2.5">
                      <span>{st.setup}</span>
                      <span className="text-[13px] whitespace-nowrap text-muted tabular-nums">
                        {/* No percentage from fewer than 30 cases (integrity rule 10). */}
                        {st.insufficient || st.winRate === null
                          ? x.insufficientWin(st.closed)
                          : x.setupNote(
                              `${toFixedHalfUp(st.winRate * 100, 1)}%`,
                              r2(st.meanR),
                              st.closed,
                            )}
                      </span>
                    </li>
                  ))}
                </ul>
                {vs && (
                  <p className="text-[13px] text-muted">
                    {vs.insufficient
                      ? x.vsInsufficient
                      : x.vs(vs.high.n, r2(vs.high.meanR), vs.low.n, r2(vs.low.meanR))}
                  </p>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            aria-expanded={adding}
            aria-controls="trade-new"
            onClick={() => setAdding(!adding)}
            className="min-h-11 rounded-xl border border-muted/35 px-4 text-[0.9375rem] text-white"
          >
            {x.add}
          </button>
          {adding && (
            <div id="trade-new" className="rounded-2xl border border-line bg-surface p-4">
              <NewTrade alerts={q.data.alerts} />
            </div>
          )}
          <Sheet
            open={opened !== undefined}
            onClose={() => setOpenId(null)}
            title={opened ? x.cardTitle(opened.ticker) : ''}
          >
            {opened && (
              <ul>
                <TradeCard tr={opened} />
              </ul>
            )}
          </Sheet>
        </>
      )}
    </section>
  );
}
