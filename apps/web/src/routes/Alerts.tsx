import { useState } from 'react';
import { Info } from '../components/Info';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  calibration,
  rewardRisk,
  wilson,
  MIN_CASES,
  type AlertInput,
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
import { dayMonth, weekdayDayMonth } from '../lib/dates';
import { TickerLink } from '../components/QuickLook';
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

/** The design's list time: "Wed 25 Nov · 16:42 ET · 00:42 Riyadh". */
function whenShort(iso: string): string {
  const d = new Date(iso);
  const c = dualClock(d, DEFAULT_LOCAL_ZONE);
  const city = (DEFAULT_LOCAL_ZONE.split('/').at(-1) ?? '').replace(/_/g, ' ');
  return a.when(weekdayDayMonth(etDate(d)), c.et, c.local, city);
}

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
            <span className="order-last ms-auto font-semibold text-up">
              {a.decisionShort[row.decision] ?? row.decision}
            </span>
            <span className="font-bold tracking-wide text-muted">{row.kind.toUpperCase()}</span>
            <span
              className={`rounded px-1.5 py-px font-semibold ${BADGE[row.priority] ?? BADGE['normal']}`}
            >
              {a.priority[row.priority] ?? row.priority}
            </span>
            {row.ticker && <span className="font-bold text-white">{row.ticker}</span>}
          </span>
          {headline && <span className="text-[0.9375rem] leading-snug text-fg">{headline}</span>}
          <span className="text-[13px] text-muted">{whenShort(row.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

const v = a.visual;

/** Stop, signal and now on one bar with the targets, plus reward to risk per target, from the stored input. */
function PlanVisual({ input }: { input: AlertInput }) {
  const p = input.plan;
  const entry = input.signalPrice ?? input.price;
  if (!p || p.stop === undefined || entry === undefined) return null;
  const targets = p.targets ?? [];
  const now = input.price ?? entry;
  const pts = [p.stop, entry, now, ...targets];
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.06 || 1;
  const at = (x: number) => `${toFixedHalfUp(((x - (lo - pad)) / (hi - lo + 2 * pad)) * 100, 1)}%`;
  const f2 = (x: number) => toFixedHalfUp(x, 2);
  const rr = targets.length ? rewardRisk(entry, p.stop, targets) : [];
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={v.planAria(f2(p.stop), f2(entry), f2(now), targets.map(f2).join(', ') || '-')}
        className="relative mt-1 h-2 rounded-full bg-gradient-to-r from-down/65 via-muted/25 to-up/60"
      >
        <span
          className="absolute -top-1 h-4 w-0.5 bg-fg/70"
          style={{ insetInlineStart: at(entry) }}
        />
        {targets.map((tg) => (
          <span
            key={tg}
            className="absolute -top-1 h-4 w-0.5 bg-up"
            style={{ insetInlineStart: at(tg) }}
          />
        ))}
        <span
          className="absolute -top-1.5 -ms-2.5 size-5 rounded-full border-[3px] border-surface bg-white"
          style={{ insetInlineStart: at(now) }}
        />
      </div>
      <span className="flex justify-between text-[0.6875rem] text-muted tabular-nums">
        <span>
          {v.stop} {f2(p.stop)}
        </span>
        <span>
          {v.now} {f2(now)}
        </span>
        <span>
          {v.target} {targets.map(f2).join(', ') || '-'}
        </span>
      </span>
      {rr.length > 0 && (
        <ul aria-label={v.rrTitle} className="flex flex-wrap gap-1.5">
          {rr.map((r, i) => (
            <li key={i} className="rounded-full bg-up/15 px-2 py-0.5 text-xs font-semibold text-up">
              {v.rr(toFixedHalfUp(r, 1))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Loss rate by horizon with its 90% interval, only from 30 cases up. */
function RiskVisual({ input }: { input: AlertInput }) {
  return (
    <ul className="flex flex-col gap-2">
      {input.risk.map((r) => {
        const label = v.horizons[r.horizon] ?? r.horizon;
        if (r.n === null)
          return (
            <li key={r.horizon} className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="text-muted">{v.notApplicable}</span>
            </li>
          );
        if (r.n < MIN_CASES)
          return (
            <li key={r.horizon} className="flex justify-between gap-2 text-sm">
              <span>{label}</span>
              <span className="text-muted">{v.insufficient(r.n)}</span>
            </li>
          );
        const rate = r.losses / r.n;
        const w = wilson(r.losses, r.n);
        const pc = (x: number) => toFixedHalfUp(x * 100, 1);
        return (
          <li key={r.horizon} className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between gap-2">
              <span>{label}</span>
              <span className="text-muted tabular-nums">{v.lossRate(pc(rate), r.n)}</span>
            </span>
            <span
              role="img"
              aria-label={v.ciAria(label, pc(rate), w ? pc(w.low) : '-', w ? pc(w.high) : '-', r.n)}
              className="relative h-2 rounded-full bg-faint/20"
            >
              {w && (
                <span
                  className="absolute inset-y-0 rounded-full bg-down/35"
                  style={{ insetInlineStart: `${pc(w.low)}%`, width: `${pc(w.high - w.low)}%` }}
                />
              )}
              <span
                className="absolute -top-1 h-4 w-0.5 bg-white"
                style={{ insetInlineStart: `${pc(rate)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChecklistVisual({ input }: { input: AlertInput }) {
  const c = input.checklist;
  if (!c) return null;
  return (
    <ul aria-label={v.checklist} className="grid grid-cols-1 gap-2 text-sm">
      {(Object.keys(v.checks) as (keyof NonNullable<AlertInput['checklist']>)[]).map((k) => (
        <li key={k} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex size-5 items-center justify-center rounded text-xs font-bold ${c[k] ? 'bg-up/20 text-up' : 'bg-down/20 text-down'}`}
          >
            {c[k] ? '\u2713' : '\u2715'}
          </span>
          <span>
            {v.checks[k]}: <span className="sr-only">{c[k] ? v.yes : v.no}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The full card, in the order the alert pipeline wrote it, with the feedback buttons. */
/** The full alert card. In the phone sheet the sheet title already shows the headline, so it is not repeated. */
function AlertDetail({ row, inSheet = false }: { row: StoredAlertRow; inSheet?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: Verdict) => saveFeedback(row.id, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const [header, ...rest] = row.card;
  const hid = `alert-detail-${row.id}`;
  const section = (sec: (typeof rest)[number], n: number) => {
    const bear = sec.heading === 'Bear case';
    return (
      <div
        key={sec.heading}
        className={`flex flex-col gap-1.5 rounded-xl p-4 ${bear ? 'bg-down/12 ring-1 ring-down/30' : 'bg-surface ring-1 ring-line'}`}
      >
        <h3 className={`text-[0.8125rem] font-bold ${bear ? 'text-down' : 'text-fg'}`}>
          {String(n).padStart(2, '0')} {'\u00B7'} {sec.heading}
        </h3>
        {row.input && sec.heading === 'Plan' && <PlanVisual input={row.input} />}
        {row.input && sec.heading.startsWith('Risk') && <RiskVisual input={row.input} />}
        {row.input && sec.heading === 'Checklist' && <ChecklistVisual input={row.input} />}
        {sec.lines.map((l) => (
          // Where a visual draws the risk or the checklist, its sentence is for screen readers only (council batch 2).
          <p
            key={l}
            className={
              row.input && (sec.heading.startsWith('Risk') || sec.heading === 'Checklist')
                ? 'sr-only'
                : 'text-sm leading-snug text-fg'
            }
          >
            {l}
          </p>
        ))}
      </div>
    );
  };
  const numbered = rest.map((sec, i) => ({ sec, n: i + 1 }));
  const pair = numbered.filter(
    (x) => x.sec.heading === 'Checklist' || x.sec.heading === 'Bear case',
  );
  const single = numbered.filter((x) => !pair.includes(x));
  const beforePair = single.filter((x) => x.n < (pair[0]?.n ?? 99));
  const afterPair = single.filter((x) => x.n > (pair[0]?.n ?? 99));
  return (
    <section aria-labelledby={hid} className="flex flex-col gap-4">
      {header && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-raised p-5">
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold tracking-wide text-muted">{row.kind.toUpperCase()}</span>
            <span
              className={`rounded px-1.5 py-px font-semibold ${BADGE[row.priority] ?? BADGE['normal']}`}
            >
              {a.priority[row.priority] ?? row.priority}
            </span>
            {row.ticker && <TickerLink ticker={row.ticker} className="text-base" />}
            <span className="ms-auto rounded bg-bg px-2 py-0.5 font-semibold text-up">
              {a.decision[row.decision] ?? row.decision}
            </span>
          </span>
          <h2 id={hid} className={inSheet ? 'sr-only' : 'text-xl font-bold text-white'}>
            {header.heading}
          </h2>
          {header.lines.map((l) => (
            <p key={l} className="text-[0.9375rem] text-fg">
              {l}
            </p>
          ))}
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {row.reasons.map((r) => (
              <li key={r} className="rounded-full bg-bg/60 px-2.5 py-1 text-xs text-fg">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {beforePair.map((x) => section(x.sec, x.n))}
      {pair.length > 0 && (
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          {pair.map((x) => section(x.sec, x.n))}
        </div>
      )}
      {afterPair.map((x) => section(x.sec, x.n))}
      <p className="text-xs text-muted">
        {a.at(whenText(row.createdAt))}{' '}
        {row.latencyMs !== null ? a.latency(toFixedHalfUp(row.latencyMs / 1000, 1)) : ''}{' '}
        {a.delivery(row.delivery['push'] ?? 'none')}
      </p>
      <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 ring-1 ring-line">
        <span className="text-sm font-semibold text-white">{a.feedbackPrompt}</span>
        <div role="group" aria-label={a.feedback} className="grid grid-cols-3 gap-2">
          {VERDICTS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={row.feedback === v}
              disabled={m.isPending}
              onClick={() => m.mutate(v)}
              className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${
                row.feedback === v ? 'border-up bg-raised text-white' : 'border-muted/40 text-white'
              }`}
            >
              {a.verdicts[v]}
            </button>
          ))}
        </div>
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
  const perAlert = [...q.data.alerts]
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, 8)
    .map((al) => ({
      id: al.id,
      label: `${al.ticker ?? ''} ${al.ruleId}`.trim(),
      day: dayMonth(etDate(new Date(al.createdAt))),
    }));
  // Rules with fewer than 30 scored cases get the design's box; the rest keep the table.
  const enough = rows.filter((r) => !r.insufficient);
  const thin = [
    ...new Map(
      rows
        .filter(
          (r) =>
            r.insufficient && !enough.some((e) => e.ruleId === r.ruleId && e.status === r.status),
        )
        .sort((x, y) => y.n - x.n)
        .reverse()
        .map((r) => [`${r.ruleId}-${r.status}`, r]),
    ).values(),
  ];
  return (
    <section aria-labelledby="scorecard" className={`${cardClass} gap-3!`}>
      <h2 id="scorecard" className={panelTitle}>
        {s.title}
      </h2>
      <p className="text-[13px] text-muted">{s.sub}</p>
      <p className="sr-only">{s.intro}</p>
      {rows.length === 0 && <p className="text-muted">{s.none}</p>}
      {thin.map((r) => (
        <div
          key={`${r.ruleId}-${r.status}`}
          className="flex flex-col gap-1.5 rounded-xl bg-bg px-3 py-2.5"
        >
          <span className="text-xs text-muted">{s.ruleLabel(r.ruleId, r.status === 'shadow')}</span>
          <span className="text-[15px] text-fg">{s.insufficientRow(r.n)}</span>
          <span aria-hidden="true" className="flex gap-0.5">
            {Array.from({ length: 30 }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-[1px] ${i < r.n ? 'bg-fg' : 'bg-faint/25'}`}
              />
            ))}
          </span>
          <span className="text-[13px] text-muted">{s.hitRatesAt}</span>
        </div>
      ))}
      {enough.length > 0 && (
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
              {enough.map((r) => (
                <tr key={`${r.ruleId}-${r.status}-${r.horizon}`}>
                  <td className={td}>{s.ruleLabel(r.ruleId, r.status === 'shadow')}</td>
                  <td className={`${td} ${num}`}>{r.horizon.replace('d', '')}</td>
                  <td className={`${td} ${num}`}>{r.n}</td>
                  <td className={`${td} ${num}`}>
                    {r.winRate === null ? '–' : share(r.winRate)}{' '}
                    {r.winCi ? `(${share(r.winCi.low)} to ${share(r.winCi.high)})` : ''}
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
      {perAlert.length > 0 && (
        <ul aria-label={s.perAlertLabel} className="flex flex-col">
          {perAlert.map((al) => (
            <li key={al.id} className="flex flex-col gap-1.5 border-t border-line-soft py-2.5">
              <span className="flex justify-between gap-2.5">
                <span className="font-semibold text-white">{al.label}</span>
                <span className="text-[13px] text-muted">{al.day}</span>
              </span>
              <span className="grid grid-cols-3 gap-1.5">
                {(['1d', '5d', '20d'] as const).map((h) => {
                  const o = q.data.outcomes.find((x) => x.alertId === al.id && x.horizon === h);
                  const done = o && o.status === 'done' && o.ret !== null ? o.ret : null;
                  return (
                    <span key={h} className="flex flex-col rounded-[10px] bg-bg px-2 py-1.5">
                      <span className="text-xs text-muted">{s.sessions(h.replace('d', ''))}</span>
                      <span
                        className={`font-semibold tabular-nums ${done === null ? 'text-fg' : done >= 0 ? 'text-up' : 'text-down'}`}
                      >
                        {done === null
                          ? s.pendingCell
                          : `${done >= 0 ? '▲' : '▼'} ${pctSigned(done)}`}
                      </span>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pending > 0 && <p className="text-xs text-muted">{s.pending(pending)}</p>}
      <h3 className="text-sm font-semibold">{s.calibration}</h3>
      {cal === null ? (
        <p className="text-sm text-muted">{s.noCalibration}</p>
      ) : (
        <ul className="text-sm">
          {cal.map((b) => (
            <li key={b.low}>
              {s.bin(b.low, b.high)}: n={b.n},{' '}
              {b.ci === null || b.winRate === null
                ? s.binInsufficient
                : `${share(b.winRate)} (${share(b.ci.low)} to ${share(b.ci.high)})`}
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
    <div className="mx-auto flex max-w-[1248px] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="sr-only text-[28px] font-bold text-white tablet:not-sr-only">{a.title}</h1>
          <Info>{a.intro}</Info>
        </div>
        {q.data && q.data.length > 0 && wide && (
          <Segmented
            label={a.tabsLabel}
            options={TABS.map((k) => ({
              key: k,
              label: a.tabCount(a.tabs[k] ?? k, rows.filter((r) => inTab(r, k)).length),
            }))}
            value={tab}
            onChange={(k) => {
              setTab(k);
              setPicked(null);
            }}
          />
        )}
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
            {!wide && (
              <Segmented
                label={a.tabsLabel}
                options={TABS.map((k) => ({
                  key: k,
                  label: a.tabCount(a.tabs[k] ?? k, rows.filter((r) => inTab(r, k)).length),
                }))}
                value={tab}
                onChange={(k) => {
                  setTab(k);
                  setPicked(null);
                }}
                stretch
              />
            )}
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
                <div className="sticky top-20">
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
                {selected && <AlertDetail row={selected} inSheet />}
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
