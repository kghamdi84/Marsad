import { useState, type FormEvent } from 'react';
import { Info } from '../components/Info';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHECKLIST,
  SECTOR_ETFS,
  beta,
  checklistComplete,
  correlationPairs,
  etDate,
  exitSignals,
  parseHoldingsCsv,
  exposureReport,
  markDuplicateHoldings,
  portfolioTotals,
  sessionsHeld,
  positionSize,
  rewardRisk,
  rotationSignal,
  sahmTicket,
  toFixedHalfUp,
  unrealized,
  vixSensitivity,
  type ChecklistKey,
  type DatedValue,
  type ThesisStatus,
} from '@marsad/core';
import { Check } from 'lucide-react';
import { Button, ErrorText, Field } from '../components/ui';
import { EtfLookThrough } from '../components/journal/EtfLookThrough';
import { OptionPositions } from '../components/journal/OptionPositions';
import { Trades } from '../components/journal/Trades';
import { panelTitle } from '../components/study/Panel';
import {
  addHoldings,
  closeHolding,
  loadHoldings,
  loadWeeklyReview,
  updateHoldingMeta,
  type BarsByTicker,
  type StoredHolding,
} from '../lib/journal';
import { SkeletonCards, Tabs, useRemembered, useWide } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { dayMonth, weekdayDayMonth } from '../lib/dates';
import { TickerLink } from '../components/QuickLook';
import { t } from '../strings';

const j = t.journal;
const money = (v: number) => toFixedHalfUp(v, 2);
const share = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
const select = 'min-h-11 rounded-sm border border-line bg-bg px-2 text-fg';

function Sizer() {
  const s = j.sizer;
  const wide = useWide();
  const [ticker, setTicker] = useState('');
  const [account, setAccount] = useState('50000');
  const [risk, setRisk] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [targets, setTargets] = useState('');
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
  const box = 'flex flex-col gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5';
  const head = (num: string, title: string, aside?: string) => (
    <h3 className="flex items-baseline justify-between text-[0.9375rem] font-semibold">
      <span>
        <span className="text-muted">{num}</span> {title}
      </span>
      {aside && <span className="text-[0.8125rem] font-normal text-muted">{aside}</span>}
    </h3>
  );
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    dec = true,
  ) => (
    <Field
      id={id}
      label={label}
      inputMode={dec ? 'decimal' : 'text'}
      value={value}
      onChange={(e) => {
        setCopied(false);
        set(e.target.value);
      }}
    />
  );
  const results: [string, string][] = ok
    ? [
        [s.rShares, String(size.shares)],
        [s.rRisk, `$${usd0(size.risk)}`],
        [s.rPosition, `$${usd0(size.positionValue)}`],
        [s.rOfAccount, `${toFixedHalfUp(size.pctOfAccount * 100, 1)}%`],
      ]
    : [
        [s.rShares, s.na],
        [s.rRisk, s.na],
        [s.rPosition, s.na],
        [s.rOfAccount, s.na],
      ];
  const copyButton = (
    <button
      type="button"
      aria-disabled={!ready}
      onClick={() => {
        if (!ready || !ticket) return;
        void navigator.clipboard?.writeText(ticket).then(() => setCopied(true));
      }}
      className={`min-h-[54px] w-full rounded-[14px] text-[1.0625rem] font-bold ${
        ready ? 'bg-white text-raised' : 'cursor-not-allowed bg-faint/22 text-fg'
      }`}
    >
      {copied ? s.copiedShort : ready ? s.copy : s.copyCount(n)}
    </button>
  );
  return (
    <section aria-labelledby="sizer" className="flex flex-col gap-3.5 pb-24 tablet:pb-0">
      <h2 id="sizer" className="sr-only">
        {s.title}
      </h2>
      <div className={box}>
        {head('01', s.prices)}
        <div className="grid grid-cols-2 gap-2.5 tablet:grid-cols-3">
          {field('sz-ticker', s.ticker, ticker, setTicker, false)}
          {field('sz-account', s.fAccount, account, setAccount)}
          {field('sz-risk', s.fRisk, risk, setRisk)}
          {field('sz-entry', s.fEntry, entry, setEntry)}
          {field('sz-stop', s.stop, stop, setStop)}
          {field('sz-targets', s.fTargets, targets, setTargets, false)}
        </div>
      </div>
      <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-raised px-4 py-3.5">
        {head('02', s.size)}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 tablet:grid-cols-4">
          {results.map(([label, v]) => (
            <span key={label} className="flex flex-col">
              <span className="text-[0.8125rem] text-muted">{label}</span>
              <span className="text-[1.375rem] font-bold tabular-nums">{v}</span>
            </span>
          ))}
        </div>
        {ok && size.capped && <p className="text-[0.8125rem] text-warn">{s.capped}</p>}
        {ok && tgts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rewardRisk(Number(entry), Number(stop), tgts).map((r, i) => (
              <span
                key={tgts[i]}
                className="rounded-full bg-up/16 px-2.5 py-1 text-[0.8125rem] font-semibold text-up"
              >
                {s.rrChip(level(tgts[i] ?? 0), toFixedHalfUp(r, 1))}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={box}>
        {head('03', s.checklistTitle, s.checkCount(n))}
        {CHECKLIST.map((c) => {
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
              className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 text-start text-[0.9375rem] ${
                on ? 'border-up bg-ink/35' : 'border-muted/30'
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-[22px] flex-none place-items-center rounded-md border-2 ${
                  on ? 'border-up bg-ink' : 'border-muted'
                }`}
              >
                {on && <Check size={14} strokeWidth={3} className="text-white" />}
              </span>
              <span className="flex flex-col">
                <span>{label}</span>
                <span className="hidden text-[0.8125rem] text-muted tablet:inline">{sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      <code
        data-testid="sahm-ticket"
        className={`rounded-2xl border border-line bg-surface px-4 py-3.5 font-mono text-[0.9375rem] break-words ${
          ticket ? 'text-white' : 'text-muted'
        }`}
      >
        {ticket ?? s.ticketEmpty}
      </code>
      {wide ? (
        copyButton
      ) : (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+57px)] z-[45] border-t border-faint/30 bg-bg/96 px-4 py-2.5">
          {copyButton}
        </div>
      )}
      <p role="status" className="sr-only">
        {copied ? s.copied : ''}
      </p>
    </section>
  );
}

/** Whole dollars with thousands separators, as the design writes money ("$97,887"). */
const usd0 = (v: number) => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
/** "▲ +$9,258" or "▼ −$408": sign, arrow and colour together (colour is never the only signal). */
const signedUsd = (v: number) => `${v >= 0 ? '▲ +' : '▼ −'}$${usd0(v)}`;
/** "+20.6%" or "−3.4%" from a fraction. */
const signedPct1 = (v: number) => `${v >= 0 ? '+' : '−'}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;
/** A target as stored: whole numbers without decimals ("205"), others with two ("27.50"). */
const level = (v: number) => (Number.isInteger(v) ? String(v) : money(v));

/**
 * The design's stop, now, target bar: a 10 px gradient from orange through neutral to blue, a cost tick and a
 * 22 px "now" dot, with the stop in orange, now in white and the targets in blue below it.
 */
function PlanBar({ h, last }: { h: StoredHolding; last: number | null }) {
  if (last === null || h.stop === null) return null;
  const lo = Math.min(h.stop, h.costBasis, last) * 0.985;
  const hi = Math.max(...h.targets, last) * 1.01;
  const at = (v: number) => `${toFixedHalfUp(((v - lo) / (hi - lo)) * 100, 1)}%`;
  const ui = j.ui;
  const targets = h.targets.length ? h.targets.map(level).join(', ') : j.holdings.none2;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={ui.barAria(money(h.stop), money(last), targets)}
        className="relative h-2.5 rounded-[5px] bg-[linear-gradient(90deg,rgba(255,159,90,0.65),rgba(138,153,178,0.25)_40%,rgba(127,168,255,0.6))]"
      >
        <span
          className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-muted"
          style={{ insetInlineStart: at(h.costBasis) }}
        />
        <span
          className="absolute -top-1.5 -ms-[11px] size-[22px] rounded-full border-4 border-surface bg-white"
          style={{ insetInlineStart: at(last) }}
        />
      </div>
      <div className="flex justify-between text-[0.8125rem] tabular-nums">
        <span className="text-down">
          {ui.barStop} {money(h.stop)}
        </span>
        <span>
          {ui.barNow} {money(last)}
        </span>
        <span className="text-up">
          {ui.barTarget} {targets}
        </span>
      </div>
    </div>
  );
}

const NEXT_THESIS: Record<ThesisStatus, ThesisStatus> = {
  intact: 'weakening',
  weakening: 'broken',
  broken: 'intact',
};
const THESIS_DOT: Record<ThesisStatus, string> = {
  intact: 'bg-up',
  weakening: 'bg-warn',
  broken: 'bg-down',
};

/** What the design leaves off the card, behind "Edit holding": exit details, rules, sector and closing. */
function HoldingEdit({ h, all }: { h: StoredHolding; all: BarsByTicker }) {
  const bars = all[h.ticker] ?? [];
  const rot = rotationOf(h, all);
  const qc = useQueryClient();
  const close = useMutation({
    mutationFn: () => closeHolding(h.id, etDate(new Date())),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holdings'] }),
  });
  const meta = useMutation({
    mutationFn: (m: { sectorEtf: string | null; thesisStatus: ThesisStatus }) =>
      updateHoldingMeta(h.id, m),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holdings'] }),
  });
  const hh = j.holdings;
  const exits = exitSignals(h, bars);
  const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
  return (
    <div className="flex flex-col gap-3">
      {exits.map((e) => (
        <p key={e.kind} className="text-sm font-medium">
          {hh.triggered}: {e.detail}
        </p>
      ))}
      <p className="text-sm">
        <span className="font-medium">{j.rotation.suggestion[rot.suggestion]}</span>
        <span className="block text-xs text-muted">{rot.text}</span>
      </p>
      {hasRules ? (
        <p className="text-xs text-muted">
          {hh.rules(
            h.stop === null ? hh.none2 : money(h.stop),
            h.targets.length ? h.targets.map(money).join(', ') : hh.none2,
            h.trendBreak ? `${h.trendBreak.ind}${h.trendBreak.period}` : hh.none2,
            h.timeStopSessions === null ? hh.none2 : String(h.timeStopSessions),
          )}
        </p>
      ) : (
        <p className="text-xs text-down">{hh.noRules}</p>
      )}
      <label className="flex flex-col text-xs text-muted">
        {hh.sector}
        <select
          className={select}
          value={h.sectorEtf ?? ''}
          onChange={(e) =>
            meta.mutate({ sectorEtf: e.target.value || null, thesisStatus: h.thesisStatus })
          }
        >
          <option value="">{hh.sectorNone}</option>
          {SECTOR_ETFS.map((s) => (
            <option key={s.ticker} value={s.ticker}>
              {s.ticker} ({s.sector})
            </option>
          ))}
        </select>
      </label>
      {meta.isError && <ErrorText message={meta.error.message} />}
      <button
        type="button"
        className="min-h-11 self-start text-sm text-muted underline"
        onClick={() => close.mutate()}
      >
        {hh.close}
      </button>
    </div>
  );
}

/** One holding as the design draws it, the same card on every width. */
function HoldingCard({ h, all }: { h: StoredHolding; all: BarsByTicker }) {
  const bars = all[h.ticker] ?? [];
  const qc = useQueryClient();
  const meta = useMutation({
    mutationFn: (m: { sectorEtf: string | null; thesisStatus: ThesisStatus }) =>
      updateHoldingMeta(h.id, m),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holdings'] }),
  });
  const [editing, setEditing] = useState(false);
  const ui = j.ui;
  const hh = j.holdings;
  const last = bars.at(-1)?.close ?? null;
  const u = last !== null ? unrealized(h, last) : null;
  const exits = exitSignals(h, bars);
  const kinds = new Set(exits.map((e) => e.kind));
  const stopHit = kinds.has('stop');
  const rotate = rotationOf(h, all).suggestion === 'rotate';
  const tone = !u ? 'text-muted' : u.usd >= 0 ? 'text-up' : 'text-down';
  const gain = u ? signedUsd(u.usd) : t.regime.noData;
  const held = sessionsHeld(bars, h.openedOn);
  const tsMax = h.timeStopSessions && h.timeStopSessions > 0 ? h.timeStopSessions : null;
  const tbLabel = h.trendBreak ? ui.dayLine(h.trendBreak.period, h.trendBreak.ind === 'ema') : null;
  // Design: "Thesis intact", the state in lower case inside the pill.
  const thesis = (hh.thesisStatus[h.thesisStatus] ?? h.thesisStatus).toLowerCase();
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border bg-surface px-4 py-3.5 ${
        stopHit ? 'border-down/60' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <span className="flex flex-col gap-0.5">
          <TickerLink ticker={h.ticker} className="self-start text-[1.1875rem]" />
          <span className="text-[0.8125rem] text-muted tabular-nums">
            {ui.sharesCost(h.shares, money(h.costBasis))}
          </span>
        </span>
        <span
          aria-label={ui.gainAria(h.ticker, gain)}
          className={`flex flex-col items-end tabular-nums ${tone}`}
        >
          <span className="text-[1.0625rem] font-bold">{gain}</span>
          {u && <span className="text-[0.8125rem]">{signedPct1(u.pct)}</span>}
        </span>
      </div>
      <PlanBar h={h} last={last} />
      {h.stop === null && h.targets.length === 0 && !h.trendBreak && !tsMax && (
        <span className="text-xs text-down">{hh.noRules}</span>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <span className="flex flex-col gap-0.5 rounded-[10px] bg-bg px-2.5 py-2">
          <span className="text-xs text-muted">{ui.trendBreakLabel}</span>
          <span
            className={`text-[0.8125rem] ${kinds.has('trend-break') ? 'text-down' : 'text-white'}`}
          >
            {tbLabel === null
              ? ui.notSet
              : kinds.has('trend-break')
                ? ui.trendUnder(tbLabel)
                : ui.trendAbove(tbLabel)}
          </span>
        </span>
        <span className="flex flex-col gap-1 rounded-[10px] bg-bg px-2.5 py-2">
          <span className="text-xs text-muted">
            {ui.timeStopTile(tsMax === null ? ui.notSet : ui.timeStopOf(held, tsMax))}
          </span>
          {tsMax !== null && (
            <span aria-hidden="true" className="h-[5px] rounded-[3px] bg-faint/20">
              <span
                className="block h-full rounded-[3px] bg-muted"
                style={{ width: `${toFixedHalfUp(Math.min(1, held / tsMax) * 100, 1)}%` }}
              />
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={ui.thesisAria(thesis)}
          onClick={() =>
            meta.mutate({ sectorEtf: h.sectorEtf, thesisStatus: NEXT_THESIS[h.thesisStatus] })
          }
          className="flex min-h-11 items-center gap-2 rounded-full border border-muted/35 px-3 text-[0.8125rem] text-white"
        >
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${THESIS_DOT[h.thesisStatus]}`}
          />
          {ui.thesisButton(thesis)}
        </button>
        {stopHit && (
          <span className="flex min-h-11 items-center rounded-full bg-down/18 px-3 text-[0.8125rem] font-semibold text-down">
            {ui.stopHit}
          </span>
        )}
        {!stopHit && rotate && (
          <span className="flex min-h-11 items-center rounded-full bg-warn/16 px-3 text-[0.8125rem] font-semibold text-warn">
            {j.rotation.flag(h.sectorEtf ?? 'SPY')}
          </span>
        )}
        {!stopHit && kinds.has('target') && (
          <span className="flex min-h-11 items-center rounded-full bg-up/16 px-3 text-[0.8125rem] font-semibold text-up">
            {ui.targetHit}
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ms-auto min-h-11 px-1 text-[0.8125rem] text-muted underline"
        >
          {ui.edit}
        </button>
      </div>
      {meta.isError && <ErrorText message={meta.error.message} />}
      <Sheet open={editing} onClose={() => setEditing(false)} title={ui.editTitle(h.ticker)}>
        <HoldingEdit h={h} all={all} />
      </Sheet>
    </li>
  );
}

function Holdings({ onTrade }: { onTrade: () => void }) {
  const hh = j.holdings;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: addHoldings,
    onSuccess: (_d, rows) => {
      setMsg(hh.csvAdded(rows.length));
      void qc.invalidateQueries({ queryKey: ['holdings'] });
    },
  });
  const parsed = csv.trim() ? parseHoldingsCsv(csv) : null;
  const dups = parsed ? markDuplicateHoldings(q.data?.holdings ?? [], parsed.holdings) : [];
  const fresh = parsed ? parsed.holdings.filter((_h, i) => !dups[i]) : [];
  const readFile = (f: File | undefined) => {
    if (f) void f.text().then(setCsv);
  };
  const submitCsv = (e: FormEvent) => {
    e.preventDefault();
    const r = parseHoldingsCsv(csv);
    setErrs(r.errors);
    setMsg(null);
    if (r.errors.length === 0 && fresh.length > 0) add.mutate(fresh);
  };
  return (
    // Phones: the cards sit straight under the tabs (design); from 760 px they share one titled card.
    <section
      aria-labelledby="holdings"
      className="flex flex-col gap-2.5 tablet:gap-3 tablet:rounded-xl tablet:border tablet:border-line tablet:bg-surface tablet:p-5"
    >
      <h2 id="holdings" className={`sr-only tablet:not-sr-only ${panelTitle}`}>
        {hh.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.holdings.length === 0 ? (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-muted/40 px-[18px] py-6 text-center">
            <span className="text-[1.0625rem] font-semibold">{j.ui.emptyTitle}</span>
            <span className="text-[0.9375rem] text-fg">{j.ui.emptyText}</span>
            <button
              type="button"
              onClick={onTrade}
              className="min-h-[52px] rounded-xl bg-white text-base font-bold text-raised"
            >
              {j.ui.emptyTrade}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 tablet:grid-cols-2 wide:grid-cols-3">
            {q.data.holdings.map((h) => (
              <HoldingCard key={h.id} h={h} all={q.data.bars} />
            ))}
          </ul>
        ))}
      <button
        type="button"
        aria-expanded={importing}
        aria-controls="csv-import"
        onClick={() => setImporting(!importing)}
        className="min-h-12 rounded-xl border border-muted/40 text-[0.9375rem] text-white"
      >
        {j.ui.importCsv}
      </button>
      {importing && (
        <form id="csv-import" onSubmit={submitCsv} className="flex flex-col gap-2">
          <label htmlFor="csv" className="text-sm font-medium">
            {hh.csvTitle}
          </label>
          <p className="text-xs break-all text-muted">{hh.csvHelp}</p>
          <textarea
            id="csv"
            rows={4}
            className="rounded-xl border border-dashed border-muted/50 bg-bg p-3 font-mono text-sm text-fg"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              readFile(e.dataTransfer.files[0]);
            }}
          />
          <p className="text-xs text-muted">{j.ui.csvDrop}</p>
          <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-xl border border-line px-3 text-sm text-fg">
            {j.ui.csvFile}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
          </label>
          {parsed && parsed.holdings.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[0.8125rem] font-bold text-muted">{j.ui.preview}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {parsed.holdings.map((h, i) => (
                  <li
                    key={`${h.ticker}-${i}`}
                    className={`flex flex-wrap justify-between gap-2 rounded-lg px-2 py-1.5 ${
                      dups[i] ? 'bg-bg/40 text-muted line-through' : 'bg-bg/70 text-fg'
                    }`}
                  >
                    <span className="font-semibold">{h.ticker}</span>
                    <span className="tabular-nums">
                      {h.shares} @ {money(h.costBasis)} {'\u00B7'} {h.openedOn}
                    </span>
                    {dups[i] && (
                      <span className="w-full text-xs no-underline">{j.ui.duplicate}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                {j.ui.willAdd(fresh.length, parsed.holdings.length - fresh.length)}
              </p>
            </div>
          )}
          <Button type="submit" disabled={add.isPending}>
            {hh.csvButton}
          </Button>
          {errs.map((x) => (
            <ErrorText key={x} message={x} />
          ))}
          {add.isError && <ErrorText message={add.error.message} />}
          {msg && <p className="text-sm">{msg}</p>}
        </form>
      )}
    </section>
  );
}

/** Each priced holding with its betas, as the exposure report and the KPI tiles both take them. */
function positionsOf(holdings: StoredHolding[], bars: BarsByTicker, vix: DatedValue[]) {
  const spy = bars['SPY'] ?? [];
  return holdings.flatMap((h) => {
    const b = bars[h.ticker] ?? [];
    const last = b.at(-1);
    if (!last) return [];
    const sector = h.sectorEtf ? (bars[h.sectorEtf] ?? []) : [];
    return [
      {
        ticker: h.ticker,
        shares: h.shares,
        price: last.close,
        sectorEtf: h.sectorEtf,
        beta: beta(b, spy)?.slope ?? null,
        vixSensitivity: vixSensitivity(b, vix)?.slope ?? null,
        sectorBeta: h.sectorEtf ? (beta(b, sector)?.slope ?? null) : null,
      },
    ];
  });
}

/** Sector colours in the design's order, then the remaining tokens. */
const SECTOR_FILL = ['bg-up', 'bg-ink', 'bg-muted', 'bg-faint', 'bg-warn', 'bg-raised'];

function Exposure({
  holdings,
  bars,
  vix,
}: {
  holdings: StoredHolding[];
  bars: BarsByTicker;
  vix: DatedValue[];
}) {
  const x = j.exposure;
  const box = 'flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4';
  const positions = positionsOf(holdings, bars, vix);
  if (positions.length === 0)
    return (
      <section aria-labelledby="exposure" className={box}>
        <h2 id="exposure" className="sr-only">
          {x.title}
        </h2>
        <p className="text-muted">{x.none}</p>
      </section>
    );
  const r = exposureReport(positions);
  const pairs = correlationPairs(
    [...new Set(holdings.map((h) => h.ticker))].map((t) => ({ ticker: t, bars: bars[t] ?? [] })),
  ).filter((p) => p.high);
  const b = r.portfolioBeta;
  const worst = Math.max(0, ...r.scenarios.map((sc) => Math.abs(sc.usd)));
  const notes = [...new Set(r.scenarios.flatMap((sc) => sc.assumptions))];
  const fill = (i: number) => SECTOR_FILL[i % SECTOR_FILL.length];
  return (
    <section aria-labelledby="exposure" className="flex flex-col gap-3">
      <h2 id="exposure" className="sr-only">
        {x.title}
      </h2>
      <div className={box}>
        <span className="flex items-baseline justify-between">
          <span className="font-semibold">{x.betaTitle}</span>
          <span className="text-2xl font-bold tabular-nums">{toFixedHalfUp(b, 2)}</span>
        </span>
        <span aria-hidden="true" className="relative h-2.5 rounded-[5px] bg-faint/16">
          <span
            className="absolute inset-y-0 start-0 rounded-[5px] bg-up"
            style={{ width: `${toFixedHalfUp(Math.min(1, Math.max(0, b / 2)) * 100, 1)}%` }}
          />
          <span className="absolute -inset-y-1 start-1/2 w-0.5 bg-white" />
        </span>
        <span className="text-[0.8125rem] text-muted">{x.betaLine}</span>
        {r.betaAssumed.length > 0 && (
          <span className="text-[0.8125rem] text-muted">
            {x.betaAssumed(r.betaAssumed.join(', '))}
          </span>
        )}
        <h3 className="pt-1.5 font-semibold">{x.sectorsTitle}</h3>
        <div aria-hidden="true" className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
          {r.sectors.map((sc, i) => (
            <span key={sc.sector} className={fill(i)} style={{ flex: sc.weight }} />
          ))}
        </div>
        <ul className="flex flex-col gap-2.5">
          {r.sectors.map((sc, i) => (
            <li key={sc.sector} className="flex items-center gap-2">
              <span aria-hidden="true" className={`size-3 rounded-[3px] ${fill(i)}`} />
              <span className="flex-1">{sc.sector}</span>
              <span className="font-semibold tabular-nums">{share(sc.weight)}</span>
            </li>
          ))}
        </ul>
        <h3 className="pt-1.5 font-semibold">{x.corrTitle}</h3>
        {pairs.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">{x.corrNone}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {pairs.map((p) => (
              <li key={`${p.a}-${p.b}`} className="flex justify-between">
                <span>{x.corrPair(p.a, p.b)}</span>
                <span className="font-semibold text-warn tabular-nums">
                  {toFixedHalfUp(p.correlation, 2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={`${box} gap-3!`}>
        <h3 className="font-semibold">{x.scenariosTitle}</h3>
        <ul className="flex flex-col gap-3">
          {r.scenarios.map((sc) => (
            <li key={sc.name} className="flex flex-col gap-1">
              <span className="flex justify-between gap-2.5">
                <span>{sc.name}</span>
                <span
                  className={`font-bold whitespace-nowrap tabular-nums ${
                    sc.usd < 0 ? 'text-down' : 'text-up'
                  }`}
                >
                  {signedUsd(sc.usd)}
                </span>
              </span>
              <span aria-hidden="true" className="flex h-2.5 justify-end rounded-[5px] bg-faint/12">
                <span
                  className={`rounded-[5px] ${sc.usd < 0 ? 'bg-down' : 'bg-up'}`}
                  style={{
                    width: `${worst > 0 ? toFixedHalfUp((Math.abs(sc.usd) / worst) * 100, 1) : 0}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{notes.join(' ')}</p>
      </div>
    </section>
  );
}

/** The rotation signal for one holding; the design shows it as a "Rotate to XLK?" flag on the card. */
function rotationOf(h: StoredHolding, all: BarsByTicker) {
  return rotationSignal({
    ticker: h.ticker,
    bars: all[h.ticker] ?? [],
    spy: all['SPY'] ?? [],
    sectorEtf: h.sectorEtf,
    sectorBars: h.sectorEtf ? (all[h.sectorEtf] ?? null) : null,
    thesis: h.thesisStatus,
  });
}

function Portfolio() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  if (!q.data) return null;
  return <Exposure holdings={q.data.holdings} bars={q.data.bars} vix={q.data.vix} />;
}

function LookThrough() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  return q.data ? <EtfLookThrough holdings={q.data.holdings} bars={q.data.bars} /> : null;
}

function WeeklyReview() {
  const q = useQuery({ queryKey: ['weekly-review'], queryFn: loadWeeklyReview });
  const x = j.review;
  let n = 0;
  return (
    <section
      aria-labelledby="weekly-review"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 id="weekly-review" className="flex flex-col gap-0.5">
        <span className="font-semibold text-white">{q.data ? q.data.title : x.title}</span>
        {q.data && (
          <span className="text-[13px] font-normal text-muted">
            {x.written(weekdayDayMonth(q.data.forDate))}
          </span>
        )}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data === null && <p className="text-muted">{x.none}</p>}
      {q.data?.sections.map((sec) => (
        <div key={sec.heading} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-normal text-muted">{sec.heading}</h3>
          {sec.lines.map((l) => {
            n += 1;
            return (
              <p key={l} className="flex gap-2.5 text-sm leading-[1.45]">
                <span aria-hidden="true" className="font-bold text-muted">
                  {String(n).padStart(2, '0')}
                </span>
                {l}
              </p>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/** The four numbers to read first: value, open gain, beta to SPY and what needs a look (design KPI tiles). */
function Kpis() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const wide = useWide();
  const [slide, setSlide] = useState(0);
  const ui = j.ui;
  if (q.isPending) return <SkeletonCards heights={['6rem']} />;
  if (!q.data || q.data.holdings.length === 0) return null;
  const { holdings, bars, vix } = q.data;
  const last = (tk: string) => bars[tk]?.at(-1)?.close ?? null;
  const tot = portfolioTotals(holdings, last);
  const r = exposureReport(positionsOf(holdings, bars, vix));
  const newest = holdings
    .map((h) => bars[h.ticker]?.at(-1)?.date ?? '')
    .reduce((a, b) => (b > a ? b : a), '');
  const attention = holdings.flatMap((h) => {
    const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
    if (!hasRules) return [`${h.ticker} ${ui.attentionKinds['rules'] ?? ''}`];
    return exitSignals(h, bars[h.ticker] ?? []).map(
      (e) => `${h.ticker} ${ui.attentionKinds[e.kind] ?? e.kind}`,
    );
  });
  const flagged = new Set(attention.map((a) => a.split(' ')[0])).size;
  const tiles = [
    {
      label: ui.value,
      v: `$${usd0(tot.value)}`,
      sub:
        tot.unpriced.length > 0
          ? ui.unpriced(tot.unpriced.length)
          : ui.valueSub(holdings.length, newest ? dayMonth(newest) : '', wide),
      tone: 'text-white',
      bg: 'bg-raised',
    },
    {
      label: ui.gain,
      v: signedUsd(tot.gainUsd),
      sub: tot.gainPct === null ? '' : ui.gainSub(signedPct1(tot.gainPct)),
      tone: tot.gainUsd >= 0 ? 'text-up' : 'text-down',
      bg: 'bg-surface',
    },
    {
      label: ui.beta,
      v: toFixedHalfUp(r.portfolioBeta, 2),
      sub: ui.betaSub(Math.round((r.portfolioBeta - 1) * 100)),
      tone: 'text-white',
      bg: 'bg-surface',
    },
    {
      label: ui.attention,
      v: String(flagged),
      sub: attention.length ? attention.slice(0, 3).join(' · ') : ui.noneAttention,
      tone: flagged > 0 ? 'text-down' : 'text-white',
      bg: 'bg-surface',
    },
  ];
  const tile = (k: (typeof tiles)[number]) => (
    <div
      key={k.label}
      aria-label={`${k.label} ${k.v}`}
      className={`flex min-w-0 flex-col gap-0.5 rounded-2xl border border-line px-4 py-3.5 ${k.bg} ${
        wide ? '' : 'flex-[0_0_62%] snap-start'
      }`}
    >
      <span className="text-[0.8125rem] text-muted">{k.label}</span>
      <span className={`text-[1.625rem] font-bold tabular-nums ${k.tone}`}>{k.v}</span>
      <span className="text-[0.8125rem] text-fg">{k.sub}</span>
    </div>
  );
  if (wide)
    return (
      <section aria-label={ui.kpis} className="grid grid-cols-4 gap-3">
        {tiles.map(tile)}
      </section>
    );
  return (
    <section aria-label={ui.kpis} className="flex flex-col gap-2">
      <div
        // Keyboard users scroll it too (WCAG: a scrollable region must be focusable).
        tabIndex={0}
        role="group"
        aria-label={ui.kpis}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
          const i = w ? Math.min(3, Math.round(Math.abs(el.scrollLeft) / (w + 10))) : 0;
          if (i !== slide) setSlide(i);
        }}
      >
        {tiles.map(tile)}
      </div>
      <div aria-hidden="true" className="flex justify-center gap-1.5">
        {tiles.map((k, i) => (
          <span
            key={k.label}
            className={`h-1.5 rounded-[3px] ${i === slide ? 'w-[18px] bg-white' : 'w-1.5 bg-muted/40'}`}
          />
        ))}
      </div>
    </section>
  );
}

const TABS = ['positions', 'trade', 'options', 'exposure', 'look', 'trades', 'review'] as const;
type JournalTab = (typeof TABS)[number];
const PHONE_TABS = ['positions', 'trade', 'exposure', 'look', 'more'] as const;
type PhoneTab = (typeof PHONE_TABS)[number];
const MORE = ['options', 'trades', 'review'] as const;
type MoreTab = (typeof MORE)[number];

function Section({ tab, onTrade }: { tab: JournalTab; onTrade: () => void }) {
  if (tab === 'positions') return <Holdings onTrade={onTrade} />;
  if (tab === 'trade') return <Sizer />;
  if (tab === 'options') return <OptionPositions />;
  if (tab === 'exposure') return <Portfolio />;
  if (tab === 'look') return <LookThrough />;
  if (tab === 'trades') return <Trades />;
  return <WeeklyReview />;
}

export function Journal() {
  const wide = useWide();
  const [tab, setTab] = useRemembered<JournalTab>('marsad.journal.tab', TABS, 'positions');
  const [sub, setSub] = useRemembered<MoreTab>('marsad.journal.more', MORE, 'options');
  const phoneTab: PhoneTab = (MORE as readonly string[]).includes(tab) ? 'more' : (tab as PhoneTab);
  const label = (k: string) => j.ui.tabs[k] ?? k;
  return (
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{j.title}</h1>
        <Info>{j.intro}</Info>
      </div>
      <Kpis />
      {wide ? (
        <Tabs
          label={j.ui.tabsLabel}
          idPrefix="journal"
          options={TABS.map((k) => ({ key: k, label: label(k) }))}
          value={tab}
          onChange={setTab}
        >
          <Section tab={tab} onTrade={() => setTab('trade')} />
        </Tabs>
      ) : (
        <Tabs
          pill
          label={j.ui.tabsLabel}
          idPrefix="journal"
          options={PHONE_TABS.map((k) => ({ key: k, label: label(k) }))}
          value={phoneTab}
          onChange={(k) => setTab(k === 'more' ? sub : k)}
        >
          {phoneTab === 'more' ? (
            <Tabs
              pill
              label={j.ui.moreLabel}
              idPrefix="journal-more"
              options={MORE.map((k) => ({ key: k, label: label(k) }))}
              value={sub}
              onChange={(k) => {
                setSub(k);
                setTab(k);
              }}
            >
              <Section tab={sub} onTrade={() => setTab('trade')} />
            </Tabs>
          ) : (
            <Section tab={phoneTab} onTrade={() => setTab('trade')} />
          )}
        </Tabs>
      )}
    </div>
  );
}
