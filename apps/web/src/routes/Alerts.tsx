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
import { Link } from '@tanstack/react-router';
import { Segmented, SkeletonCards, cardClass, ScrollX, useWide } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { num, td, th, thNum, panelTitle } from '../components/study/Panel';
import { Scenarios } from '../components/alerts/Scenarios';
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

type Tab = 'sent' | 'held' | 'all';
const TABS: Tab[] = ['sent', 'held', 'all'];
const inTab = (row: StoredAlertRow, tab: Tab) =>
  tab === 'all' ||
  (tab === 'sent'
    ? ['push', 'digest'].includes(row.decision)
    : !['push', 'digest'].includes(row.decision));

const BAR: Record<string, string> = {
  critical: 'bg-[#ED1C24]',
  high: 'bg-warn',
  normal: 'bg-faint',
};
const BADGE: Record<string, string> = {
  critical: 'border border-alarm/70 text-alarm',
  high: 'bg-warn/15 text-warn',
  normal: 'bg-muted/15 text-fg',
};

const whenText = (iso: string) => {
  const d = new Date(iso);
  return `${etDate(d)} ${dualClock(d, DEFAULT_LOCAL_ZONE).label}`;
};

/** One alert in the list: priority bar, kind, priority, ticker, headline, decision and time (words carry it all). */
function AlertRow({
  row,
  selected,
  onOpen,
}: {
  row: StoredAlertRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const headline = row.card[0]?.lines[0] ?? '';
  return (
    <li id={`alert-${row.id}`} className="scroll-mt-24">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        className={`relative flex w-full gap-3 overflow-hidden rounded-xl border p-3 ps-4 text-start ${
          selected ? 'border-up/60 bg-raised' : 'border-line bg-surface hover:bg-raised/50'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 start-0 w-1 ${BAR[row.priority] ?? 'bg-faint'}`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-bold tracking-wide text-muted">{row.kind.toUpperCase()}</span>
            <span
              className={`rounded px-1.5 py-px font-semibold ${BADGE[row.priority] ?? BADGE['normal']}`}
            >
              {a.priority[row.priority] ?? row.priority}
            </span>
            {row.ticker && <span className="font-bold text-white">{row.ticker}</span>}
          </span>
          <span className="text-[0.9375rem] leading-snug text-fg">{headline}</span>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted">
            <span className="font-semibold text-fg">
              {a.decision[row.decision] ?? row.decision}
            </span>
            <span>{whenText(row.createdAt)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** The full card, in the order the alert pipeline wrote it, with the feedback buttons. */
function AlertDetail({ row }: { row: StoredAlertRow }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Verdict) => saveFeedback(row.id, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const [header, ...rest] = row.card;
  const hid = `alert-detail-${row.id}`;
  return (
    <section aria-labelledby={hid} className="flex flex-col gap-4">
      {header && (
        <div className="flex flex-col gap-1">
          <h2 id={hid} className="text-lg font-bold text-white">
            {header.heading}
          </h2>
          {header.lines.map((l) => (
            <p key={l} className="text-[0.9375rem] text-fg">
              {l}
            </p>
          ))}
          <p className="text-sm font-semibold text-up">
            {a.decision[row.decision] ?? row.decision}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[0.8125rem] font-bold text-muted">{a.why}</h3>
        <ul className="flex flex-wrap gap-1.5">
          {row.reasons.map((r) => (
            <li key={r} className="rounded-full bg-bg px-2.5 py-1 text-xs text-fg">
              {r}
            </li>
          ))}
        </ul>
      </div>
      {rest.map((sec) => {
        const bear = sec.heading === 'Bear case';
        return (
          <div
            key={sec.heading}
            className={`flex flex-col gap-1 rounded-xl p-3 ${bear ? 'bg-down/12 ring-1 ring-down/30' : 'bg-bg/45'}`}
          >
            <h3 className={`text-[0.8125rem] font-bold ${bear ? 'text-down' : 'text-muted'}`}>
              {sec.heading}
            </h3>
            {sec.lines.map((l) => (
              <p key={l} className="text-sm leading-snug text-fg">
                {l}
              </p>
            ))}
          </div>
        );
      })}
      <p className="text-xs text-muted">
        {a.at(whenText(row.createdAt))}{' '}
        {row.latencyMs !== null ? a.latency(toFixedHalfUp(row.latencyMs / 1000, 1)) : ''}{' '}
        {a.delivery(row.delivery['push'] ?? 'none')}
      </p>
      <div role="group" aria-label={a.feedback} className="grid grid-cols-3 gap-2">
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={row.feedback === v}
            disabled={m.isPending}
            onClick={() => m.mutate(v)}
            className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${
              row.feedback === v ? 'border-up bg-up/15 text-white' : 'border-line text-muted'
            }`}
          >
            {a.verdicts[v]}
          </button>
        ))}
      </div>
      {m.isError && (
        <p role="alert" className="text-sm text-down">
          {m.error.message}
        </p>
      )}
    </section>
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
    <section aria-labelledby="scorecard" className={`${cardClass} gap-3!`}>
      <h2 id="scorecard" className={panelTitle}>
        {s.title}
      </h2>
      <p className="text-sm text-muted">{s.intro}</p>
      {rows.length === 0 ? (
        <p className="text-muted">{s.none}</p>
      ) : (
        <ScrollX label={s.tableLabel}>
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
        </ScrollX>
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
  const q = useQuery({ queryKey: ['alerts', true], queryFn: () => loadAlerts(true) });
  const wide = useWide();
  const [tab, setTab] = useState<Tab>('sent');
  const [picked, setPicked] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = q.data ?? [];
  const shown = rows.filter((r) => inTab(r, tab));

  // A push or email opens /alerts#alert-<id>: show that alert, in a tab that holds it.
  const hashId = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#alert-/, '');
  const [hashDone, setHashDone] = useState(false);
  if (!hashDone && q.data) {
    setHashDone(true);
    const hit = q.data.find((r) => r.id === hashId);
    if (hit) {
      if (!inTab(hit, tab)) setTab('all');
      setPicked(hit.id);
      if (!wide) setSheetOpen(true);
    }
  }
  const selected =
    rows.find((r) => r.id === picked && inTab(r, tab)) ?? (wide ? shown[0] : undefined);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{a.title}</h1>
        <p className="text-sm text-muted">{a.intro}</p>
      </div>
      {q.isPending && <SkeletonCards />}
      {q.isError && (
        <p role="alert" className="text-down">
          {q.error.message}
        </p>
      )}
      {q.data &&
        (q.data.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5">
            <p className="text-fg">{a.none}</p>
            <Link
              to="/lab"
              className="flex min-h-11 items-center rounded-xl border border-muted/40 px-4 font-semibold text-white"
            >
              {a.openLab}
            </Link>
          </div>
        ) : (
          <>
            <Segmented
              label={a.tabsLabel}
              options={TABS.map((k) => ({
                key: k,
                label: `${a.tabs[k]} (${rows.filter((r) => inTab(r, k)).length})`,
              }))}
              value={tab}
              onChange={(k) => {
                setTab(k);
                setPicked(null);
              }}
              stretch={!wide}
            />
            <div className="grid grid-cols-1 items-start gap-4 tablet:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
              {shown.length === 0 ? (
                <p className="text-sm text-muted">{a.noneHere}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {shown.map((row) => (
                    <AlertRow
                      key={row.id}
                      row={row}
                      selected={wide && selected?.id === row.id}
                      onOpen={() => {
                        setPicked(row.id);
                        if (!wide) setSheetOpen(true);
                      }}
                    />
                  ))}
                </ul>
              )}
              {wide && (
                <div className="sticky top-20 rounded-xl border border-line bg-surface p-5">
                  {selected ? (
                    <AlertDetail row={selected} />
                  ) : (
                    <p className="text-sm text-muted">{a.choose}</p>
                  )}
                </div>
              )}
            </div>
            {!wide && (
              <Sheet
                open={sheetOpen && !!selected}
                onClose={() => setSheetOpen(false)}
                title={selected?.card[0]?.heading ?? a.title}
              >
                {selected && <AlertDetail row={selected} />}
              </Sheet>
            )}
          </>
        ))}
      <Scorecard />
      <div className={cardClass}>
        <Scenarios />
      </div>
    </div>
  );
}
