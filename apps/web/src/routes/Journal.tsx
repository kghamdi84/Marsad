import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHECKLIST,
  checklistComplete,
  etDate,
  exitSignals,
  parseHoldingsCsv,
  positionSize,
  rewardRisk,
  sahmTicket,
  toFixedHalfUp,
  unrealized,
  type ChecklistKey,
} from '@marsad/core';
import { Button, ErrorText, Field } from '../components/ui';
import { num, td, th, thNum } from '../components/study/Panel';
import { addHoldings, closeHolding, loadHoldings, type StoredHolding } from '../lib/journal';
import { t } from '../strings';

const j = t.journal;
const money = (v: number) => toFixedHalfUp(v, 2);
const pct = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, 1)}%`;

function Sizer() {
  const s = j.sizer;
  const [ticker, setTicker] = useState('');
  const [account, setAccount] = useState('50000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [targets, setTargets] = useState('');
  const [tif, setTif] = useState<'GTC' | 'DAY'>('GTC');
  const [ticked, setTicked] = useState<Partial<Record<ChecklistKey, boolean>>>({});
  const [copied, setCopied] = useState(false);
  const size =
    entry && stop
      ? positionSize({
          account: Number(account),
          riskPct: Number(risk) / 100,
          entry: Number(entry),
          stop: Number(stop),
        })
      : null;
  const tgts = targets
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((x) => x > 0);
  const ok = size !== null && !('error' in size);
  const ticket =
    ok && /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(ticker)
      ? sahmTicket({
          side: 'BUY',
          shares: size.shares,
          ticker: ticker.toUpperCase(),
          type: 'LIMIT',
          limit: Number(entry),
          stop: Number(stop),
          tif,
        })
      : null;
  const complete = checklistComplete(ticked);
  return (
    <section aria-labelledby="sizer" className="flex flex-col gap-3">
      <h2 id="sizer" className="font-semibold">
        {s.title}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          id="sz-ticker"
          label={s.ticker}
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
        />
        <Field
          id="sz-account"
          label={s.account}
          inputMode="decimal"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
        <Field
          id="sz-risk"
          label={s.risk}
          inputMode="decimal"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
        />
        <Field
          id="sz-entry"
          label={s.entry}
          inputMode="decimal"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
        />
        <Field
          id="sz-stop"
          label={s.stop}
          inputMode="decimal"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
        />
        <Field
          id="sz-targets"
          label={s.targets}
          value={targets}
          onChange={(e) => setTargets(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm text-muted">
          {s.tif}
          <select
            className="min-h-11 rounded-sm border border-line bg-bg px-2 text-fg"
            value={tif}
            onChange={(e) => setTif(e.target.value as 'GTC' | 'DAY')}
          >
            <option value="GTC">GTC</option>
            <option value="DAY">DAY</option>
          </select>
        </label>
      </div>
      {size && 'error' in size && <ErrorText message={size.error} />}
      {ok && (
        <div className="text-sm">
          <p>
            {s.result(
              size.shares,
              money(size.risk),
              money(size.positionValue),
              pct(size.pctOfAccount).replace('+', ''),
            )}
          </p>
          {size.capped && <p className="text-muted">{s.capped}</p>}
          {tgts.length > 0 && (
            <p>
              {s.rr(
                rewardRisk(Number(entry), Number(stop), tgts)
                  .map((r) => `${toFixedHalfUp(r, 1)}R`)
                  .join(', '),
              )}
            </p>
          )}
        </div>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{s.checklist}</legend>
        {CHECKLIST.map((c) => (
          <label key={c.key} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ticked[c.key] === true}
              onChange={(e) => {
                setCopied(false);
                setTicked({ ...ticked, [c.key]: e.target.checked });
              }}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      {ticket && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{s.ticket}</p>
          <code className="rounded-sm bg-raised p-2 text-sm" data-testid="sahm-ticket">
            {ticket}
          </code>
          <Button
            type="button"
            disabled={!complete}
            onClick={() => {
              void navigator.clipboard?.writeText(ticket).then(() => setCopied(true));
            }}
          >
            {s.copy}
          </Button>
          {!complete && <p className="text-sm text-muted">{s.incomplete}</p>}
          {copied && <p className="text-sm">{s.copied}</p>}
        </div>
      )}
    </section>
  );
}

function HoldingRow({ h, bars }: { h: StoredHolding; bars: Parameters<typeof exitSignals>[1] }) {
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: () => closeHolding(h.id, etDate(new Date())),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holdings'] }),
  });
  const hh = j.holdings;
  const last = bars.at(-1);
  const u = last ? unrealized(h, last.close) : null;
  const exits = exitSignals(h, bars);
  const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
  return (
    <tr>
      <td className={`${td} font-medium`}>{h.ticker}</td>
      <td className={`${td} ${num}`}>{h.shares}</td>
      <td className={`${td} ${num}`}>{money(h.costBasis)}</td>
      <td className={`${td} ${num}`}>
        {last ? `${money(last.close)} (${last.date})` : t.regime.noData}
      </td>
      <td className={`${td} ${num}`}>{u ? `${pct(u.pct)} (USD ${money(u.usd)})` : ''}</td>
      <td className={td}>
        {hasRules ? (
          <span className="text-xs text-muted">
            {hh.rules(
              h.stop === null ? hh.none2 : money(h.stop),
              h.targets.length ? h.targets.map(money).join(', ') : hh.none2,
              h.trendBreak ? `${h.trendBreak.ind}${h.trendBreak.period}` : hh.none2,
              h.timeStopSessions === null ? hh.none2 : String(h.timeStopSessions),
            )}
          </span>
        ) : (
          <span className="text-xs text-down">{hh.noRules}</span>
        )}
        {exits.map((e) => (
          <span key={e.kind} className="block text-sm font-medium">
            {hh.triggered}: {e.detail}
          </span>
        ))}
        <button
          type="button"
          className="mt-1 min-h-11 text-sm text-muted underline"
          onClick={() => close.mutate()}
        >
          {hh.close}
        </button>
      </td>
    </tr>
  );
}

function Holdings() {
  const hh = j.holdings;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: addHoldings,
    onSuccess: (_d, rows) => {
      setMsg(hh.csvAdded(rows.length));
      void qc.invalidateQueries({ queryKey: ['holdings'] });
    },
  });
  const submitCsv = (e: FormEvent) => {
    e.preventDefault();
    const r = parseHoldingsCsv(csv);
    setErrs(r.errors);
    setMsg(null);
    if (r.errors.length === 0 && r.holdings.length > 0) add.mutate(r.holdings);
  };
  return (
    <section aria-labelledby="holdings" className="flex flex-col gap-3">
      <h2 id="holdings" className="font-semibold">
        {hh.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.holdings.length === 0 ? (
          <p className="text-muted">{hh.none}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{hh.colTicker}</th>
                  <th className={thNum}>{hh.colShares}</th>
                  <th className={thNum}>{hh.colCost}</th>
                  <th className={thNum}>{hh.colLast}</th>
                  <th className={thNum}>{hh.colResult}</th>
                  <th className={th}>{hh.colExits}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.holdings.map((h) => (
                  <HoldingRow key={h.id} h={h} bars={q.data.bars[h.ticker] ?? []} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <form onSubmit={submitCsv} className="flex flex-col gap-2">
        <label htmlFor="csv" className="text-sm font-medium">
          {hh.csvTitle}
        </label>
        <p className="text-xs text-muted">{hh.csvHelp}</p>
        <textarea
          id="csv"
          rows={4}
          className="rounded-sm border border-line bg-bg p-2 font-mono text-sm text-fg"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <Button type="submit" disabled={add.isPending}>
          {hh.csvButton}
        </Button>
        {errs.map((x) => (
          <ErrorText key={x} message={x} />
        ))}
        {add.isError && <ErrorText message={add.error.message} />}
        {msg && <p className="text-sm">{msg}</p>}
      </form>
    </section>
  );
}

export function Journal() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{j.title}</h1>
        <p className="text-sm text-muted">{j.intro}</p>
      </div>
      <Sizer />
      <Holdings />
    </section>
  );
}
