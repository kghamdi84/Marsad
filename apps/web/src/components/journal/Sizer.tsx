import { useState } from 'react';
import {
  CHECKLIST_V2,
  checklistComplete,
  positionSize,
  rewardRisk,
  sahmTicket,
  toFixedHalfUp,
  type ChecklistKey,
} from '@marsad/core';
import { StatTile, usd0 } from './shared';
import { t } from '../../strings';

const s = t.journal.sizer;
const level = (v: number) => toFixedHalfUp(v, 2);

function Input({
  id,
  label,
  value,
  onChange,
  decimal = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs text-ink3">
      {label}
      <input
        id={id}
        inputMode={decimal ? 'decimal' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-canvas px-3 text-[15px] text-ink tabular-nums"
      />
    </label>
  );
}

/**
 * The position sizer, the five-item checklist and the manual Sahm ticket. The copy button stays disabled until all
 * five items are ticked and the ticket is complete (hard rule). Marsad never places the order.
 */
export function Sizer({ initialTicker = '' }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker);
  const [account, setAccount] = useState('50000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [targets, setTargets] = useState('');
  const [ticked, setTicked] = useState<Partial<Record<ChecklistKey, boolean>>>({});
  const [copied, setCopied] = useState(false);
  const edit = (set: (v: string) => void) => (v: string) => {
    setCopied(false);
    set(v);
  };
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
    .split(/[\s,]+/)
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
          tif: 'GTC',
        })
      : null;
  const n = Object.values(ticked).filter(Boolean).length;
  const ready = checklistComplete(ticked) && ticket !== null;
  const rr = ok && tgts.length > 0 ? rewardRisk(Number(entry), Number(stop), tgts) : [];
  const chips = rr.map((r, i) => s.rrChip(level(tgts[i] ?? 0), toFixedHalfUp(r, 1)));
  return (
    <section
      aria-labelledby="sizer"
      className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5 rounded-xl border border-line bg-surface p-[18px]"
    >
      <h2 id="sizer" className="sr-only">
        {s.title}
      </h2>
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-base font-semibold text-ink">{s.sizerTitle}</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <Input
            id="sz-ticker"
            label={s.ticker}
            value={ticker}
            onChange={edit(setTicker)}
            decimal={false}
          />
          <Input id="sz-account" label={s.fAccount} value={account} onChange={edit(setAccount)} />
          <Input id="sz-risk" label={s.fRisk} value={risk} onChange={edit(setRisk)} />
          <Input id="sz-entry" label={s.fEntry} value={entry} onChange={edit(setEntry)} />
          <Input id="sz-stop" label={s.stop} value={stop} onChange={edit(setStop)} />
          <Input
            id="sz-targets"
            label={s.fTargets}
            value={targets}
            onChange={edit(setTargets)}
            decimal={false}
          />
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5">
          <StatTile label={s.rShares} value={ok ? String(size.shares) : s.na} />
          <StatTile label={s.rRisk} value={ok ? `$${usd0(size.risk)}` : s.na} />
          <StatTile
            label={s.rPosition}
            value={ok ? `$${usd0(size.positionValue)}` : s.na}
            sub={ok ? s.rOfAccount(`${toFixedHalfUp(size.pctOfAccount * 100, 1)}%`) : undefined}
          />
          <StatTile
            label={s.rRR}
            value={rr[0] !== undefined ? `${toFixedHalfUp(rr[0], 1)}R` : s.na}
            sub={chips.length > 0 ? chips.join(' · ') : ok ? s.rrNone : undefined}
            tone={rr[0] !== undefined ? 'text-up' : 'text-ink3'}
          />
        </div>
        {ok && size.capped && <p className="text-xs text-warn">{s.capped}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <h3 className="text-base font-semibold text-ink">{s.checklistTitle}</h3>
        <div role="group" aria-label={s.checksLabel} className="flex flex-col gap-2.5">
          {CHECKLIST_V2.map((c) => {
            const on = ticked[c.key] === true;
            const [label, sub] = s.checks[c.key] ?? [c.label, ''];
            return (
              <button
                key={c.key}
                type="button"
                role="checkbox"
                aria-checked={on}
                title={c.label}
                onClick={() => {
                  setCopied(false);
                  setTicked({ ...ticked, [c.key]: !on });
                }}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-start text-[13px] text-ink ${
                  on ? 'border-ink3 bg-elev' : 'border-line'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-5 flex-none place-items-center rounded-[5px] border-2 ${
                    on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
                  }`}
                >
                  {on && (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                </span>
                <span className="flex flex-col">
                  <span>{label}</span>
                  {sub && <span className="hidden text-xs text-ink3 tablet:inline">{sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <code
          data-testid="sahm-ticket"
          className={`rounded-lg border border-line bg-canvas p-3 font-mono text-[13px] [overflow-wrap:anywhere] ${
            ticket ? 'text-ink' : 'text-ink3'
          }`}
        >
          {ticket ?? s.ticketEmpty}
        </code>
        <button
          type="button"
          aria-disabled={!ready}
          onClick={() => {
            if (!ready || !ticket) return;
            void navigator.clipboard?.writeText(ticket).then(() => setCopied(true));
          }}
          className={`min-h-12 rounded-[10px] text-[15px] font-semibold ${
            ready ? 'bg-accent text-accent-ink' : 'cursor-not-allowed bg-sub text-ink3'
          }`}
        >
          {copied ? s.copiedShort : ready ? s.copy : s.copyCount(n)}
        </button>
        <p className="text-xs text-ink3">{s.manual}</p>
        <p role="status" className="sr-only">
          {copied ? s.copied : ''}
        </p>
      </div>
    </section>
  );
}
