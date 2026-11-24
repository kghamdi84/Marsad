import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buildEarningsHistory,
  etDate,
  summarizeFinancials,
  toFixedHalfUp,
  type DailyBar,
  type EarningsRow,
  type SplitEvent,
} from '@marsad/core';
import { loadEarningsFilings, loadFacts } from '../../lib/studyPanels';
import { t } from '../../strings';
import { Cell, PanelShell, num, td, th, thNum, usd } from './Panel';

const price = (v: number) => `$${toFixedHalfUp(v, 2)}`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${toFixedHalfUp(v, 1)}%`;

function Move({ row }: { row: EarningsRow }) {
  const e = t.study.earnings;
  if (!row.move) return <span className="text-muted">{e.gaps[row.moveGap ?? 'no-release']}</span>;
  const m = row.move;
  const up = m.pct > 0;
  const down = m.pct < 0;
  return (
    <div>
      <span className={down ? 'text-down' : up ? 'text-up' : ''}>
        <span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>
        {e.moveText(
          signed(m.pct),
          m.baseDate,
          price(m.baseClose),
          m.reactionDate,
          price(m.reactionClose),
        )}
      </span>
      {m.large && <p className="text-xs text-muted">{e.large}</p>}
    </div>
  );
}

export function Earnings({
  cik,
  bars,
  splits,
}: {
  cik: string;
  bars: readonly DailyBar[];
  splits: readonly SplitEvent[];
}) {
  const e = t.study.earnings;
  const facts = useQuery({ queryKey: ['facts', cik], queryFn: () => loadFacts(cik) });
  const releases = useQuery({
    queryKey: ['earnings-filings', cik],
    queryFn: () => loadEarningsFilings(cik),
  });
  const history = useMemo(
    () =>
      facts.data && releases.data
        ? buildEarningsHistory({
            quarters: summarizeFinancials(facts.data, etDate(new Date())).quarters,
            filings: releases.data,
            bars,
            splits,
          })
        : null,
    [facts.data, releases.data, bars, splits],
  );
  // Either source failing is shown: a table built from half the data would look complete.
  const q = {
    isPending: facts.isPending || releases.isPending,
    isError: facts.isError || releases.isError,
    error: facts.error ?? releases.error,
  };
  const rows = history ? [...history.rows].reverse() : [];
  const s = history?.summary;

  return (
    <PanelShell id="earnings" title={e.title} state={q}>
      {rows.length === 0 ? (
        <p className="text-muted">{e.none}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{e.note}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{e.colQuarter}</th>
                  <th className={th}>{e.colReleased}</th>
                  <th className={thNum}>{e.colRevenue}</th>
                  <th className={thNum}>{e.colYoY}</th>
                  <th className={thNum}>{e.colEps}</th>
                  <th className={th}>{e.colMove}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.release?.accession ?? r.quarterEnd}>
                    <td className={td}>{r.quarterEnd ?? e.pending}</td>
                    <td className={td}>
                      {r.release
                        ? `${r.release.date}, ${r.release.timing ? e.timing[r.release.timing] : e.noTiming}`
                        : ''}
                    </td>
                    <td className={`${td} ${num}`}>
                      {r.quarterEnd && <Cell m={r.revenue} text={usd(r.revenue.value)} />}
                    </td>
                    <td className={`${td} ${num}`}>
                      {r.revenueYoYPct === null ? '' : signed(r.revenueYoYPct)}
                    </td>
                    <td className={`${td} ${num}`}>
                      {r.quarterEnd && <Cell m={r.epsDiluted} text={usd(r.epsDiluted.value)} />}
                    </td>
                    <td className={td}>
                      <Move row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            {s && s.n > 0 && s.meanAbsPct !== null
              ? e.summary(s.n, `${toFixedHalfUp(s.meanAbsPct, 1)}%`, s.up, s.down)
              : e.summaryNone}
          </p>
          <h3 className="mt-2 text-sm font-medium">{e.missingTitle}</h3>
          <ul className="text-sm text-muted">
            <li>{e.missingEstimates}</li>
            <li>{e.missingImplied}</li>
          </ul>
          <p className="text-xs text-muted">Formulas: {history?.formulaVersion}</p>
        </>
      )}
    </PanelShell>
  );
}
