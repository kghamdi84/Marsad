import { useQuery } from '@tanstack/react-query';
import { etfOverlap, lookThrough, toFixedHalfUp } from '@marsad/core';
import { ErrorText } from '../ui';
import { num, td, th, thNum, panelTitle } from '../study/Panel';
import { loadEtfHoldings } from '../../lib/etf';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import { cardClass } from '../Card';
import { t } from '../../strings';

const x = t.journal.etf;
const pct = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
const money = (v: number) => toFixedHalfUp(v, 2);

/** Look-through exposure of directly held stocks through SPY, QQQ and DIA, and the overlap of those funds. */
export function EtfLookThrough({
  holdings,
  bars,
}: {
  holdings: StoredHolding[];
  bars: BarsByTicker;
}) {
  const q = useQuery({ queryKey: ['etf-holdings'], queryFn: loadEtfHoldings });
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!q.data) return null;
  const { reports, holdings: byEtf } = q.data;
  const weights = new Map<string, Map<string, number>>();
  for (const r of reports) {
    const m = new Map<string, number>();
    for (const h of byEtf[r.etf] ?? [])
      if (h.ticker) m.set(h.ticker, (m.get(h.ticker) ?? 0) + h.weight);
    weights.set(r.etf, m);
  }
  const positions = holdings.flatMap((h) => {
    const last = (bars[h.ticker] ?? []).at(-1);
    return last ? [{ ticker: h.ticker, value: h.shares * last.close }] : [];
  });
  const heldFunds = [...new Set(positions.map((p) => p.ticker).filter((tk) => weights.has(tk)))];
  const rows = lookThrough(positions, weights).filter((r) => r.viaEtfs.length > 0);
  const pairs = reports.flatMap((a, i) =>
    reports.slice(i + 1).map((b) => ({
      a: a.etf,
      b: b.etf,
      overlap: etfOverlap(byEtf[a.etf] ?? [], byEtf[b.etf] ?? []),
    })),
  );
  return (
    <section aria-labelledby="etf-look-through" className={`${cardClass} gap-3!`}>
      <h2 id="etf-look-through" className={panelTitle}>
        {x.title}
      </h2>
      <p className="text-sm text-muted">{x.intro}</p>
      {reports.length === 0 ? (
        <p className="text-muted">{x.none}</p>
      ) : (
        <>
          <ul className="text-xs text-muted">
            {reports.map((r) => (
              <li key={r.etf}>{x.report(r.etf, r.reportDate, r.holdings, r.matched)}</li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold">{x.overlapTitle}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{x.colPair}</th>
                  <th className={thNum}>{x.colOverlap}</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={`${p.a}-${p.b}`}>
                    <td className={td}>
                      {p.a} {x.and} {p.b}
                    </td>
                    <td className={`${td} ${num}`}>{pct(p.overlap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold">{x.lookTitle}</h3>
          {heldFunds.length === 0 ? (
            <p className="text-sm text-muted">{x.noFunds}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted">{x.noShared(heldFunds.join(', '))}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>{x.colTicker}</th>
                    <th className={thNum}>{x.colDirect}</th>
                    <th className={th}>{x.colVia}</th>
                    <th className={thNum}>{x.colTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker}>
                      <td className={`${td} font-medium`}>{r.ticker}</td>
                      <td className={`${td} ${num}`}>{money(r.direct)}</td>
                      <td className={td}>
                        {r.viaEtfs.map((v) => `${v.etf} ${money(v.usd)}`).join(', ')}
                      </td>
                      <td className={`${td} ${num}`}>{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-muted">{x.footnote}</p>
    </section>
  );
}
