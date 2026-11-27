import { useEffect, useState, type ReactNode } from 'react';
import { toFixedHalfUp } from '@marsad/core';
import { t } from '../../strings';

export const w = t.watch;
export const u = w.ui;
export const v = w.v2;

/** The time now, refreshed every `ms` (countdowns, "since the last close"). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export const toneText = (x: number | null) =>
  x === null || x === 0 ? 'text-ink3' : x > 0 ? 'text-up' : 'text-down';

/** A fraction as a signed percentage with its arrow: "▲ +2.84%", "▼ −3.21%" (U+2212). Rounded half up. */
export function pctText(x: number, digits = 1): string {
  const p = toFixedHalfUp(x * 100, digits);
  const n = Number(p);
  return n > 0 ? `▲ +${p}%` : n < 0 ? `▼ −${p.slice(1)}%` : `${p}%`;
}

/** A change as text with its sign and an arrow, blue up and orange down (never colour alone). */
export function Change({
  v: x,
  digits = 1,
  plain = false,
}: {
  v: number | null;
  digits?: number;
  /** Inherit the text colour (on a tinted tile the tint carries the colour). */
  plain?: boolean;
}) {
  if (x === null) return <span className="text-ink3">{v.noData}</span>;
  const p = toFixedHalfUp(x * 100, digits);
  const up = Number(p) > 0;
  const down = Number(p) < 0;
  return (
    <span
      dir="ltr"
      className={`[unicode-bidi:isolate] tabular-nums ${plain ? '' : up ? 'text-up' : down ? 'text-down' : ''}`}
    >
      <span aria-hidden="true">{up ? '▲ ' : down ? '▼ ' : ''}</span>
      {up ? '+' : down ? '−' : ''}
      {down ? p.slice(1) : p}%
    </span>
  );
}

/** A change in a soft pill (999 px radius), as the design draws it. */
export function ChangePill({ v: x, digits = 1 }: { v: number | null; digits?: number }) {
  if (x === null) return <span className="text-xs text-ink3">{v.noData}</span>;
  const tint = x > 0 ? 'bg-up-soft' : x < 0 ? 'bg-down-soft' : 'bg-sub';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tint}`}
    >
      <Change v={x} digits={digits} />
    </span>
  );
}

export function Failure({ message }: { message: string }) {
  return (
    <p role="alert" className="text-down">
      {message}
    </p>
  );
}

/** A card's end-side note (12 px, ink3), as in the design's card headers. */
export function Aside({ children }: { children: ReactNode }) {
  return <span className="text-xs text-ink3">{children}</span>;
}
