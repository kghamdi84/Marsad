import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { disclosureLag, explainTransactionCode, formatFactValue } from '@marsad/core';
import { loadInsiders, type InsiderRow } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell, num, td, th, thNum } from './Panel';

const usd = (v: number) => formatFactValue({ id: '', label: '', value: v, unit: 'usd' });
const shares = (v: number) => formatFactValue({ id: '', label: '', value: v, unit: 'shares' });

function role(r: InsiderRow): string {
  const parts: string[] = [];
  if (r.isOfficer)
    parts.push(
      r.officerTitle ? `${t.study.insiders.officer}, ${r.officerTitle}` : t.study.insiders.officer,
    );
  if (r.isDirector) parts.push(t.study.insiders.director);
  if (r.isTenPercentOwner) parts.push(t.study.insiders.tenPercent);
  return parts.join('; ');
}

function plan(r: InsiderRow): string {
  const i = t.study.insiders;
  return r.plan10b5 === true ? i.planYes : r.plan10b5 === false ? i.planNo : i.planUnknown;
}

export function Insiders({ cik }: { cik: string }) {
  const q = useQuery({ queryKey: ['insiders', cik], queryFn: () => loadInsiders(cik) });
  const i = t.study.insiders;
  // Fixed when the panel opens, so rendering stays pure and the 90-day window does not move while it is open.
  const [cutoff] = useState(() =>
    new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
  );
  const summary = useMemo(() => {
    if (!q.data) return null;
    let sold = 0;
    let soldN = 0;
    let bought = 0;
    let boughtN = 0;
    for (const r of q.data.rows) {
      if (r.table !== 'non-derivative' || r.date < cutoff || r.shares === null) continue;
      if (r.code === 'S') {
        soldN += r.shares;
        sold += r.valueUsd ?? 0;
      } else if (r.code === 'P') {
        boughtN += r.shares;
        bought += r.valueUsd ?? 0;
      }
    }
    return { sold, soldN, bought, boughtN };
  }, [q.data, cutoff]);

  return (
    <PanelShell id="insiders" title={i.title} state={q}>
      <p className="text-sm text-muted">{i.note}</p>
      <p className="text-sm text-muted">{disclosureLag('4')?.label}.</p>
      {q.data && q.data.unreadable > 0 && (
        <p role="status" className="text-sm text-down">
          {i.unreadable(q.data.unreadable)}
        </p>
      )}
      {q.data && q.data.rows.length === 0 ? (
        <p className="text-muted">{i.none}</p>
      ) : (
        q.data &&
        summary && (
          <>
            <p className="text-sm">
              {i.summary(
                usd(summary.sold),
                shares(summary.soldN),
                usd(summary.bought),
                shares(summary.boughtN),
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>{i.colDate}</th>
                    <th className={th}>{i.colWho}</th>
                    <th className={th}>{i.colCode}</th>
                    <th className={thNum}>{i.colShares}</th>
                    <th className={thNum}>{i.colPrice}</th>
                    <th className={thNum}>{i.colValue}</th>
                    <th className={thNum}>{i.colAfter}</th>
                    <th className={th}>{i.colPlan}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.slice(0, 40).map((r, idx) => {
                    const c = explainTransactionCode(r.code);
                    return (
                      <tr key={`${r.accession}-${idx}`}>
                        <td className={td}>{r.date}</td>
                        <td className={td}>
                          {r.ownerName}
                          <span className="block text-xs text-muted">{role(r)}</span>
                        </td>
                        <td className={td} title={c.meaning}>
                          <span className="font-medium">{c.code}</span>{' '}
                          {r.acquiredDisposed
                            ? `${r.acquiredDisposed === 'A' ? i.acquired : i.disposed}. `
                            : ''}
                          {c.meaning}
                          {r.table === 'derivative' ? ` (${i.derivative})` : ''}
                        </td>
                        <td className={`${td} ${num}`}>
                          {r.shares === null ? '' : shares(r.shares)}
                        </td>
                        <td className={`${td} ${num}`}>
                          {r.pricePerShare === null
                            ? ''
                            : r.pricePerShare === 0
                              ? i.zeroPrice
                              : `$${r.pricePerShare.toFixed(2)}`}
                        </td>
                        <td className={`${td} ${num}`}>
                          {r.valueUsd === null ? '' : usd(r.valueUsd)}
                        </td>
                        <td className={`${td} ${num}`}>
                          {r.sharesAfter === null ? '' : shares(r.sharesAfter)}
                        </td>
                        <td className={td}>{plan(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </PanelShell>
  );
}
