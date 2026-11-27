/**
 * Small pieces of the v2 Alerts page (design handoff "Marsad v2", `pAlerts`): priority tones, decision colours,
 * the list and detail times, the decision path chips and the design's 20 px checklist box.
 */
import { dualClock, etDate } from '@marsad/core';
import type { Tone } from '../ui/kit';
import { zoneName } from '../Clock';
import { dayMonth } from '../../lib/dates';
import { t } from '../../strings';

const a = t.alerts;

/** Priority pill tone: critical red, high amber, the rest neutral (the word always carries the meaning). */
export const PRIORITY_TONE: Record<string, Tone> = {
  critical: 'crit',
  high: 'warn',
  normal: 'neutral',
  digest: 'neutral',
};

/** The same priority as an outlined pill, for the card header (readable on any surface, including the sheet). */
export const PRIORITY_OUTLINE: Record<string, string> = {
  critical: 'border-crit/60 text-crit',
  high: 'border-warn/60 text-warn',
  normal: 'border-line-strong text-ink2',
  digest: 'border-line-strong text-ink2',
};

/** Decision colour in the list (design `DC`): pushed blue, digest body, shadow amber, suppressed muted. */
export const DECISION_TEXT: Record<string, string> = {
  push: 'text-up',
  digest: 'text-ink2',
  shadow: 'text-warn',
  suppress: 'text-ink3',
};

export const kindLabel = (kind: string) => a.kinds[kind] ?? kind;
export const priorityLabel = (p: string) => a.priority[p] ?? p;

/** The list time: "25 Nov 16:42 ET". */
export function whenList(iso: string): string {
  const d = new Date(iso);
  return a.whenList(dayMonth(etDate(d)), dualClock(d).et);
}

/** The detail time: "25 Nov 16:42 ET · 00:42 Riyadh", in the second zone chosen in Settings. */
export function whenFull(iso: string, zone: string): string {
  const d = new Date(iso);
  const c = dualClock(d, zone);
  return a.when(dayMonth(etDate(d)), c.et, c.local, zoneName(zone));
}

/** Pipeline reasons that mean a gate was passed; every other reason is where the alert was held or redirected. */
const PASSED = new Set(['data fresh', 'rule live', 'pushed']);
export const gatePassed = (reason: string) =>
  PASSED.has(reason) || reason.startsWith('critical: pushed');

/** The decision path as chips, in the order the pipeline ran its gates (design: gate chips). */
export function GateChips({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul aria-label={a.detail.gatesLabel} className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <li
          key={r}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            gatePassed(r) ? 'bg-up-soft text-up' : 'bg-warn-soft text-warn'
          }`}
        >
          {r}
        </li>
      ))}
    </ul>
  );
}

const BOX_PATH = { ok: 'M5 12l5 5 9-10', no: 'M6 6l12 12M18 6L6 18', open: 'M12 12h.01' };

/** The design's checklist box: filled with a tick when done, outlined with a cross when not, a dot when unknown. */
export function CheckBox({ state }: { state: 'ok' | 'no' | 'open' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 flex-none items-center justify-center rounded-md border ${
        state === 'ok' ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-ink3'
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={state === 'open' ? 6 : 3}
        strokeLinecap="round"
      >
        <path d={BOX_PATH[state]} />
      </svg>
    </span>
  );
}
