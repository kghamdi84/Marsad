import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  etDate,
  formatFactValue,
  peRatio,
  summarizeFinancials,
  toFixedHalfUp,
  type DailyBar,
  type Metric,
} from '@marsad/core';
import { loadFacts } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell, num, td, th, thNum } from './Panel';

const usd = (v: number | null) =>
  v === null ? '' : formatFactValue({ id: '', label: '', value: v, unit: 'usd' });
// A table column keeps one decimal everywhere (75.0%, not 75%), unlike running text which trims zeros.
const pct = (v: number | null) => (v === null ? '' : `${toFixedHalfUp(v, 1)}%`);

function Cell({ m, text }: { m: Metric; text: string }) {
  if (m.value === null) return <>{t.study.financials.notReported}</>;
  return (
    <span
      title={m.filed && m.accession ? t.study.financials.source(m.filed, m.accession) : undefined}
    >
      {text}
      {m.derived && <span className="ms-1 text-xs text-muted">{t.study.financials.derived}</span>}
    </span>
  );
}

export function Financials({ cik, bars }: { cik: string; bars: readonly DailyBar[] }) {
  const today = etDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const q = useQuery({ queryKey: ['facts', cik], queryFn: () => loadFacts(cik) });
  const s = useMemo(() => (q.data ? summarizeFinancials(q.data, asOf) : null), [q.data, asOf]);
  const price = useMemo(
    () => [...bars].reverse().find((b) => b.date <= asOf) ?? null,
    [bars, asOf],
  );
  const pe = s?.ttm && price ? peRatio(price.close, s.ttm.epsDiluted.value) : null;
  const f = t.study.financials;

  return (
    <PanelShell id="financials" title={f.title} state={q}>
      <div className="flex items-center gap-2">
        <label htmlFor="asof" className="text-sm text-muted">
          {f.asOfLabel}
        </label>
        <input
          id="asof"
          type="date"
          value={asOf}
          max={today}
          onChange={(e) => e.target.value && setAsOf(e.target.value)}
          className="min-h-11 rounded-sm border border-line bg-bg px-3 text-fg"
        />
      </div>
      {!s || !s.latest ? (
        <p className="text-muted">{f.none}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{f.note(s.latest.filed)}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{f.quarter}</th>
                  <th className={thNum}>{f.revenue}</th>
                  <th className={thNum}>{f.yoy}</th>
                  <th className={thNum}>{f.grossMargin}</th>
                  <th className={thNum}>{f.operatingMargin}</th>
                  <th className={thNum}>{f.netMargin}</th>
                  <th className={thNum}>{f.eps}</th>
                </tr>
              </thead>
              <tbody>
                {[...s.quarters].reverse().map((r) => (
                  <tr key={r.end}>
                    <td className={td}>{r.end}</td>
                    <td className={`${td} ${num}`}>
                      <Cell m={r.revenue} text={usd(r.revenue.value)} />
                    </td>
                    <td className={`${td} ${num}`}>
                      {r.revenueYoYPct === null
                        ? ''
                        : `${r.revenueYoYPct > 0 ? '+' : ''}${pct(r.revenueYoYPct)}`}
                    </td>
                    <td className={`${td} ${num}`}>{pct(r.grossMarginPct)}</td>
                    <td className={`${td} ${num}`}>{pct(r.operatingMarginPct)}</td>
                    <td className={`${td} ${num}`}>{pct(r.netMarginPct)}</td>
                    <td className={`${td} ${num}`}>
                      <Cell m={r.epsDiluted} text={usd(r.epsDiluted.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-2 text-sm font-medium">{f.ttm}</h3>
          {s.ttm ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
              {(
                [
                  [f.revenue, s.ttm.revenue],
                  [f.netIncome, s.ttm.netIncome],
                  [f.eps, s.ttm.epsDiluted],
                  [f.opCash, s.ttm.operatingCashFlow],
                ] as const
              ).map(([label, m]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-lg font-medium">
                    <Cell m={m} text={usd(m.value)} />
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-muted">{f.pe}</dt>
                <dd className="text-lg font-medium">
                  {pe === null ? f.peNone : `${pe.toFixed(1)}x`}
                </dd>
                {pe !== null && price && (
                  <dd className="text-xs text-muted">
                    {f.peNote(`$${price.close.toFixed(2)}`, price.date)}
                  </dd>
                )}
              </div>
            </dl>
          ) : (
            <p className="text-muted">{f.ttmNone}</p>
          )}
          <p className="text-xs text-muted">{f.ttmNote}</p>

          {s.balance && (
            <>
              <h3 className="mt-2 text-sm font-medium">{f.balance(s.balance.end)}</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                {(
                  [
                    [f.assets, s.balance.assets],
                    [f.liabilities, s.balance.liabilities],
                    [f.equity, s.balance.equity],
                    [f.cash, s.balance.cash],
                    [f.debt, s.balance.longTermDebt],
                  ] as const
                ).map(([label, m]) => (
                  <div key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-medium">
                      <Cell m={m} text={usd(m.value)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {s.annual.length > 0 && (
            <>
              <h3 className="mt-2 text-sm font-medium">{f.annual}</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={th}>{f.yearEnded}</th>
                      <th className={thNum}>{f.revenue}</th>
                      <th className={thNum}>{f.netIncome}</th>
                      <th className={thNum}>{f.eps}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.annual].reverse().map((a) => (
                      <tr key={a.end}>
                        <td className={td}>{a.end}</td>
                        <td className={`${td} ${num}`}>
                          <Cell m={a.revenue} text={usd(a.revenue.value)} />
                        </td>
                        <td className={`${td} ${num}`}>
                          <Cell m={a.netIncome} text={usd(a.netIncome.value)} />
                        </td>
                        <td className={`${td} ${num}`}>
                          <Cell m={a.epsDiluted} text={usd(a.epsDiluted.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-xs text-muted">{f.valuation}</p>
          <p className="text-xs text-muted">Formulas: {s.formulaVersion}</p>
        </>
      )}
    </PanelShell>
  );
}
