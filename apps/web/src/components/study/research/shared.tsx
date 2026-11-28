import type { ReactNode } from 'react';
import { etDate, toFixedHalfUp } from '@marsad/core';
import { dayMonthYear } from '../../../lib/dates';
import { t } from '../../../strings';
import { Num } from '../../ui/kit';
import { panelTitle, tileClass } from '../Panel';

export const R = t.study.research;

/** "$1,234.56", "−$3.10". */
export const money = (v: number, d = 2) =>
  `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
/** "12.3%" with a minus sign for negatives. */
export const pctText = (v: number, d = 1) => `${v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v), d)}%`;
/** "+12.3%", "−4.0%", "0.0%". */
export const signedPctText = (v: number, d = 1) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(v), d)}%`;
/** A plain number with separators. */
export const plain = (v: number, d = 2) =>
  `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;

/** An instant (ISO with a zone) as its ET calendar date, "28 Nov 2026". */
export const etDay = (iso: string) => dayMonthYear(etDate(new Date(iso)));

/** A signed change with its arrow; blue up, orange down; colour is never the only signal. */
export function Signed({ pct, d = 1 }: { pct: number; d?: number }) {
  const tone = pct > 0 ? 'text-up' : pct < 0 ? 'text-down' : 'text-ink2';
  return (
    <Num className={`font-semibold ${tone}`}>
      <span aria-hidden="true">{pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}</span>
      {signedPctText(pct, d)}
    </Num>
  );
}

/** Why a research part is missing, in words. */
export function reasonText(reason: string): string {
  if (reason.startsWith('malformed'))
    return R.reasons.malformed(reason.replace(/^malformed:?\s*/, ''));
  return R.reasons.codes[reason] ?? R.reasons.other(reason);
}

export function Unavailable({ reason, what }: { reason?: string | null; what?: string }) {
  return (
    <p className="text-sm text-ink3">
      {what ? `${what}: ` : ''}
      {R.na}
      {reason ? ` (${reasonText(reason)})` : ''}
    </p>
  );
}

export function SourceLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-ink3">
      <Num>{children}</Num>
    </p>
  );
}

/** A titled tile inside the research area. */
export function Tile({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={tileClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className={panelTitle}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Buttons for one choice of several where some may be disabled, each with its reason below. */
export function Choice<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: K; label: string; disabled?: string | null }[];
  value: K;
  onChange: (k: K) => void;
}) {
  const off = options.filter((o) => o.disabled);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={label}
        className="inline-flex flex-wrap gap-0.5 self-start rounded-[10px] border border-line bg-elev p-[3px]"
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={o.key === value}
            disabled={!!o.disabled}
            title={o.disabled ?? undefined}
            onClick={() => onChange(o.key)}
            className={`min-h-10 min-w-10 rounded-[7px] px-3 text-[13px] font-semibold whitespace-nowrap pointer-coarse:min-h-11 disabled:cursor-not-allowed disabled:line-through ${
              o.key === value ? 'bg-accent text-accent-ink' : 'text-ink3 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {off.length > 0 && (
        <p className="text-xs text-ink3">
          <Num>{off.map((o) => `${o.label}: ${o.disabled}`).join(' · ')}</Num>
        </p>
      )}
    </div>
  );
}

/** A folded block with its own label: long tables and texts one tap away. */
export function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-line">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-ink2 select-none">
        {label}
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">{children}</div>
    </details>
  );
}

/** Saves text as a file in the browser (no network). */
export function saveText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const th = 'border-b border-line px-2 py-1.5 text-start text-xs font-medium text-ink3';
export const thEnd = 'border-b border-line px-2 py-1.5 text-end text-xs font-medium text-ink3';
export const td = 'border-b border-line px-2 py-1.5 align-top text-sm';
export const tdEnd = 'border-b border-line px-2 py-1.5 text-end align-top text-sm tabular-nums';
