/**
 * One alert's card in the v2 order (design `pAlerts`): header, gate chips, trigger tiles, plan stop bar with
 * reward-to-risk chips, risk by horizon, checklist and bear case side by side, context line, sources, then
 * feedback and delivery channels. Every value comes from the stored card and input snapshot (rule 12); a part the
 * alert does not carry says so instead of being left out.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MIN_CASES,
  gapToStop,
  rewardRisk,
  toFixedHalfUp,
  wilson,
  type AlertInput,
  type CardSection,
} from '@marsad/core';
import { AutoGrid, Num, Pill, StopBar, signedPct } from '../ui/kit';
import { TickerLink } from '../QuickLook';
import { saveFeedback, type StoredAlertRow, type Verdict } from '../../lib/alerts';
import { useDisplay } from '../../lib/display';
import { t } from '../../strings';
import {
  CheckBox,
  DECISION_TEXT,
  GateChips,
  PRIORITY_OUTLINE,
  kindLabel,
  priorityLabel,
  whenFull,
} from './parts';

const a = t.alerts;
const d = a.detail;
const v = a.visual;
const VERDICTS: Verdict[] = ['useful', 'noise', 'acted'];
const f2 = (x: number) => toFixedHalfUp(x, 2);

/** Inner tile of the card: 10 px radius on the raised colour. */
const tileBox = 'flex flex-col rounded-[10px] border border-line bg-elev p-3.5';
const boxTitle = 'text-[13px] font-semibold text-ink';

function TriggerTiles({ input }: { input: AlertInput }) {
  const stop = input.plan?.stop;
  const now = input.price ?? input.signalPrice;
  const gap = now !== undefined && stop !== undefined ? gapToStop(now, stop) : null;
  const tiles: { k: string; v: string; s: string; tone?: string }[] = [];
  if (input.signalPrice !== undefined)
    tiles.push({ k: d.tiles.signal, v: f2(input.signalPrice), s: d.tiles.signalSub });
  if (input.price !== undefined && input.price !== input.signalPrice)
    tiles.push({ k: d.tiles.now, v: f2(input.price), s: d.tiles.nowSub });
  if (stop !== undefined) tiles.push({ k: d.tiles.stop, v: f2(stop), s: d.tiles.stopSub });
  if (gap !== null)
    tiles.push({
      k: d.tiles.gap,
      v: signedPct(gap * 100, 2),
      s: d.tiles.gapSub,
      tone: gap >= 0 ? 'text-up' : 'text-down',
    });
  if (tiles.length === 0) return null;
  return (
    <AutoGrid min={150} gap="gap-2.5">
      {tiles.map((x) => (
        <div
          key={x.k}
          className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-elev p-3"
        >
          <span className="text-xs text-ink3">{x.k}</span>
          <Num className={`text-lg font-semibold whitespace-nowrap ${x.tone ?? 'text-ink'}`}>
            {x.v}
          </Num>
          <span className="text-xs text-ink2">{x.s}</span>
        </div>
      ))}
    </AutoGrid>
  );
}

/** Stop, now, signal and targets on the kit's stop bar, with reward to risk per target from the signal price. */
function PlanLevels({ input, lines }: { input: AlertInput | null; lines: readonly string[] }) {
  const p = input?.plan;
  const entry = input?.signalPrice ?? input?.price;
  const levels = p && p.stop !== undefined && entry !== undefined;
  const targets = p?.targets ?? [];
  const rr =
    levels && p.stop !== undefined
      ? rewardRisk(entry, p.stop, targets).filter((r) => Number.isFinite(r))
      : [];
  const now = input?.price ?? entry;
  return (
    <div className={`${tileBox} gap-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={boxTitle}>{d.planTitle}</h3>
        {rr.length > 0 && (
          <ul aria-label={v.rrTitle} className="flex flex-wrap gap-1.5">
            {rr.map((r, i) => (
              <li key={i}>
                <Pill tone="up">{v.rr(i + 1, toFixedHalfUp(r, 1))}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
      {levels && p.stop !== undefined && now !== undefined && (
        <>
          <div
            role="img"
            aria-label={v.planAria(
              f2(p.stop),
              f2(entry),
              f2(now),
              targets.map(f2).join(', ') || '-',
            )}
            className="pt-1"
          >
            <StopBar
              stop={p.stop}
              now={now}
              target={targets.length ? Math.max(...targets) : entry}
            />
          </div>
          <span className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-ink2">
            <Num>
              {v.stop} {f2(p.stop)}
            </Num>
            <Num className="font-semibold text-ink">
              {v.now} {f2(now)}
            </Num>
            <Num>
              {v.signal} {f2(entry)}
            </Num>
            <Num>
              {v.target} {targets.map(f2).join(', ') || '-'}
            </Num>
          </span>
        </>
      )}
      {p ? (
        <>
          <p className="text-[13px] text-ink2">{d.entry(p.entry)}</p>
          <p className="text-[13px] text-ink2">{d.invalidation(p.invalidation)}</p>
        </>
      ) : (
        lines.map((l) => (
          <p key={l} className="text-[13px] text-ink2">
            {l}
          </p>
        ))
      )}
    </div>
  );
}

/** Loss rate by horizon with n and its 90% Wilson interval, only from 30 cases up (rules 10 and 15). */
function RiskByHorizon({ input, lines }: { input: AlertInput | null; lines: readonly string[] }) {
  const row = 'flex justify-between gap-2.5 border-t border-line py-1.5 text-[13px]';
  const risk = input?.risk ?? [];
  const none = input !== null && risk.every((r) => r.n === null);
  return (
    <div className={`${tileBox} gap-1.5`}>
      <h3 className={boxTitle}>{d.riskTitle}</h3>
      {input === null ? (
        lines.map((l) => (
          <p key={l} className="text-[13px] text-ink2">
            {l}
          </p>
        ))
      ) : (
        <>
          {lines.map((l) => (
            // The visual draws the rows; the card's sentence stays for screen readers (council batch 2).
            <p key={l} className="sr-only">
              {l}
            </p>
          ))}
          {none ? (
            <div className={row}>
              <span>{d.allHorizons}</span>
              <span className="text-ink3">{d.notThisKind}</span>
            </div>
          ) : (
            <ul className="flex flex-col">
              {risk.map((r) => {
                const label = v.horizons[r.horizon] ?? r.horizon;
                if (r.n === null || r.n < MIN_CASES)
                  return (
                    <li key={r.horizon} className={row}>
                      <span>{label}</span>
                      <span className="text-ink3">
                        {r.n === null ? v.notApplicable : v.insufficient(r.n)}
                      </span>
                    </li>
                  );
                const rate = r.losses / r.n;
                const w = wilson(r.losses, r.n);
                const pc = (x: number) => toFixedHalfUp(x * 100, 1);
                return (
                  <li key={r.horizon} className={`${row} flex-col`}>
                    <span className="flex justify-between gap-2">
                      <span>{label}</span>
                      <Num className="text-ink3">{v.lossRate(pc(rate), r.n)}</Num>
                    </span>
                    <span
                      role="img"
                      aria-label={v.ciAria(
                        label,
                        pc(rate),
                        w ? pc(w.low) : '-',
                        w ? pc(w.high) : '-',
                        r.n,
                      )}
                      className="relative mt-1 h-2 rounded-full bg-sub"
                    >
                      {w && (
                        <span
                          className="absolute inset-y-0 rounded-full bg-down/40"
                          style={{
                            insetInlineStart: `${pc(w.low)}%`,
                            width: `${pc(w.high - w.low)}%`,
                          }}
                        />
                      )}
                      <span
                        className="absolute -top-1 h-4 w-0.5 bg-ink"
                        style={{ insetInlineStart: `${pc(rate)}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

type CheckKey = keyof NonNullable<AlertInput['checklist']>;

/** The 5 items; an alert kind without a checklist shows each as n/a with a dot. */
function ChecklistBox({ input, lines }: { input: AlertInput | null; lines: readonly string[] }) {
  const c = input?.checklist;
  const keys = Object.keys(v.checks) as CheckKey[];
  return (
    <div className={`${tileBox} gap-1`}>
      <h3 className={`${boxTitle} pb-1`}>{d.checklistTitle}</h3>
      {lines.map((l) => (
        <p key={l} className="sr-only">
          {l}
        </p>
      ))}
      <ul aria-label={v.checklist} className="flex flex-col">
        {keys.map((k) => {
          const label = v.checks[k] ?? k;
          const val = c ? c[k] : null;
          return (
            <li key={k} className="flex min-h-8 items-center gap-2.5 text-[13px] text-ink2">
              <CheckBox state={val === null ? 'open' : val ? 'ok' : 'no'} />
              {val === null ? (
                <span>{d.notAnswered(label)}</span>
              ) : (
                <span>
                  {label}
                  <span className="sr-only">: {val ? v.yes : v.no}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const KNOWN = new Set([
  'Trigger',
  'Plan',
  'Context',
  'News',
  'Checklist',
  'Bear case',
  'Sources and freshness',
]);
const known = (h: string) => KNOWN.has(h) || h.startsWith('Risk');

/** The full alert card. In the phone sheet the sheet title already shows the heading, so it is not repeated. */
export function AlertDetail({ row, inSheet = false }: { row: StoredAlertRow; inSheet?: boolean }) {
  const { zone } = useDisplay();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (verdict: Verdict) => saveFeedback(row.id, verdict),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const [header, ...rest] = row.card;
  const sec = (h: string): CardSection | undefined => rest.find((s) => s.heading === h);
  const lines = (h: string) => sec(h)?.lines ?? [];
  const risk = rest.find((s) => s.heading.startsWith('Risk'));
  const other = rest.filter((s) => !known(s.heading));
  const input = row.input;
  const headline = header?.lines[0] ?? '';
  const ruleLine = header?.lines.slice(1) ?? [];
  const contextLine = [...lines('Context'), ...lines('News')].join(' · ');
  const bear = lines('Bear case');
  const plan = sec('Plan');
  const hid = `alert-detail-${row.id}`;
  const channels = Object.entries(row.delivery);
  return (
    <section
      aria-labelledby={hid}
      className={`flex min-w-0 flex-col gap-3.5 ${inSheet ? '' : 'rounded-xl border border-line bg-surface p-[18px]'}`}
    >
      <h2 id={hid} className="sr-only">
        {header?.heading ?? row.kind}
      </h2>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            {row.ticker && <TickerLink ticker={row.ticker} className="text-xl font-semibold" />}
            <span className="text-sm text-ink2">{kindLabel(row.kind)}</span>
            {/* Outlined, not tinted: the tint fails contrast on the phone sheet's raised colour. */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                PRIORITY_OUTLINE[row.priority] ?? PRIORITY_OUTLINE['normal']
              }`}
            >
              {priorityLabel(row.priority)}
            </span>
          </span>
          {headline && <span className="text-[15px] font-medium text-ink">{headline}</span>}
          {ruleLine.map((l) => (
            <span key={l} className="text-xs text-ink3">
              {l}
            </span>
          ))}
        </span>
        <span className="flex flex-col gap-1 tablet:items-end tablet:text-end">
          <Num className="text-xs text-ink3">{whenFull(row.createdAt, zone)}</Num>
          <span className={`text-xs font-semibold ${DECISION_TEXT[row.decision] ?? 'text-ink2'}`}>
            {a.decision[row.decision] ?? row.decision}
          </span>
        </span>
      </div>
      <GateChips reasons={row.reasons} />
      {lines('Trigger').map((l) => (
        <p key={l} className="text-sm text-ink2">
          {l}
        </p>
      ))}
      {input && <TriggerTiles input={input} />}
      {(input?.plan ?? plan) && <PlanLevels input={input} lines={plan?.lines ?? []} />}
      <RiskByHorizon input={input} lines={risk?.lines ?? []} />
      <AutoGrid min={260} gap="gap-3">
        <ChecklistBox input={input} lines={lines('Checklist')} />
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-down-soft p-3.5">
          <h3 className="text-[13px] font-semibold text-down">{d.bear}</h3>
          {(bear.length ? bear : input ? [input.bearCase] : []).map((l) => (
            <p key={l} className="text-[13px] leading-relaxed text-ink">
              {l}
            </p>
          ))}
        </div>
      </AutoGrid>
      {other.map((s) => (
        <div key={s.heading} className={`${tileBox} gap-1`}>
          <h3 className={boxTitle}>{s.heading}</h3>
          {s.lines.map((l) => (
            <p key={l} className="text-[13px] text-ink2">
              {l}
            </p>
          ))}
        </div>
      ))}
      {contextLine && <p className="text-xs text-ink2">{contextLine}</p>}
      {lines('Sources and freshness').length > 0 && (
        <p className="text-xs text-ink3">
          <span className="font-semibold">{d.sources}: </span>
          {lines('Sources and freshness').join(' · ')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div role="group" aria-label={a.feedback} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink3">{a.feedbackPrompt}</span>
          {VERDICTS.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={row.feedback === x}
              disabled={m.isPending}
              onClick={() => m.mutate(x)}
              className={`min-h-10 rounded-lg border px-3 text-[13px] font-semibold text-ink pointer-coarse:min-h-11 ${
                row.feedback === x ? 'border-ink3 bg-elev' : 'border-line'
              }`}
            >
              {a.verdicts[x]}
            </button>
          ))}
        </div>
        {channels.length > 0 && (
          <ul
            aria-label={d.channelsLabel}
            className="flex flex-wrap gap-x-1.5 text-xs text-ink3 [&>li+li]:before:me-1.5 [&>li+li]:before:content-['·']"
          >
            {channels.map(([k, s]) => (
              <li key={k}>{d.channel(d.channels[k] ?? k, s)}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-ink3">
        {a.at(whenFull(row.createdAt, zone))}
        {row.latencyMs !== null ? ` ${a.latency(toFixedHalfUp(row.latencyMs / 1000, 1))}` : ''}
      </p>
      {m.isError && (
        <p role="alert" className="text-sm text-down">
          {m.error.message}
        </p>
      )}
    </section>
  );
}
