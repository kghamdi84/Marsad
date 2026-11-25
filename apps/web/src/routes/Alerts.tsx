import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  calibration,
  dualClock,
  etDate,
  summarize,
  toFixedHalfUp,
} from '@marsad/core';
import { num, td, th, thNum } from '../components/study/Panel';
import {
  loadAlerts,
  loadScorecard,
  saveFeedback,
  type StoredAlertRow,
  type Verdict,
} from '../lib/alerts';
import { t } from '../strings';

const a = t.alerts;
const VERDICTS: Verdict[] = ['useful', 'noise', 'acted'];

function AlertCard({ row }: { row: StoredAlertRow }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Verdict) => saveFeedback(row.id, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const when = new Date(row.createdAt);
  const [header, ...rest] = row.card;
  return (
    <li className="flex flex-col gap-2 rounded-sm border border-line p-3">
      {header && (
        <div>
          <h2 className="font-semibold">{header.heading}</h2>
          {header.lines.map((l) => (
            <p key={l} className="text-sm">
              {l}
            </p>
          ))}
        </div>
      )}
      <p className="text-sm font-medium">{a.decision[row.decision] ?? row.decision}</p>
      {rest.map((s) => (
        <div key={s.heading}>
          <h3 className="text-sm font-medium text-muted">{s.heading}</h3>
          {s.lines.map((l) => (
            <p key={l} className="text-sm">
              {l}
            </p>
          ))}
        </div>
      ))}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted">{a.why}</summary>
        <ul className="list-disc ps-5">
          {row.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted">
        {a.at(`${etDate(when)} ${dualClock(when, DEFAULT_LOCAL_ZONE).label}`)}{' '}
        {row.latencyMs !== null ? a.latency(toFixedHalfUp(row.latencyMs / 1000, 1)) : ''}{' '}
        {a.delivery(row.delivery['push'] ?? 'none')}
      </p>
      <div role="group" aria-label={a.feedback} className="flex flex-wrap gap-2">
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={row.feedback === v}
            disabled={m.isPending}
            onClick={() => m.mutate(v)}
            className={`min-h-11 rounded-sm border px-3 text-sm ${row.feedback === v ? 'border-up text-fg' : 'border-line text-muted'}`}
          >
            {a.verdicts[v]}
          </button>
        ))}
        {m.isError && (
          <span role="alert" className="text-sm text-down">
            {m.error.message}
          </span>
        )}
      </div>
    </li>
  );
}

const pctSigned = (v: number | null) =>
  v === null
    ? '\u2013'
    : `${v > 0 ? '\u25b2 +' : v < 0 ? '\u25bc ' : ''}${toFixedHalfUp(v * 100, 2)}%`;
const share = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;

function Scorecard() {
  const s = a.scorecard;
  const q = useQuery({ queryKey: ['scorecard'], queryFn: loadScorecard });
  if (q.isPending) return null;
  if (q.isError)
    return (
      <p role="alert" className="text-down">
        {q.error.message}
      </p>
    );
  const rows = summarize(q.data.alerts, q.data.outcomes);
  const pending = q.data.outcomes.filter((o) => o.status === 'pending').length;
  const cal = calibration(q.data.alerts, q.data.outcomes, '5d');
  return (
    <section aria-labelledby="scorecard" className="flex flex-col gap-3">
      <h2 id="scorecard" className="font-semibold">
        {s.title}
      </h2>
      <p className="text-sm text-muted">{s.intro}</p>
      {rows.length === 0 ? (
        <p className="text-muted">{s.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{s.colRule}</th>
                <th className={thNum}>{s.colHorizon}</th>
                <th className={thNum}>{s.colN}</th>
                <th className={thNum}>{s.colWin}</th>
                <th className={thNum}>{s.colRet}</th>
                <th className={thNum}>{s.colExcess}</th>
                <th className={thNum}>{s.colExcursion}</th>
                <th className={thNum}>{s.colLevels}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ruleId}-${r.status}-${r.horizon}`}>
                  <td className={td}>
                    {r.ruleId} ({r.status === 'shadow' ? s.shadow : s.live})
                  </td>
                  <td className={`${td} ${num}`}>{r.horizon.replace('d', '')}</td>
                  <td className={`${td} ${num}`}>{r.n}</td>
                  <td className={`${td} ${num}`}>
                    {r.winRate === null ? '\u2013' : share(r.winRate)}{' '}
                    {r.winCi
                      ? `(${share(r.winCi.low)} to ${share(r.winCi.high)})`
                      : `(${s.insufficient})`}
                  </td>
                  <td className={`${td} ${num}`}>{pctSigned(r.meanRet)}</td>
                  <td className={`${td} ${num}`}>{pctSigned(r.meanExcess)}</td>
                  <td className={`${td} ${num}`}>
                    {pctSigned(r.meanMfe)} / {pctSigned(r.meanMae)}
                  </td>
                  <td className={`${td} ${num}`}>
                    {r.stops} / {r.targets}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending > 0 && <p className="text-xs text-muted">{s.pending(pending)}</p>}
      <h3 className="text-sm font-semibold">{s.calibration}</h3>
      {cal === null ? (
        <p className="text-sm text-muted">{s.noCalibration}</p>
      ) : (
        <ul className="text-sm">
          {cal.map((b) => (
            <li key={b.low}>
              {s.bin(b.low, b.high)}: n={b.n}, {b.winRate === null ? '\u2013' : share(b.winRate)}
              {b.ci ? ` (${share(b.ci.low)} to ${share(b.ci.high)})` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Alerts() {
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['alerts', all], queryFn: () => loadAlerts(all) });
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{a.title}</h1>
        <p className="text-sm text-muted">{a.intro}</p>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        {a.showSuppressed}
      </label>
      <Scorecard />
      {q.isPending && <p className="text-muted">{t.loading}</p>}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data &&
        (q.data.length === 0 ? (
          <p className="text-muted">{a.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.map((row) => (
              <AlertCard key={row.id} row={row} />
            ))}
          </ul>
        ))}
    </section>
  );
}
