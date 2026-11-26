import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  disclosureLag,
  etDate,
  explainTransactionCode,
  formatFactValue,
  summarizeRecentOpenMarket,
} from '@marsad/core';
import { loadInsiders, type Form3Filing, type InsiderRow } from '../../lib/studyPanels';
import { ScrollX } from '../Card';
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

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function Form3Card({ f }: { f: Form3Filing }) {
  const h = t.study.insiders.holdings;
  const filed = f.filedAt ? etDate(new Date(f.filedAt)) : null;
  const lag = filed && f.eventDate && !f.isAmendment ? days(f.eventDate, filed) : null;
  const who = [
    f.isOfficer
      ? f.officerTitle
        ? `${t.study.insiders.officer}, ${f.officerTitle}`
        : t.study.insiders.officer
      : null,
    f.isDirector ? t.study.insiders.director : null,
    f.isTenPercentOwner ? t.study.insiders.tenPercent : null,
  ]
    .filter((x): x is string => x !== null)
    .join('; ');
  return (
    <li className="rounded-sm border border-line p-3">
      <p className="font-medium">
        {f.ownerName}
        {f.coOwners.length > 0 && (
          <span className="ms-1 font-normal text-muted">{h.coOwners(f.coOwners.length)}</span>
        )}
      </p>
      <p className="text-sm text-muted">{who}</p>
      <p className="text-sm">
        {h.eventDate(f.eventDate)}
        {filed ? `, ${h.filed(filed, lag)}` : ''}
      </p>
      {f.isAmendment && (
        <p className="text-sm text-muted">
          {t.study.insiders.form(f.form)}: {h.amends(f.originalSubmission)}
        </p>
      )}
      {f.noSecuritiesOwned === true ? (
        <p className="mt-1 text-sm font-medium">{h.noSecurities}</p>
      ) : f.holdings.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{h.noRows}</p>
      ) : (
        <ScrollX label={h.title} className="mt-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{h.colSecurity}</th>
                <th className={thNum}>{h.colAmount}</th>
                <th className={th}>{h.colOwnership}</th>
                <th className={thNum}>{h.colPrice}</th>
                <th className={th}>{h.colExpires}</th>
              </tr>
            </thead>
            <tbody>
              {f.holdings.map((x, idx) => (
                <tr key={idx}>
                  <td className={td}>
                    {x.securityTitle}
                    {x.table === 'derivative' && (
                      <span className="ms-1 text-xs text-muted">({h.derivative})</span>
                    )}
                    {x.footnotes.map((n, k) => (
                      <span key={k} className="block text-xs text-muted">
                        {n.length > 260 ? `${n.slice(0, 260)}...` : n}
                      </span>
                    ))}
                  </td>
                  <td className={`${td} ${num}`}>
                    {x.table === 'derivative'
                      ? x.underlyingShares === null
                        ? ''
                        : h.convertsInto(shares(x.underlyingShares), x.underlyingTitle ?? '')
                      : x.shares === null
                        ? ''
                        : h.shares(shares(x.shares))}
                  </td>
                  <td className={td}>
                    {x.ownership === 'I'
                      ? h.indirect(x.nature)
                      : x.ownership === 'D'
                        ? h.direct
                        : ''}
                  </td>
                  <td className={`${td} ${num}`}>
                    {x.table !== 'derivative'
                      ? ''
                      : x.exercisePrice === null
                        ? h.priceNotStated
                        : `$${x.exercisePrice.toFixed(2)}`}
                  </td>
                  <td className={td}>
                    {x.table === 'derivative' ? (x.expirationDate ?? h.noDate) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
    </li>
  );
}

function Form3Section({ filings }: { filings: readonly Form3Filing[] }) {
  const h = t.study.insiders.holdings;
  const [all, setAll] = useState(false);
  const shown = all ? filings : filings.slice(0, 4);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <h3 className="text-sm font-medium">{h.title}</h3>
      <p className="text-sm text-muted">{h.note}</p>
      {filings.length === 0 ? (
        <p className="text-muted">{h.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((f) => (
            <Form3Card key={f.accession} f={f} />
          ))}
        </ul>
      )}
      {filings.length > 4 && (
        <button
          type="button"
          className="min-h-11 self-start rounded-sm border border-line px-3"
          onClick={() => setAll(!all)}
        >
          {all ? h.showFewer : h.showAll(filings.length)}
        </button>
      )}
    </div>
  );
}

export function Insiders({ cik }: { cik: string }) {
  const q = useQuery({ queryKey: ['insiders', cik], queryFn: () => loadInsiders(cik) });
  const i = t.study.insiders;
  // Fixed when the panel opens, so rendering stays pure and the 90-day window does not move while it is open.
  const [cutoff] = useState(() =>
    new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
  );
  const summary = useMemo(
    () => (q.data ? summarizeRecentOpenMarket(q.data.rows, cutoff) : null),
    [q.data, cutoff],
  );

  return (
    <PanelShell id="insiders" title={i.title} state={q}>
      <p className="text-sm text-muted">{i.note}</p>
      <ul className="list-none text-sm text-muted">
        {(['3', '4', '5'] as const).map((f) => (
          <li key={f}>
            {i.form(f)}: {disclosureLag(f)?.label}.
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{i.lagNote}</p>
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
                usd(summary.soldUsd),
                shares(summary.soldShares),
                usd(summary.boughtUsd),
                shares(summary.boughtShares),
              )}
            </p>
            {summary.amendmentLines > 0 && (
              <p className="text-sm text-muted">{i.amendmentLines(summary.amendmentLines)}</p>
            )}
            <ScrollX label={i.title}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>{i.colDate}</th>
                    <th className={th}>{i.colFiled}</th>
                    <th className={th}>{i.colForm}</th>
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
                        <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {r.filedAt ? etDate(new Date(r.filedAt)) : ''}
                        </td>
                        <td className={td}>
                          {i.form(r.form)}
                          {r.isAmendment && (
                            <span className="block text-xs text-muted">{i.amendment}</span>
                          )}
                        </td>
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
            </ScrollX>
          </>
        )
      )}
      {q.data && <Form3Section filings={q.data.form3} />}
    </PanelShell>
  );
}
