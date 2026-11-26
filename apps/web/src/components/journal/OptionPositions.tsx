import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_LEGS,
  etDate,
  normalizeTicker,
  optionExitSignals,
  optionPositionView,
  toFixedHalfUp,
  validateOptionPosition,
  type OptionPosition,
} from '@marsad/core';
import { Button, ErrorText, Field } from '../ui';
import {
  addOptionPosition,
  closeOptionPosition,
  loadOptionPositions,
  type StoredOptionPosition,
} from '../../lib/optionPositions';
import { cardClass } from '../Card';
import { panelTitle } from '../study/Panel';
import { t } from '../../strings';

const x = t.journal.options;
const usd = (v: number) => `${v < 0 ? '-' : ''}$${toFixedHalfUp(Math.abs(v), 2)}`;
const selectCls = 'min-h-11 rounded-sm border border-line bg-bg px-2 text-fg';

function PositionCard({
  p,
  close,
}: {
  p: StoredOptionPosition;
  close: { value: number; asOf: string } | null;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const today = etDate(new Date());
  const v = optionPositionView(p, close, today);
  const signals = optionExitSignals(p, v);
  const done = useMutation({
    mutationFn: () => closeOptionPosition(p.id, today, note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['option-positions'] }),
  });
  const legText = p.legs
    .map(
      (l) =>
        `${l.qty > 0 ? '+' : ''}${l.qty} ${p.underlying} ${l.strike} ${l.type} at ${toFixedHalfUp(l.price, 2)}`,
    )
    .join('; ');
  return (
    <li className="flex flex-col gap-1 rounded-sm border border-line p-3 text-sm">
      <h3 className="font-semibold">
        {p.label} ({p.underlying})
      </h3>
      <p className="font-mono text-xs">{legText}</p>
      <p>
        {x.premium(v.netPremium >= 0, usd(Math.abs(v.netPremium)))}.{' '}
        {x.risk(usd(v.maxLoss), v.maxGain === null ? x.unlimited : usd(v.maxGain))}.
      </p>
      <p>{x.breakevens(v.breakevens.map((b) => toFixedHalfUp(b, 2)).join(', '))}.</p>
      <p>{x.dte(v.dte, p.expiry)}.</p>
      <p>
        {v.close === null || v.atExpiryIfUnchanged === null
          ? x.noClose
          : x.atClose(usd(v.atExpiryIfUnchanged), toFixedHalfUp(v.close.value, 2), v.close.asOf)}
      </p>
      <p className="text-muted">{x.unavailable}</p>
      <ul className="list-disc ps-5">
        {signals.map((s) => (
          <li key={s.rule} className={s.met ? 'font-medium' : ''}>
            {s.met ? 'Now: ' : ''}
            {s.text}
          </li>
        ))}
      </ul>
      <p>
        <span className="font-medium">{x.bearCase}:</span> {p.bearCase}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          id={`close-note-${p.id}`}
          label={x.closeNote}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="button" disabled={done.isPending} onClick={() => done.mutate()}>
          {x.close}
        </Button>
      </div>
      {done.isError && <ErrorText message={done.error.message} />}
    </li>
  );
}

interface LegDraft {
  type: 'call' | 'put';
  side: 'long' | 'short';
  contracts: string;
  strike: string;
  price: string;
}
const NEW_LEG: LegDraft = { type: 'call', side: 'long', contracts: '1', strike: '', price: '' };

function NewPosition() {
  const qc = useQueryClient();
  const today = etDate(new Date());
  const [f, setF] = useState({
    underlying: '',
    label: '',
    expiry: '',
    openedOn: today,
    exitDte: '21',
    profitTake: '50',
    lossLimit: '',
    bear: '',
  });
  const [legs, setLegs] = useState<LegDraft[]>([NEW_LEG]);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: addOptionPosition,
    onSuccess: () => {
      setMsg(x.saved);
      setLegs([NEW_LEG]);
      void qc.invalidateQueries({ queryKey: ['option-positions'] });
    },
  });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const pct = (v: string) => (v.trim() === '' ? null : Number(v) / 100);
  const setLeg = (i: number, patch: Partial<LegDraft>) =>
    setLegs(legs.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const p: OptionPosition = {
      underlying: normalizeTicker(f.underlying) ?? f.underlying.trim().toUpperCase(),
      label: f.label,
      expiry: f.expiry.trim(),
      legs: legs.map((l) => ({
        type: l.type,
        strike: Number(l.strike),
        qty: (l.side === 'short' ? -1 : 1) * Number(l.contracts),
        price: Number(l.price),
      })),
      openedOn: f.openedOn.trim(),
      exitDte: num(f.exitDte),
      profitTakePct: pct(f.profitTake),
      lossLimitPct: pct(f.lossLimit),
      bearCase: f.bear,
    };
    const errs = validateOptionPosition(p, today);
    setErrors(errs);
    if (errs.length === 0) save.mutate(p);
  };
  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  });
  return (
    <form onSubmit={submit} aria-label={x.add} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{x.add}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id="op-underlying" label={x.underlying} {...field('underlying')} />
        <Field id="op-label" label={x.label} {...field('label')} />
        <Field id="op-expiry" label={x.expiry} {...field('expiry')} />
      </div>
      {legs.map((l, i) => (
        <fieldset
          key={i}
          className="flex flex-wrap items-end gap-2 rounded-sm border border-line p-2"
        >
          <legend className="px-1 text-sm">{x.leg(i + 1)}</legend>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {x.legType}
            <select
              className={selectCls}
              value={l.type}
              onChange={(e) => setLeg(i, { type: e.target.value === 'put' ? 'put' : 'call' })}
            >
              <option value="call">call</option>
              <option value="put">put</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {x.side}
            <select
              className={selectCls}
              value={l.side}
              onChange={(e) => setLeg(i, { side: e.target.value === 'short' ? 'short' : 'long' })}
            >
              <option value="long">{x.long}</option>
              <option value="short">{x.short}</option>
            </select>
          </label>
          <Field
            id={`op-contracts-${i}`}
            label={x.contracts}
            inputMode="numeric"
            value={l.contracts}
            onChange={(e) => setLeg(i, { contracts: e.target.value })}
          />
          <Field
            id={`op-strike-${i}`}
            label={x.strike}
            inputMode="decimal"
            value={l.strike}
            onChange={(e) => setLeg(i, { strike: e.target.value })}
          />
          <Field
            id={`op-price-${i}`}
            label={x.price}
            inputMode="decimal"
            value={l.price}
            onChange={(e) => setLeg(i, { price: e.target.value })}
          />
          {legs.length > 1 && (
            <Button type="button" onClick={() => setLegs(legs.filter((_, k) => k !== i))}>
              {x.removeLeg(i + 1)}
            </Button>
          )}
        </fieldset>
      ))}
      {legs.length < MAX_LEGS && (
        <Button type="button" className="self-start" onClick={() => setLegs([...legs, NEW_LEG])}>
          {x.addLeg}
        </Button>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="op-opened" label={x.openedOn} {...field('openedOn')} />
        <Field id="op-dte" label={x.exitDte} inputMode="numeric" {...field('exitDte')} />
        <Field id="op-take" label={x.profitTake} inputMode="decimal" {...field('profitTake')} />
        <Field id="op-loss" label={x.lossLimit} inputMode="decimal" {...field('lossLimit')} />
      </div>
      <Field id="op-bear" label={x.bear} {...field('bear')} />
      <Button type="submit" className="self-start" disabled={save.isPending}>
        {x.save}
      </Button>
      {errors.map((e) => (
        <ErrorText key={e} message={e} />
      ))}
      {save.isError && <ErrorText message={save.error.message} />}
      {msg && <p className="text-sm">{msg}</p>}
    </form>
  );
}

/** Options positions on the Journal page (ADR 0034). */
export function OptionPositions() {
  const q = useQuery({ queryKey: ['option-positions'], queryFn: loadOptionPositions });
  return (
    <section aria-labelledby="option-positions" className={`${cardClass} gap-3!`}>
      <h2 id="option-positions" className={panelTitle}>
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.positions.length === 0 ? (
          <p className="text-muted">{x.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.positions.map((p) => (
              <PositionCard key={p.id} p={p} close={q.data.closes[p.underlying] ?? null} />
            ))}
          </ul>
        ))}
      <NewPosition />
    </section>
  );
}
