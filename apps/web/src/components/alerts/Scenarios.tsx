import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeTicker, toFixedHalfUp, type CatalystScenario } from '@marsad/core';
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
    <li className="flex flex-col gap-1 rounded-sm border border-line p-3 text-sm">
      <h3 className="font-semibold">
        {s.name} ({s.tickers.join(', ')})
      </h3>
      <p>{x.triggersLine(triggerText(s))}</p>
      <p>{x.planLine(s.plan.entry, pctText(s.plan.chaseGuardPct), s.plan.invalidation)}</p>
      <p className="text-muted">{x.expiresLine(s.expiresOn, s.active)}</p>
      <Button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
        {s.active ? x.pause : x.resume}
      </Button>
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

function NewScenario() {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [bad, setBad] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: addScenario,
    onSuccess: () => {
      setMsg(x.saved);
      setF(EMPTY);
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
      <h3 className="text-sm font-semibold">{x.add}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="sc-name" label={x.name} value={f.name} onChange={set('name')} />
        <Field id="sc-tickers" label={x.tickers} value={f.tickers} onChange={set('tickers')} />
        <Field id="sc-keywords" label={x.keywords} value={f.keywords} onChange={set('keywords')} />
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
      <Button type="submit" disabled={save.isPending}>
        {x.save}
      </Button>
      {bad && <ErrorText message={x.invalid} />}
      {save.isError && <ErrorText message={save.error.message} />}
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

export function Scenarios() {
  const q = useQuery({ queryKey: ['scenarios'], queryFn: loadScenarios });
  return (
    <section aria-labelledby="scenarios" className="flex flex-col gap-3">
      <h2 id="scenarios" className="font-semibold">
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.length === 0 ? (
          <p className="text-muted">{x.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.map((s) => (
              <ScenarioItem key={s.id} s={s} />
            ))}
          </ul>
        ))}
      <NewScenario />
    </section>
  );
}
