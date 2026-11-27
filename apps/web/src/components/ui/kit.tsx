/**
 * Marsad v2 shared pieces (Claude Design handoff "Marsad v2"): numbers that keep their order in Arabic, the page
 * header, tone pills, signed change badges, label and value rows, bar rows with a limit tick, checklists, the
 * stop bar and the 80 x 24 spark. Every colour comes from the theme tokens, so both themes work unchanged.
 */
import type { ReactNode } from 'react';
import { useShellText } from '../../lib/display';
import type { PageKey } from '../../strings';

export type Tone = 'up' | 'down' | 'warn' | 'crit' | 'neutral' | 'accent';

const TONE: Record<Tone, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  neutral: 'bg-sub text-ink2',
  accent: 'bg-accent text-accent-ink',
};

/**
 * A number, ticker, date or time inside text. In Arabic pages the string keeps its left-to-right order
 * (README: wrap numeric strings so they never reorder).
 */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`[unicode-bidi:isolate] tabular-nums ${className}`}>
      {children}
    </span>
  );
}

/** H1 24/600 with the subtitle under it and an optional source chip on the end side. */
export function PageHeader({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h1>
        {subtitle && <p className="max-w-[760px] text-sm text-ink2">{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A rounded label: state, priority, tier, impact. Tone colour is never the only signal; the text says it. */
export function Pill({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Signed percentage with arrow: "▲ +2.84%", "▼ −3.21%" (U+2212 minus). */
export function signedPct(v: number, digits = 2): string {
  return `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v).toFixed(digits)}%`;
}

/** Signed without an arrow: "+7.7%", "−5.5%". */
export function signed(v: number, digits = 1, unit = '%'): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`;
}

/** A change as a soft badge: blue up, orange down, always with the sign and the arrow. */
export function ChangeBadge({
  pct,
  digits = 2,
  className = '',
}: {
  /** Percent, e.g. 2.84 for +2.84%. */
  pct: number;
  digits?: number;
  className?: string;
}) {
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums [unicode-bidi:isolate] ${
        pct >= 0 ? 'bg-up-soft text-up' : 'bg-down-soft text-down'
      } ${className}`}
    >
      {signedPct(pct, digits)}
    </span>
  );
}

export interface Row {
  k: ReactNode;
  v: ReactNode;
  note?: ReactNode;
  /** Value colour class, e.g. "text-up". */
  tone?: string;
}

/** Label and value rows with a divider, each with an optional note line. */
export function RowList({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0 first:pt-0"
        >
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-ink3">{r.k}</dt>
            <dd className={`text-end font-semibold tabular-nums ${r.tone ?? 'text-ink'}`}>{r.v}</dd>
          </div>
          {r.note && <p className="text-xs text-ink3">{r.note}</p>}
        </div>
      ))}
    </dl>
  );
}

/** A label row with a bar under it (0 to 100) and an optional limit tick. */
export function BarRow({
  label,
  value,
  width,
  note,
  barClass = 'bg-up',
  limit,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Bar fill in percent, clamped to 0 to 100. */
  width: number;
  note?: ReactNode;
  barClass?: string;
  /** Limit tick position in percent. */
  limit?: number;
}) {
  const w = Math.max(0, Math.min(100, width));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink2">{label}</span>
        <span className="font-semibold text-ink tabular-nums">{value}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-sub">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${w}%` }} />
        {limit !== undefined && (
          <span
            aria-hidden="true"
            className="absolute -top-1 h-3.5 w-0.5 bg-ink"
            style={{ insetInlineStart: `${Math.max(0, Math.min(100, limit))}%` }}
          />
        )}
      </div>
      {note && <p className="text-xs text-ink3">{note}</p>}
    </div>
  );
}

export type CheckState = 'ok' | 'no' | 'open';
const CHECK_PATH: Record<CheckState, string> = {
  ok: 'M5 12l5 5 9-10',
  no: 'M6 6l12 12M18 6L6 18',
  open: 'M12 12h.01',
};

/** An SVG tick, cross or dot; the label beside it carries the meaning. */
export function CheckIcon({ state }: { state: CheckState }) {
  const tone = state === 'ok' ? 'text-up' : state === 'no' ? 'text-down' : 'text-ink3';
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`size-4 flex-none ${tone}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={state === 'open' ? 6 : 2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={CHECK_PATH[state]} />
    </svg>
  );
}

export function Checklist({
  items,
}: {
  items: readonly { label: ReactNode; state: CheckState; note?: ReactNode }[];
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((x, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-ink2">
          <span className="mt-0.5">
            <CheckIcon state={x.state} />
          </span>
          <span className="flex flex-col gap-0.5">
            {x.label}
            {x.note && <span className="text-xs text-ink3">{x.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stop bar: the down colour from the stop, through the neutral track, to the up colour at the target, with a
 * knob at the current price. Levels outside the range are clamped; labels carry the exact numbers.
 */
export function StopBar({
  stop,
  now,
  target,
  labels,
}: {
  stop: number;
  now: number;
  target: number;
  labels?: { stop: ReactNode; now: ReactNode; target: ReactNode };
}) {
  const lo = Math.min(stop, target);
  const hi = Math.max(stop, target);
  const pos = hi > lo ? Math.max(0, Math.min(100, ((now - lo) / (hi - lo)) * 100)) : 50;
  const at = stop <= target ? pos : 100 - pos;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative h-2 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, var(--color-down) 0%, var(--color-sub) 45%, var(--color-sub) 55%, var(--color-up) 100%)',
        }}
      >
        <span
          aria-hidden="true"
          className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink rtl:translate-x-1/2"
          style={{ insetInlineStart: `${at}%` }}
        />
      </div>
      {labels && (
        <div className="flex justify-between gap-2 text-xs text-ink3 tabular-nums">
          <span>{labels.stop}</span>
          <span className="font-semibold text-ink">{labels.now}</span>
          <span>{labels.target}</span>
        </div>
      )}
    </div>
  );
}

/** The 80 x 24 spark of the last closes, coloured by direction; hidden from screen readers (numbers beside it). */
export function Spark({
  values,
  className,
  width = 80,
  height = 24,
}: {
  values: readonly number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span aria-hidden="true" style={{ width, height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)} ${(
          height -
          2 -
          ((v - lo) / span) * (height - 4)
        ).toFixed(1)}`,
    )
    .join(' ');
  const up = (values.at(-1) ?? 0) >= (values[0] ?? 0);
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`flex-none ${className ?? (up ? 'text-up' : 'text-down')}`}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** A grid that fits as many columns of at least `min` as the width allows (1 on phones, 2 to 4 on desktop). */
export function AutoGrid({
  min,
  gap = 'gap-3',
  className = '',
  children,
}: {
  min: number;
  gap?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid ${gap} ${className}`}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
    >
      {children}
    </div>
  );
}

/** The page title and subtitle from the shared strings, in the chosen language. */
export function PageTitle({ page, aside }: { page: PageKey; aside?: ReactNode }) {
  const p = useShellText().pages[page];
  return <PageHeader title={p.title} subtitle={p.subtitle} aside={aside} />;
}
