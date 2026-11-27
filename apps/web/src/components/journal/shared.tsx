/**
 * Formatting and small pieces the Journal panels share: money as the design writes it, the v2 stat tile, and the
 * per-holding inputs the exposure report, the KPI strip and the rotation flag all take.
 */
import type { ReactNode } from 'react';
import { beta, rotationSignal, toFixedHalfUp, vixSensitivity, type DatedValue } from '@marsad/core';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';

export const money = (v: number) => toFixedHalfUp(v, 2);
export const share = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
/** Whole dollars with thousands separators, as the design writes money ("$97,887"). */
export const usd0 = (v: number) =>
  Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
/** "▲ +$9,258" or "▼ −$408": sign, arrow and colour together (colour is never the only signal). */
export const signedUsd = (v: number) => `${v >= 0 ? '▲ +' : '▼ −'}$${usd0(v)}`;
/** "+20.6%" or "−3.4%" from a fraction. */
export const signedPct1 = (v: number) =>
  `${v >= 0 ? '+' : '−'}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;
/** A target as stored: whole numbers without decimals ("205"), others with two ("27.50"). */
export const level = (v: number) => (Number.isInteger(v) ? String(v) : money(v));
export const toneOf = (v: number | null) =>
  v === null ? 'text-ink3' : v >= 0 ? 'text-up' : 'text-down';

/** The design's v2 stat tile: label, an 18 px value and a sub line, on the elevated surface. */
export function StatTile({
  label,
  value,
  sub,
  tone = 'text-ink',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-line bg-elev p-3">
      <span className="text-xs text-ink3">{label}</span>
      <span className={`text-lg font-semibold whitespace-nowrap tabular-nums ${tone}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-ink2">{sub}</span>}
    </div>
  );
}

/** The v2 card heading row: a 16 px title with an optional aside on the end side. */
export function CardHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={id} className="text-base font-semibold text-ink">
        {title}
      </h2>
      {aside}
    </div>
  );
}

/** A label and value row with a top rule and an optional note under it (the design's list rows). */
export function LineRow({
  k,
  v,
  note,
  tone = 'text-ink',
}: {
  k: ReactNode;
  v: ReactNode;
  note?: ReactNode;
  tone?: string;
}) {
  return (
    <>
      <span className="text-sm text-ink2">{k}</span>
      <span className={`text-end text-sm font-semibold whitespace-nowrap tabular-nums ${tone}`}>
        {v}
      </span>
      {note && <span className="col-span-2 text-xs text-ink3">{note}</span>}
    </>
  );
}
export const lineRowClass =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-line py-2.5';

/** Each priced holding with its betas, as the exposure report and the KPI tiles both take them. */
export function positionsOf(holdings: StoredHolding[], bars: BarsByTicker, vix: DatedValue[]) {
  const spy = bars['SPY'] ?? [];
  return holdings.flatMap((h) => {
    const b = bars[h.ticker] ?? [];
    const last = b.at(-1);
    if (!last) return [];
    const sector = h.sectorEtf ? (bars[h.sectorEtf] ?? []) : [];
    return [
      {
        ticker: h.ticker,
        shares: h.shares,
        price: last.close,
        sectorEtf: h.sectorEtf,
        beta: beta(b, spy)?.slope ?? null,
        vixSensitivity: vixSensitivity(b, vix)?.slope ?? null,
        sectorBeta: h.sectorEtf ? (beta(b, sector)?.slope ?? null) : null,
      },
    ];
  });
}

/** The rotation signal for one holding; the design shows it as a "Rotate to XLK?" flag on the card. */
export function rotationOf(h: StoredHolding, all: BarsByTicker) {
  return rotationSignal({
    ticker: h.ticker,
    bars: all[h.ticker] ?? [],
    spy: all['SPY'] ?? [],
    sectorEtf: h.sectorEtf,
    sectorBars: h.sectorEtf ? (all[h.sectorEtf] ?? null) : null,
    thesis: h.thesisStatus,
  });
}

/** Newest close date across the holdings (the "close of 25 Nov" the KPI strip shows). */
export function newestClose(holdings: StoredHolding[], bars: BarsByTicker): string {
  return holdings
    .map((h) => bars[h.ticker]?.at(-1)?.date ?? '')
    .reduce((a, b) => (b > a ? b : a), '');
}
