import type { ReactNode } from 'react';
import { t } from '../strings';

export const cardClass = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-5';

/** A titled page card (the redesign's surface panel). The title labels the region for assistive technology. */
export function Card({
  id,
  title,
  subtitle,
  aside,
  className = '',
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`${cardClass} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-[17px] font-semibold text-white">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Full tables, rules and sources: one tap away, never dropped. */
export function Details({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-up select-none">
        {t.common.showDetails}
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">{children}</div>
    </details>
  );
}

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-bg/45 px-3 py-2.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[22px] font-bold text-white">{value}</span>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </div>
  );
}

/** A segmented control: one choice of a few, each a 44-point button with its pressed state announced. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[10px] bg-bg p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`min-h-11 min-w-12 rounded-lg px-2.5 text-sm font-semibold ${
            o.key === value ? 'bg-raised text-white' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A small line chart of the last values (aria-hidden: the numbers beside it carry the meaning). Draws nothing
 * with fewer than two points.
 */
export function Sparkline({
  values,
  className = 'text-muted',
  height = 24,
}: {
  values: readonly number[];
  className?: string;
  height?: number;
}) {
  if (values.length < 2) return <span aria-hidden="true" style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 100).toFixed(2)},${(22 - ((v - lo) / span) * 20).toFixed(2)}`,
    )
    .join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A box that scrolls sideways (a wide table on a narrow screen): reachable by keyboard and named (WCAG 2.1.1). */
export function ScrollX({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className={`overflow-x-auto focus:outline focus:outline-focus ${className}`}
    >
      {children}
    </div>
  );
}
