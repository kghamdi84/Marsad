import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeTicker, toFixedHalfUp, type CatalystScenario } from '@marsad/core';
import { useWide } from '../Card';
import { Sheet } from '../Sheet';
import { Button, ErrorText, Field } from '../ui';
import {
  addScenario,
  loadScenarios,
  setScenarioActive,
  type StoredScenario,
} from '../../lib/scenarios';
import { t } from '../../strings';

const x = t.alerts.scenarios;
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const pctText = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;

function triggerText(s: CatalystScenario): string {
  const tr = s.triggers;
  return [
    tr.eightKItems.length ? `8-K item ${tr.eightKItems.join(' or ')}` : '',
    tr.form4Codes.length ? `Form 4 code ${tr.form4Codes.join(' or ')}` : '',
    tr.newsMinTier !== null ? `news at tier ${tr.newsMinTier} or better` : '',
    tr.halts ? 'a trading halt' : '',
    tr.movePct !== null
      ? `a move of ${pctText(tr.movePct)}${tr.volumeRatio !== null ? ` on ${tr.volumeRatio}x volume` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function ScenarioItem({ s }: { s: StoredScenario }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => setScenarioActive(s.id, !s.active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scenarios'] }),
  });
  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border p-4 text-sm ${s.active ? 'border-line bg-surface' : 'border-line/60 bg-surface/50 text-muted'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-white">{s.name}</h3>
        <button
          type="button"
          role="switch"
          aria-checked={s.active}
          aria-label={s.active ? x.pause : x.resume}
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          className="flex min-h-11 min-w-11 flex-none items-center justify-center"
        >
          <span
            aria-hidden="true"
            className={`relative h-6 w-11 rounded-full ${s.active ? 'bg-ink' : 'bg-faint/40'}`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white ${s.active ? 'end-0.5' : 'start-0.5'}`}
            />
          </span>
        </button>
      </div>
      <ul aria-label={s.tickers.join(', ')} className="flex flex-wrap gap-1.5">
        {s.tickers.map((tk) => (
          <li key={tk} className="rounded bg-bg px-2 py-0.5 text-xs font-semibold text-fg">
            {tk}
          </li>
        ))}
      </ul>
      <p>{x.triggersLine(triggerText(s))}</p>
      <p>{x.planLine(s.plan.entry, pctText(s.plan.chaseGuardPct), s.plan.invalidation)}</p>
      <p className="text-muted">{x.expiresLine(s.expiresOn, s.active)}</p>
      {toggle.isError && <ErrorText message={toggle.error.message} />}
    </li>
  );
}

const EMPTY = {
  name: '',
  tickers: '',
  keywords: '',
  eightK: '',
  form4: '',
  newsTier: '',
  halts: false,
  move: '',
  volume: '',
  entry: '',
  chase: '10',
  invalidation: '',
  size: '',
  expires: '',
};

function NewScenario({ stepped = false }: { stepped?: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [bad, setBad] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const show = (k: number) => !stepped || step === k;
  const save = useMutation({
    mutationFn: addScenario,
    onSuccess: () => {
      setMsg(x.saved);
      setF(EMPTY);
      setStep(0);
      void qc.invalidateQueries({ queryKey: ['scenarios'] });
    },
  });
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const tickers = list(f.tickers).map(normalizeTicker);
    const chase = Number(f.chase) / 100;
    const move = f.move.trim() === '' ? null : Number(f.move) / 100;
    const volume = f.volume.trim() === '' ? null : Number(f.volume);
    const draft: Omit<CatalystScenario, 'id'> = {
      name: f.name.trim(),
      tickers: tickers.filter((v): v is string => v !== null),
      keywords: list(f.keywords),
      triggers: {
        eightKItems: list(f.eightK),
        form4Codes: list(f.form4).map((c) => c.toUpperCase()),
        newsMinTier: f.newsTier === '' ? null : (Number(f.newsTier) as 1 | 2 | 3),
        halts: f.halts,
        movePct: move,
        volumeRatio: volume,
      },
      plan: {
        entry: f.entry.trim(),
        chaseGuardPct: chase,
        invalidation: f.invalidation.trim(),
        size: f.size.trim(),
      },
      expiresOn: f.expires.trim(),
    };
    const tr = draft.triggers;
    const ok =
      draft.name !== '' &&
      draft.tickers.length > 0 &&
      !tickers.includes(null) &&
      (tr.eightKItems.length > 0 ||
        tr.form4Codes.length > 0 ||
        tr.newsMinTier !== null ||
        tr.halts ||
        tr.movePct !== null) &&
      (move === null || (move > 0 && move < 1)) &&
      (volume === null || volume > 0) &&
      draft.plan.entry !== '' &&
      draft.plan.invalidation !== '' &&
      chase > 0 &&
      chase < 1 &&
      /^\d{4}-\d{2}-\d{2}$/.test(draft.expiresOn);
    setBad(!ok);
    if (ok) save.mutate(draft);
  };
  return (
    <form onSubmit={submit} aria-label={x.add} className="flex flex-col gap-3">
      {!stepped && <h3 className="text-sm font-semibold">{x.add}</h3>}
      {stepped && (
        <p className="text-sm font-semibold text-up" aria-live="polite">
          {x.stepOf(step + 1, x.steps[step] ?? '')}
        </p>
      )}
      <div hidden={!show(0)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sc-name" label={x.name} value={f.name} onChange={set('name')} />
        <Field id="sc-tickers" label={x.tickers} value={f.tickers} onChange={set('tickers')} />
        <Field id="sc-keywords" label={x.keywords} value={f.keywords} onChange={set('keywords')} />
      </div>
      <div hidden={!show(1)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sc-8k" label={x.eightK} value={f.eightK} onChange={set('eightK')} />
        <Field id="sc-f4" label={x.form4} value={f.form4} onChange={set('form4')} />
        <label className="flex flex-col gap-1 text-sm text-muted">
          {x.newsTier}
          <select
            className="min-h-11 rounded-sm border border-line bg-bg px-2 text-fg"
            value={f.newsTier}
            onChange={set('newsTier')}
          >
            <option value="">{x.newsNone}</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={String(n)}>
                {x.tier(n)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.halts}
            onChange={(e) => setF({ ...f, halts: e.target.checked })}
          />
          {x.halts}
        </label>
        <Field
          id="sc-move"
          label={x.move}
          inputMode="decimal"
          value={f.move}
          onChange={set('move')}
        />
        <Field
          id="sc-volume"
          label={x.volume}
          inputMode="decimal"
          value={f.volume}
          onChange={set('volume')}
        />
      </div>
      <div hidden={!show(2)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sc-entry" label={x.entry} value={f.entry} onChange={set('entry')} />
        <Field
          id="sc-chase"
          label={x.chase}
          inputMode="decimal"
          value={f.chase}
          onChange={set('chase')}
        />
        <Field
          id="sc-invalidation"
          label={x.invalidation}
          value={f.invalidation}
          onChange={set('invalidation')}
        />
        <Field id="sc-size" label={x.size} value={f.size} onChange={set('size')} />
        <Field id="sc-expires" label={x.expires} value={f.expires} onChange={set('expires')} />
      </div>
      {stepped && step === 3 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-bg/45 p-3 text-sm">
          {(
            [
              [x.name, f.name],
              [x.tickers, f.tickers],
              [x.keywords, f.keywords],
              [x.eightK, f.eightK],
              [x.form4, f.form4],
              [x.entry, f.entry],
              [x.chase, f.chase],
              [x.invalidation, f.invalidation],
              [x.expires, f.expires],
            ] as const
          ).map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="text-fg">{val.trim() || x.reviewEmpty}</dd>
            </div>
          ))}
        </dl>
      )}
      {stepped && step < 3 && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
            {x.back}
          </Button>
          <Button type="button" onClick={() => setStep(step + 1)}>
            {x.next}
          </Button>
        </div>
      )}
      {(!stepped || step === 3) && (
        <div className={stepped ? 'grid grid-cols-2 gap-2' : ''}>
          {stepped && (
            <Button type="button" onClick={() => setStep(2)}>
              {x.back}
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {x.save}
          </Button>
        </div>
      )}
      {bad && <ErrorText message={x.invalid} />}
      {save.isError && <ErrorText message={save.error.message} />}
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

export function Scenarios() {
  const q = useQuery({ queryKey: ['scenarios'], queryFn: loadScenarios });
  const wide = useWide();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="scenarios" className="flex flex-col gap-3">
      <h2 id="scenarios" className="font-semibold">
        {x.title}
      </h2>
      <p className="text-[13px] text-muted">{x.sub}</p>
      <p className="hidden text-sm text-muted tablet:block">{x.intro}</p>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.length === 0 ? (
          <p className="text-muted">{x.none}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 wide:grid-cols-3">
            {q.data.map((s) => (
              <ScenarioItem key={s.id} s={s} />
            ))}
          </ul>
        ))}
      {wide ? (
        <NewScenario />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-[52px] rounded-[14px] bg-white text-base font-bold text-raised"
          >
            {x.newScenario}
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title={x.add}>
            <NewScenario stepped />
          </Sheet>
        </>
      )}
    </section>
  );
}
