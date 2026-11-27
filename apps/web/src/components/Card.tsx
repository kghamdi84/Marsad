import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../strings';

/** v2 cards: 12 px radius, 16 by 18 px padding, 12 px gap, one line border, no shadow. */
export const cardClass =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-[18px] py-4';

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
          <h2 id={id} className="text-base font-semibold text-ink">
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
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-line bg-elev p-3">
      <span className="text-xs text-ink3">{label}</span>
      <span className="text-lg font-semibold text-ink tabular-nums">{value}</span>
      {note && <span className="text-xs text-ink3">{note}</span>}
    </div>
  );
}

/** A segmented control: one choice of a few, each a 44-point button with its pressed state announced. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  stretch = false,
}: {
  label: string;
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  /** Fill the width with equal segments (phones). */
  stretch?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${stretch ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex flex-wrap'} gap-0.5 rounded-[10px] border border-line bg-elev p-[3px]`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`min-h-10 min-w-10 rounded-[7px] px-3 text-[13px] font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
            o.key === value ? 'bg-accent text-accent-ink' : 'text-ink3 hover:text-ink'
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

/** Pulsing placeholder cards while a page's data first loads; the text says Loading for screen readers. */
export function SkeletonCards({ heights = ['7rem', '11rem', '16rem'] }: { heights?: string[] }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t.loading}</span>
      {heights.map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{ height: h }}
          className="flex animate-pulse flex-col gap-2.5 rounded-2xl bg-surface p-4 motion-reduce:animate-none tablet:rounded-xl"
        >
          <span className="h-3 w-2/5 rounded-md bg-muted/15" />
          <span className="h-5 w-3/5 rounded-md bg-muted/10" />
        </div>
      ))}
    </div>
  );
}

/** True at 760 px and wider (the tablet and desktop layout); follows rotation and window resizes. */
export function useWide(): boolean {
  const query = '(min-width: 47.5rem)';
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A choice remembered in this browser only; storage can be missing or blocked, so every access is guarded. */
export function useRemembered<K extends string>(key: string, allowed: readonly K[], fallback: K) {
  const [v, setV] = useState<K>(() => {
    try {
      const s = localStorage.getItem(key);
      return s && (allowed as readonly string[]).includes(s) ? (s as K) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (k: K) => {
    setV(k);
    try {
      localStorage.setItem(key, k);
    } catch {
      // Not remembered; the choice still applies to this visit.
    }
  };
  return [v, set] as const;
}

/** Accessible tabs: one panel at a time, arrow keys move between tabs, the tab row scrolls on narrow screens. */
export function Tabs<K extends string>({
  label,
  idPrefix,
  options,
  value,
  onChange,
  children,
  pill = false,
}: {
  label: string;
  idPrefix: string;
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  children: ReactNode;
  /** The design's phone tab bar: a rounded track (3 px padding, surface) with the selected tab on raised. */
  pill?: boolean;
}) {
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.key === value);
    const next = options[(i + dir + options.length) % options.length];
    if (!next) return;
    onChange(next.key);
    document.getElementById(`${idPrefix}-tab-${next.key}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        className={
          pill
            ? 'flex overflow-x-auto rounded-xl bg-surface p-[3px] [scrollbar-width:none]'
            : 'flex flex-wrap gap-1.5 border-b border-line pb-3'
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move(1);
          if (e.key === 'ArrowLeft') move(-1);
        }}
      >
        {options.map((o) => (
          <button
            key={o.key}
            id={`${idPrefix}-tab-${o.key}`}
            type="button"
            role="tab"
            aria-selected={o.key === value}
            aria-controls={`${idPrefix}-panel-${o.key}`}
            tabIndex={o.key === value ? 0 : -1}
            onClick={() => onChange(o.key)}
            className={
              pill
                ? `min-h-11 flex-[1_0_auto] rounded-[9px] px-2.5 text-[0.8125rem] font-semibold whitespace-nowrap ${
                    o.key === value ? 'bg-accent text-accent-ink' : 'text-ink3'
                  }`
                : `min-h-10 flex-none rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
                    o.key === value ? 'bg-accent text-accent-ink' : 'text-ink3 hover:text-ink'
                  }`
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <div
        id={`${idPrefix}-panel-${value}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${value}`}
        className="flex flex-col gap-4"
      >
        {children}
      </div>
    </div>
  );
}
