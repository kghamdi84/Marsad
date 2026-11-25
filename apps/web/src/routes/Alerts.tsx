import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, dualClock, etDate, toFixedHalfUp } from '@marsad/core';
import { loadAlerts, saveFeedback, type StoredAlertRow, type Verdict } from '../lib/alerts';
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
