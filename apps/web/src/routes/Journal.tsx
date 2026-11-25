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
import { num, td, th, thNum } from '../components/study/Panel';
import {
  addHoldings,
  closeHolding,
  loadHoldings,
  loadWeeklyReview,
  updateHoldingMeta,
  type BarsByTicker,
  type StoredHolding,
} from '../lib/journal';
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
  const meta = useMutation({
    mutationFn: (m: { sectorEtf: string | null; thesisStatus: ThesisStatus }) =>
      updateHoldingMeta(h.id, m),
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
          <label className="flex flex-col text-xs text-muted">
            {hh.thesis}
            <select
              className={select}
              value={h.thesisStatus}
              onChange={(e) =>
                meta.mutate({
                  sectorEtf: h.sectorEtf,
                  thesisStatus: e.target.value as ThesisStatus,
                })
              }
            >
              {(['intact', 'weakening', 'broken'] as const).map((k) => (
                <option key={k} value={k}>
                  {hh.thesisStatus[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {meta.isError && <ErrorText message={meta.error.message} />}
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
  const spy = bars['SPY'] ?? [];
  const positions = holdings.flatMap((h) => {
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
  const r = exposureReport(positions);
  const pairs = correlationPairs(
    [...new Set(holdings.map((h) => h.ticker))].map((t) => ({ ticker: t, bars: bars[t] ?? [] })),
  ).filter((p) => p.high);
  return (
    <section aria-labelledby="exposure" className="flex flex-col gap-3">
      <h2 id="exposure" className="font-semibold">
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
    <section aria-labelledby="rotation" className="flex flex-col gap-3">
      <h2 id="rotation" className="font-semibold">
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
    <section aria-labelledby="weekly-review" className="flex flex-col gap-2">
      <h2 id="weekly-review" className="font-semibold">
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

export function Journal() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{j.title}</h1>
        <p className="text-sm text-muted">{j.intro}</p>
      </div>
      <Sizer />
      <Holdings />
      <OptionPositions />
      <Portfolio />
      <Trades />
      <WeeklyReview />
    </section>
  );
}
