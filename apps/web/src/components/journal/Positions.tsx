import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SECTOR_ETFS,
  ema,
  etDate,
  exitSignals,
  markDuplicateHoldings,
  parseHoldingsCsv,
  sessionsHeld,
  sma,
  unrealized,
  type ThesisStatus,
} from '@marsad/core';
import { Button, ErrorText } from '../ui';
import { Pill, StopBar } from '../ui/kit';
import {
  setHoldingHorizon,
  type Horizon,
  addHoldings,
  closeHolding,
  loadHoldings,
  updateHoldingMeta,
  type BarsByTicker,
  type StoredHolding,
} from '../../lib/journal';
import { Sheet } from '../Sheet';
import { TickerLink } from '../QuickLook';
import { useLookThrough } from './EtfLookThrough';
import { level, money, rotationOf, share, signedPct1, signedUsd } from './shared';
import { t } from '../../strings';

const j = t.journal;
const select = 'min-h-11 rounded-lg border border-line-strong bg-canvas px-2 text-ink';

const NEXT_THESIS: Record<ThesisStatus, ThesisStatus> = {
  intact: 'weakening',
  weakening: 'broken',
  broken: 'intact',
};
const THESIS_TONE: Record<ThesisStatus, string> = {
  intact: 'bg-up-soft text-up',
  weakening: 'bg-warn-soft text-warn',
  broken: 'bg-down-soft text-down',
};

const hasRules = (h: StoredHolding) =>
  h.stop !== null || h.targets.length > 0 || h.trendBreak !== null || !!h.timeStopSessions;

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
  const horizon = useMutation({
    mutationFn: (x: Horizon | null) => setHoldingHorizon(h.id, x),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['holdings'] }),
  });
  const hh = j.holdings;
  const exits = exitSignals(h, bars);
  return (
    <div className="flex flex-col gap-3">
      {exits.map((e) => (
        <p key={e.kind} className="text-sm font-medium">
          {hh.triggered}: {e.detail}
        </p>
      ))}
      <p className="text-sm">
        <span className="font-medium">{j.rotation.suggestion[rot.suggestion]}</span>
        <span className="block text-xs text-ink3">{rot.text}</span>
      </p>
      {hasRules(h) ? (
        <p className="text-xs text-ink3">
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
      <label className="flex flex-col gap-1 text-xs text-ink3">
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
      <label className="flex flex-col gap-1 text-xs text-ink3">
        {hh.horizon}
        <select
          className={select}
          value={h.horizon ?? ''}
          onChange={(e) =>
            horizon.mutate(e.target.value === '' ? null : (e.target.value as Horizon))
          }
        >
          <option value="">{hh.horizonNone}</option>
          <option value="long">{hh.horizonLong}</option>
          <option value="swing">{hh.horizonSwing}</option>
        </select>
      </label>
      {meta.isError && <ErrorText message={meta.error.message} />}
      {horizon.isError && <ErrorText message={horizon.error.message} />}
      <button
        type="button"
        className="min-h-11 self-start text-sm text-ink3 underline"
        onClick={() => close.mutate()}
      >
        {hh.close}
      </button>
    </div>
  );
}

/**
 * The rules line under the stop bar (design): the trend break with its average and whether the close holds above
 * it, the time stop as sessions used, and what the ETF look-through adds. Code computes each part.
 */
function rulesLine(h: StoredHolding, bars: BarsByTicker[string], lookAdds: string | null) {
  const ui = j.ui;
  const parts: { text: string; broken: boolean }[] = [];
  if (h.trendBreak) {
    const closes = (bars ?? []).map((b) => b.close);
    const avg =
      (h.trendBreak.ind === 'sma' ? sma : ema)(closes, h.trendBreak.period).at(-1) ?? null;
    const line = ui.dayLine(h.trendBreak.period, h.trendBreak.ind === 'ema');
    const last = closes.at(-1);
    if (avg === null || last === undefined)
      parts.push({ text: ui.trendShort(line), broken: false });
    else if (last < avg) parts.push({ text: ui.trendBroken(line, money(avg)), broken: true });
    else parts.push({ text: ui.trendIntact(line, money(avg)), broken: false });
  } else parts.push({ text: ui.trendNone, broken: false });
  const max = h.timeStopSessions && h.timeStopSessions > 0 ? h.timeStopSessions : null;
  const held = sessionsHeld(bars ?? [], h.openedOn);
  parts.push({
    text: max === null ? ui.timeStopNone : ui.timeStopLine(held, max),
    broken: max !== null && held >= max,
  });
  if (lookAdds) parts.push({ text: lookAdds, broken: false });
  return parts;
}

/** One holding as the design draws it: thesis pill, result, stop bar, rules line and flag chips. */
function HoldingCard({
  h,
  all,
  lookAdds,
}: {
  h: StoredHolding;
  all: BarsByTicker;
  lookAdds: string | null;
}) {
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
  const kinds = new Set(exitSignals(h, bars).map((e) => e.kind));
  const stopHit = kinds.has('stop');
  const rotate = rotationOf(h, all).suggestion === 'rotate';
  const gain = u ? signedUsd(u.usd) : t.regime.noData;
  const thesis = (hh.thesisStatus[h.thesisStatus] ?? h.thesisStatus).toLowerCase();
  const targets = h.targets.length ? h.targets.map(level).join(', ') : hh.none2;
  const top = h.targets.length ? Math.max(...h.targets) : null;
  // No exit rules is itself the warning (holding is never the default); the look-through still applies.
  const rules = hasRules(h)
    ? rulesLine(h, bars, lookAdds)
    : [
        { text: hh.noRules, broken: true },
        ...(lookAdds ? [{ text: lookAdds, broken: false }] : []),
      ];
  return (
    <li
      className={`flex min-w-0 flex-col gap-2.5 rounded-xl border bg-surface p-4 ${
        stopHit ? 'border-down' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <TickerLink ticker={h.ticker} className="self-start text-base font-semibold" />
            {h.horizon && (
              <Pill tone="neutral">{h.horizon === 'long' ? hh.horizonLong : hh.horizonSwing}</Pill>
            )}
          </span>
          <span className="text-xs text-ink3 tabular-nums">
            {ui.sharesCost(h.shares, money(h.costBasis))}
          </span>
        </span>
        <button
          type="button"
          aria-label={ui.thesisAria(thesis)}
          onClick={() =>
            meta.mutate({ sectorEtf: h.sectorEtf, thesisStatus: NEXT_THESIS[h.thesisStatus] })
          }
          className={`min-h-11 flex-none rounded-full px-3 text-xs font-semibold whitespace-nowrap ${THESIS_TONE[h.thesisStatus]}`}
        >
          {ui.thesisPill(thesis)}
        </button>
      </div>
      <span
        aria-label={ui.gainAria(h.ticker, gain)}
        className={`text-sm font-semibold tabular-nums ${!u ? 'text-ink3' : u.usd >= 0 ? 'text-up' : 'text-down'}`}
      >
        {u && last !== null ? ui.pnlLine(gain, signedPct1(u.pct), money(last)) : ui.noPrice}
      </span>
      {last !== null && h.stop !== null && (
        <div role="img" aria-label={ui.barAria(money(h.stop), money(last), targets)}>
          <StopBar
            stop={h.stop}
            now={last}
            target={top ?? Math.max(last, h.costBasis, h.stop)}
            labels={{
              stop: (
                <span className="text-down">
                  {ui.barStop} {money(h.stop)}
                </span>
              ),
              now: `${ui.barNow} ${money(last)}`,
              target: (
                <span className="text-up">
                  {ui.barTarget} {targets}
                </span>
              ),
            }}
          />
        </div>
      )}
      <p className="rounded-[10px] border border-line bg-elev p-2.5 text-xs leading-normal text-ink2">
        {rules.map((p, i) => (
          <span key={p.text} className={p.broken ? 'text-down' : ''}>
            {i > 0 && ' · '}
            {p.text}
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {stopHit && <Pill tone="down">{ui.stopHit}</Pill>}
        {!stopHit && rotate && <Pill tone="warn">{j.rotation.flag(h.sectorEtf ?? 'SPY')}</Pill>}
        {!stopHit && kinds.has('target') && <Pill tone="up">{ui.targetHit}</Pill>}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ms-auto min-h-11 px-1 text-xs text-ink3 underline"
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

/** The holding cards in an auto-fit grid (min 330 px), the CSV import behind a button. */
export function Positions({ onTrade }: { onTrade: () => void }) {
  const hh = j.holdings;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const look = useLookThrough(q.data?.holdings ?? [], q.data?.bars ?? {}).data;
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
  /** "ETF look-through adds 4.6% via QQQ and XLK", from the N-PORT look-through; null when it adds nothing. */
  const adds = (ticker: string) => {
    const row = look?.rows.find((r) => r.ticker === ticker);
    if (!look || !row || look.portfolio <= 0) return null;
    const via = row.viaEtfs.filter((v) => v.usd > 0);
    const usd = via.reduce((a, v) => a + v.usd, 0);
    if (usd <= 0) return null;
    return j.ui.lookAdds(share(usd / look.portfolio), j.etf.join(via.map((v) => v.etf)));
  };
  return (
    <section aria-labelledby="holdings" className="flex flex-col gap-4">
      <h2 id="holdings" className="sr-only">
        {hh.title}
      </h2>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data &&
        (q.data.holdings.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-[18px] py-6 text-center">
            <span className="text-base font-semibold text-ink">{j.ui.emptyTitle}</span>
            <span className="text-sm text-ink2">{j.ui.emptyText}</span>
            <button
              type="button"
              onClick={onTrade}
              className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
            >
              {j.ui.emptyTrade}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,330px),1fr))] gap-4">
            {q.data.holdings.map((h) => (
              <HoldingCard key={h.id} h={h} all={q.data.bars} lookAdds={adds(h.ticker)} />
            ))}
          </ul>
        ))}
      <button
        type="button"
        aria-expanded={importing}
        aria-controls="csv-import"
        onClick={() => setImporting(!importing)}
        className="min-h-11 self-start rounded-lg border border-line-strong px-4 text-[13px] font-semibold text-ink"
      >
        {j.ui.importCsv}
      </button>
      {importing && (
        <form
          id="csv-import"
          onSubmit={submitCsv}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
        >
          <label htmlFor="csv" className="text-sm font-semibold text-ink">
            {hh.csvTitle}
          </label>
          <p className="text-xs break-all text-ink3">{hh.csvHelp}</p>
          <textarea
            id="csv"
            rows={4}
            className="rounded-lg border border-dashed border-line-strong bg-canvas p-3 font-mono text-sm text-ink"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              readFile(e.dataTransfer.files[0]);
            }}
          />
          <p className="text-xs text-ink3">{j.ui.csvDrop}</p>
          <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-line-strong px-3 text-sm text-ink">
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
              <h3 className="text-[13px] font-semibold text-ink3">{j.ui.preview}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {parsed.holdings.map((h, i) => (
                  <li
                    key={`${h.ticker}-${i}`}
                    className={`flex flex-wrap justify-between gap-2 rounded-lg px-2 py-1.5 ${
                      dups[i] ? 'bg-sub text-ink3 line-through' : 'bg-elev text-ink'
                    }`}
                  >
                    <span className="font-semibold">{h.ticker}</span>
                    <span className="tabular-nums">
                      {h.shares} @ {money(h.costBasis)} {'·'} {h.openedOn}
                    </span>
                    {dups[i] && (
                      <span className="w-full text-xs no-underline">{j.ui.duplicate}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink3">
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
