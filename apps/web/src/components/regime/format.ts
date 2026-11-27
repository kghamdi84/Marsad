/**
 * Number text for the Regime page: half-up rounding (core `toFixedHalfUp`), thousands separators and the U+2212
 * minus sign (README direction rule). A value that rounds to zero carries no sign.
 */
import { toFixedHalfUp } from '@marsad/core';

const MINUS = '−';

const nonZero = (s: string) => /[1-9]/.test(s);

/** "6,612.80", "−0.51". */
export function fixed(v: number, d = 2): string {
  const [whole, frac] = toFixedHalfUp(Math.abs(v), d).split('.');
  const s = `${(whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
  return v < 0 && nonZero(s) ? `${MINUS}${s}` : s;
}

/** "+0.48", "−0.51", "0.00". */
export function signedFixed(v: number, d = 2): string {
  const s = fixed(Math.abs(v), d);
  if (!nonZero(s)) return s;
  return `${v > 0 ? '+' : MINUS}${s}`;
}

/** A fraction as a signed percentage: 0.013 as "+1.3%". */
export const pct = (v: number, d = 1) => `${signedFixed(v * 100, d)}%`;

/** A fraction as a signed percentage with the direction arrow: "▲ +2.4%", "▼ −2.1%" (colour is never alone). */
export function arrowPct(v: number, d = 1): string {
  const s = pct(v, d);
  if (!nonZero(s)) return s;
  return `${v > 0 ? '▲' : '▼'} ${s}`;
}

/** Text tone for a signed value: blue up, orange down, neutral at zero. */
export const toneClass = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink2');

/** A fraction from 0 to 1 as a CSS percentage. */
export const width = (v: number) => `${toFixedHalfUp(Math.min(1, Math.max(0, v)) * 100, 1)}%`;

/** Regime colours from the theme tokens: each label also has its name beside it, so colour is never alone. */
export const LABEL_COLOR: Record<string, string> = {
  stress: 'var(--color-crit)',
  bear: 'var(--color-down)',
  recovery: 'var(--color-warn)',
  'bull-correction': 'var(--color-ink3)',
  'bull-calm': 'var(--color-up)',
  'insufficient-data': 'var(--color-sub)',
};

export const LABEL_ORDER = ['stress', 'bear', 'recovery', 'bull-correction', 'bull-calm'];

/** Event study horizons in sessions: 1, 3 and 6 months. */
export const HORIZONS = [21, 63, 126];
