import { useState, type FormEvent } from 'react';
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
import { Button, ErrorText, Field } from '../components/ui';
import { EtfLookThrough } from '../components/journal/EtfLookThrough';
import { OptionPositions } from '../components/journal/OptionPositions';
import { Trades } from '../components/journal/Trades';
import { num, td, th, thNum, panelTitle } from '../components/study/Panel';
import {
  addHoldings,
  closeHolding,
  loadHoldings,
  loadWeeklyReview,
  updateHoldingMeta,
  type BarsByTicker,
  type StoredHolding,
} from '../lib/journal';
import { SkeletonCards, Tabs, cardClass, useRemembered, useWide } from '../components/Card';
import { t } from '../strings';

const j = t.journal;
const money = (v: number) => toFixedHalfUp(v, 2);
const pct = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v * 100, 1)}%`;
const share = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
const select = 'min-h-11 rounded-sm border border-line bg-bg px-2 text-fg';

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
    <section aria-labelledby="sizer" className={`${cardClass} gap-3!`}>
      <h2 id="sizer" className={panelTitle}>
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
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 -mx-1 rounded-xl bg-surface/95 p-1 backdrop-blur tablet:static tablet:m-0 tablet:bg-transparent tablet:p-0 tablet:backdrop-blur-none">
            <Button
              type="button"
              disabled={!complete}
              className="w-full min-h-12! rounded-xl! border-0! bg-white! font-bold text-raised! disabled:bg-muted/40!"
              onClick={() => {
                void navigator.clipboard?.writeText(ticket).then(() => setCopied(true));
              }}
            >
              {s.copy} {s.checksDone(Object.values(ticked).filter(Boolean).length)}
            </Button>
          </div>
          {!complete && <p className="text-sm text-muted">{s.incomplete}</p>}
          {copied && <p className="text-sm">{s.copied}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * The stop, now and target bar: where the last close sits between the stop and the targets, with the cost as a
 * tick. Positions on the bar are only for the eye; the numbers beside it are the record.
 */
function PlanBar({ h, last, hit }: { h: StoredHolding; last: number | null; hit: boolean }) {
  const pts = [h.stop, h.costBasis, last, ...h.targets].filter((v): v is number => v !== null);
  if (last === null || h.stop === null || pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.06 || 1;
  const at = (v: number) => `${toFixedHalfUp(((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100, 1)}%`;
  const ui = j.ui;
  return (
    <div className="mb-2 flex min-w-48 flex-col gap-1">
      <div
        role="img"
        aria-label={ui.barAria(
          money(h.stop),
          money(last),
          h.targets.map(money).join(', ') || j.holdings.none2,
        )}
        className={`relative h-2 rounded-full bg-gradient-to-r from-down/65 via-muted/25 to-up/60 ${hit ? 'ring-2 ring-down' : ''}`}
      >
        <span
          className="absolute -top-1 h-4 w-0.5 bg-fg/70"
          style={{ insetInlineStart: at(h.costBasis) }}
        />
        {h.targets.map((tg) => (
          <span
            key={tg}
            className="absolute -top-1 h-4 w-0.5 bg-up"
            style={{ insetInlineStart: at(tg) }}
          />
        ))}
        <span
          className="absolute -top-1.5 -ms-2.5 size-5 rounded-full border-[3px] border-surface bg-white"
          style={{ insetInlineStart: at(last) }}
        />
      </div>
      <span className="flex justify-between text-[0.6875rem] text-muted tabular-nums">
        <span>
          {ui.barStop} {money(h.stop)}
        </span>
        <span>
          {ui.barTarget} {h.targets.length ? h.targets.map(money).join(', ') : j.holdings.none2}
        </span>
      </span>
    </div>
  );
}

type HoldingBars = Parameters<typeof exitSignals>[1];

const NEXT_THESIS: Record<ThesisStatus, ThesisStatus> = {
  intact: 'weakening',
  weakening: 'broken',
  broken: 'intact',
};
const THESIS_TONE: Record<ThesisStatus, string> = {
  intact: 'bg-up/15 text-up',
  weakening: 'bg-warn/15 text-warn',
  broken: 'border border-down/70 text-down',
};

/** How much of the time stop is used: sessions held against the limit, in words and as a bar. */
function TimeStop({ held, max }: { held: number; max: number }) {
  const used = Math.min(1, held / max);
  return (
    <div className="mb-2 flex flex-col gap-1">
      <span className="text-[0.6875rem] text-muted">{j.ui.timeStop(held, max)}</span>
      <span aria-hidden="true" className="h-1.5 rounded-full bg-faint/20">
        <span
          className={`block h-full rounded-full ${used >= 1 ? 'bg-down' : used >= 0.8 ? 'bg-warn' : 'bg-up'}`}
          style={{ width: `${toFixedHalfUp(used * 100, 1)}%` }}
        />
      </span>
    </div>
  );
}

/** A holding's plan bar, exit rules, triggered exits and its sector, thesis and close controls. */
function HoldingControls({ h, bars }: { h: StoredHolding; bars: HoldingBars }) {
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
  const last = bars.at(-1);
  const exits = exitSignals(h, bars);
  const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
  return (
    <>
      <PlanBar h={h} last={last?.close ?? null} hit={exits.length > 0} />
      {h.timeStopSessions !== null && h.timeStopSessions > 0 && (
        <TimeStop held={sessionsHeld(bars, h.openedOn)} max={h.timeStopSessions} />
      )}
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
      <div className="mt-1 flex flex-wrap gap-2">
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
        <div className="flex flex-col text-xs text-muted">
          {hh.thesis}
          <button
            type="button"
            title={j.ui.thesisHint}
            onClick={() =>
              meta.mutate({
                sectorEtf: h.sectorEtf,
                thesisStatus: NEXT_THESIS[h.thesisStatus],
              })
            }
            className={`mt-0.5 min-h-11 rounded-full px-3 text-sm font-semibold ${THESIS_TONE[h.thesisStatus]}`}
          >
            {j.ui.thesisPill(hh.thesisStatus[h.thesisStatus] ?? h.thesisStatus)}
          </button>
        </div>
      </div>
      {meta.isError && <ErrorText message={meta.error.message} />}
      <button
        type="button"
        className="mt-1 min-h-11 text-sm text-muted underline"
        onClick={() => close.mutate()}
      >
        {hh.close}
      </button>
    </>
  );
}

function HoldingRow({ h, bars }: { h: StoredHolding; bars: HoldingBars }) {
  const last = bars.at(-1);
  const u = last ? unrealized(h, last.close) : null;
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
        <HoldingControls h={h} bars={bars} />
      </td>
    </tr>
  );
}

/** Phones: one card per holding, the numbers first and the controls below. */
function HoldingCard({ h, bars }: { h: StoredHolding; bars: HoldingBars }) {
  const hh = j.holdings;
  const last = bars.at(-1);
  const u = last ? unrealized(h, last.close) : null;
  const tone = !u ? 'text-fg' : u.usd > 0 ? 'text-up' : u.usd < 0 ? 'text-down' : 'text-fg';
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-bg/45 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-base font-bold text-white">{h.ticker}</span>
          <span className="text-xs text-muted">
            {hh.colShares} {h.shares} {'\u00B7'} {hh.colCost} {money(h.costBasis)}
          </span>
        </span>
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-white">{last ? money(last.close) : t.regime.noData}</span>
          {u && (
            <span className={`text-[0.8125rem] font-semibold ${tone}`}>
              {pct(u.pct)} (USD {money(u.usd)})
            </span>
          )}
        </span>
      </div>
      <HoldingControls h={h} bars={bars} />
    </li>
  );
}

function Holdings() {
  const hh = j.holdings;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const wide = useWide();
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
    <section aria-labelledby="holdings" className={`${cardClass} gap-3!`}>
      <h2 id="holdings" className={panelTitle}>
        {hh.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.holdings.length === 0 ? (
          <p className="text-muted">{hh.none}</p>
        ) : !wide ? (
          <ul className="flex flex-col gap-2">
            {q.data.holdings.map((h) => (
              <HoldingCard key={h.id} h={h} bars={q.data.bars[h.ticker] ?? []} />
            ))}
          </ul>
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
                  {dups[i] && <span className="w-full text-xs no-underline">{j.ui.duplicate}</span>}
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
  const positions = positionsOf(holdings, bars, vix);
  const r = exposureReport(positions);
  const pairs = correlationPairs(
    [...new Set(holdings.map((h) => h.ticker))].map((t) => ({ ticker: t, bars: bars[t] ?? [] })),
  ).filter((p) => p.high);
  return (
    <section aria-labelledby="exposure" className={`${cardClass} gap-3!`}>
      <h2 id="exposure" className={panelTitle}>
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      {positions.length === 0 ? (
        <p className="text-muted">{x.none}</p>
      ) : (
        <>
          <div className="text-sm">
            <p>{x.total(money(r.totalValue))}</p>
            <p>{x.beta(toFixedHalfUp(r.portfolioBeta, 2), money(r.betaDollars))}</p>
            {r.betaAssumed.length > 0 && (
              <p className="text-muted">{x.betaAssumed(r.betaAssumed.join(', '))}</p>
            )}
            {r.concentration.largest && (
              <p>
                {x.concentration(
                  r.concentration.largest.ticker,
                  share(r.concentration.largest.weight),
                  share(r.concentration.top3Weight),
                  toFixedHalfUp(r.concentration.effectivePositions, 1),
                )}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{x.colTicker}</th>
                  <th className={thNum}>{x.colWeight}</th>
                  <th className={thNum}>{x.colBeta}</th>
                  <th className={th}>{x.colSector}</th>
                </tr>
              </thead>
              <tbody>
                {r.positions.map((p) => (
                  <tr key={p.ticker}>
                    <td className={`${td} font-medium`}>{p.ticker}</td>
                    <td className={`${td} ${num}`}>{share(p.weight)}</td>
                    <td className={`${td} ${num}`}>
                      {p.beta === null ? t.regime.noData : toFixedHalfUp(p.beta, 2)}
                    </td>
                    <td className={td}>{p.sectorEtf ?? j.holdings.sectorNone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold">{x.sectorsTitle}</h3>
          <ul className="text-sm">
            {r.sectors.map((s) => (
              <li key={s.sector}>
                {s.sector}: {share(s.weight)} (USD {money(s.value)})
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold">{x.scenariosTitle}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{x.colScenario}</th>
                  <th className={thNum}>{x.colImpact}</th>
                </tr>
              </thead>
              <tbody>
                {r.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td className={td}>
                      {s.name}
                      {s.assumptions.map((a) => (
                        <span key={a} className="block text-xs text-muted">
                          {a}
                        </span>
                      ))}
                    </td>
                    <td className={`${td} ${num}`}>
                      {s.usd < 0 ? '\u2193 ' : s.usd > 0 ? '\u2191 ' : ''}
                      USD {money(s.usd)} ({pct(s.pct)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold">{x.corrTitle}</h3>
          {pairs.length === 0 ? (
            <p className="text-sm text-muted">{x.corrNone}</p>
          ) : (
            <ul className="text-sm">
              {pairs.map((p) => (
                <li key={`${p.a}-${p.b}`}>
                  {p.a} and {p.b}: {toFixedHalfUp(p.correlation, 2)} (n={p.n})
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Rotation({ holdings, bars }: { holdings: StoredHolding[]; bars: BarsByTicker }) {
  const x = j.rotation;
  const rs = (v: number | null) => (v === null ? '\u2013' : pct(v));
  const rows = holdings.map((h) =>
    rotationSignal({
      ticker: h.ticker,
      bars: bars[h.ticker] ?? [],
      spy: bars['SPY'] ?? [],
      sectorEtf: h.sectorEtf,
      sectorBars: h.sectorEtf ? (bars[h.sectorEtf] ?? null) : null,
      thesis: h.thesisStatus,
    }),
  );
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="rotation" className={`${cardClass} gap-3!`}>
      <h2 id="rotation" className={panelTitle}>
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>{x.colTicker}</th>
              <th className={thNum}>{x.colVsSector}</th>
              <th className={thNum}>{x.colVsSpy}</th>
              <th className={th}>{x.colTrend}</th>
              <th className={th}>{x.colSignal}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker}>
                <td className={`${td} font-medium`}>{r.ticker}</td>
                <td className={`${td} ${num}`}>
                  {r.vsSector
                    ? `${rs(r.vsSector.m3)}, ${rs(r.vsSector.m6)}, ${rs(r.vsSector.m12)}`
                    : x.noSector}
                </td>
                <td className={`${td} ${num}`}>
                  {`${rs(r.vsSpy.m3)}, ${rs(r.vsSpy.m6)}, ${rs(r.vsSpy.m12)}`}
                </td>
                <td className={td}>{r.trend ? x.trend[r.trend] : t.regime.noData}</td>
                <td className={td}>
                  <span className="font-medium">{x.suggestion[r.suggestion]}</span>
                  <span className="block text-xs text-muted">{r.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Portfolio() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  if (!q.data) return null;
  return (
    <>
      <Exposure holdings={q.data.holdings} bars={q.data.bars} vix={q.data.vix} />
      <Rotation holdings={q.data.holdings} bars={q.data.bars} />
      <EtfLookThrough holdings={q.data.holdings} bars={q.data.bars} />
    </>
  );
}

function WeeklyReview() {
  const q = useQuery({ queryKey: ['weekly-review'], queryFn: loadWeeklyReview });
  const x = j.review;
  return (
    <section aria-labelledby="weekly-review" className={`${cardClass} gap-3!`}>
      <h2 id="weekly-review" className={panelTitle}>
        {q.data ? q.data.title : x.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data === null && <p className="text-muted">{x.none}</p>}
      {q.data?.sections.map((s) => (
        <div key={s.heading}>
          <h3 className="text-sm font-medium text-muted">{s.heading}</h3>
          {s.lines.map((l) => (
            <p key={l} className="text-sm">
              {l}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}

/** The four numbers to read first: value, open gain, beta to SPY and how many positions need a look. */
function Kpis() {
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const ui = j.ui;
  if (q.isPending) return <SkeletonCards heights={['6rem']} />;
  if (!q.data || q.data.holdings.length === 0) return null;
  const { holdings, bars, vix } = q.data;
  const last = (tk: string) => bars[tk]?.at(-1)?.close ?? null;
  const tot = portfolioTotals(holdings, last);
  const r = exposureReport(positionsOf(holdings, bars, vix));
  const attention = holdings.filter((h) => {
    const hasRules = h.stop !== null || h.targets.length > 0 || h.trendBreak || h.timeStopSessions;
    return !hasRules || exitSignals(h, bars[h.ticker] ?? []).length > 0;
  }).length;
  const tile =
    'flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-3 tablet:p-4';
  const gainTone = tot.gainUsd > 0 ? 'text-up' : tot.gainUsd < 0 ? 'text-down' : 'text-white';
  return (
    <section
      aria-label={ui.kpis}
      className="grid grid-cols-2 gap-2 tablet:grid-cols-4 tablet:gap-3"
    >
      <div className={tile}>
        <span className="text-xs text-muted">{ui.value}</span>
        <span className="text-xl font-bold text-white tabular-nums">USD {money(tot.value)}</span>
        {tot.unpriced.length > 0 && (
          <span className="text-[0.6875rem] text-warn">{ui.unpriced(tot.unpriced.length)}</span>
        )}
      </div>
      <div className={tile}>
        <span className="text-xs text-muted">{ui.gain}</span>
        <span className={`text-xl font-bold tabular-nums ${gainTone}`}>
          {tot.gainUsd > 0 ? '+' : ''}
          {money(tot.gainUsd)}
        </span>
        {tot.gainPct !== null && (
          <span className="text-[0.8125rem] text-muted">{ui.gainSub(pct(tot.gainPct))}</span>
        )}
      </div>
      <div className={tile}>
        <span className="text-xs text-muted">{ui.beta}</span>
        <span className="text-xl font-bold text-white tabular-nums">
          {toFixedHalfUp(r.portfolioBeta, 2)}
        </span>
        <span className="relative h-1.5 rounded-full bg-faint/20" aria-hidden="true">
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-up"
            style={{
              width: `${toFixedHalfUp(Math.min(Math.max(r.portfolioBeta, 0) / 2, 1) * 100, 1)}%`,
            }}
          />
          <span className="absolute -top-1 start-1/2 h-3.5 w-0.5 bg-white" />
        </span>
      </div>
      <div className={tile}>
        <span className="text-xs text-muted">{ui.attention}</span>
        <span
          className={`text-xl font-bold tabular-nums ${attention > 0 ? 'text-down' : 'text-white'}`}
        >
          {attention}
        </span>
        <span className="text-[0.6875rem] text-muted">{ui.attentionSub}</span>
      </div>
    </section>
  );
}

const TABS = ['positions', 'trade', 'options', 'exposure', 'trades', 'review'] as const;
type JournalTab = (typeof TABS)[number];

export function Journal() {
  const [tab, setTab] = useRemembered<JournalTab>('marsad.journal.tab', TABS, 'positions');
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{j.title}</h1>
        <p className="text-sm text-muted">{j.intro}</p>
      </div>
      <Kpis />
      <Tabs
        label={j.ui.tabsLabel}
        idPrefix="journal"
        options={TABS.map((k) => ({ key: k, label: j.ui.tabs[k] ?? k }))}
        value={tab}
        onChange={setTab}
      >
        {tab === 'positions' && <Holdings />}
        {tab === 'trade' && <Sizer />}
        {tab === 'options' && <OptionPositions />}
        {tab === 'exposure' && <Portfolio />}
        {tab === 'trades' && <Trades />}
        {tab === 'review' && <WeeklyReview />}
      </Tabs>
    </div>
  );
}
