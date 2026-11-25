import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toFixedHalfUp } from '@marsad/core';
import { num, td, th, thNum } from './Panel';
import { ErrorText } from '../ui';
import { loadHolders } from '../../lib/studyPanels';
import { t } from '../../strings';

const h = t.study.holders;
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const usd = (v: number) =>
  v >= 1e9 ? `$${toFixedHalfUp(v / 1e9, 2)} billion` : `$${toFixedHalfUp(v / 1e6, 1)} million`;

function List({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['holders', ticker], queryFn: () => loadHolders(ticker) });
  if (q.isPending) return <p className="text-muted">{h.loading}</p>;
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (q.data === null) return <p className="text-muted">{h.none}</p>;
  const d = q.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {h.summary(d.period, d.filers, int(d.totalShares), usd(d.totalValueUsd))}
      </p>
      <p className="text-xs text-muted">{h.lag(d.period)}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={thNum}>{h.colRank}</th>
              <th className={th}>{h.colFiler}</th>
              <th className={thNum}>{h.colShares}</th>
              <th className={thNum}>{h.colShare}</th>
              <th className={thNum}>{h.colValue}</th>
              <th className={th}>{h.colFiled}</th>
            </tr>
          </thead>
          <tbody>
            {d.top.map((r) => (
              <tr key={r.rank}>
                <td className={`${td} ${num}`}>{r.rank}</td>
                <td className={td}>{r.name}</td>
                <td className={`${td} ${num}`}>{int(r.shares)}</td>
                <td className={`${td} ${num}`}>{toFixedHalfUp(r.share * 100, 1)}%</td>
                <td className={`${td} ${num}`}>{usd(r.valueUsd)}</td>
                <td className={td}>{r.filingDate ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {h.cusips(d.cusips.map((c) => `${c.cusip} (${c.issuer})`).join(', '))}{' '}
        {h.leftOut(d.leftOut.options, d.leftOut.amendments, d.leftOut.otherPeriod)}
      </p>
    </div>
  );
}

/** 13F institutional holders (ADR 0037), loaded only when opened. */
export function Holders13F({ ticker }: { ticker: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="holders13f" className="flex flex-col gap-2">
      <h2 id="holders13f" className="font-semibold">
        {h.title}
      </h2>
      <p className="text-sm text-muted">{h.intro}</p>
      <details
        className="rounded-sm border border-line p-3"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center">{h.open}</summary>
        {open && <List ticker={ticker} />}
      </details>
    </section>
  );
}
