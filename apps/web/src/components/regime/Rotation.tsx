import { useMemo } from 'react';
import {
  SECTOR_ETFS,
  sectorRotation,
  type SectorRotation,
  type SectorRotationRow,
} from '@marsad/core';
import { Info } from '../Info';
import { Card } from '../Card';
import { arrowPct, toneClass } from './format';
import { dayMonth } from '../../lib/dates';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const o = r.rotation;

const cell = 'border-t border-line py-2 text-xs tablet:text-[13px]';

function Value({ v }: { v: number | null }) {
  return (
    <td className={`${cell} ps-1.5 text-end whitespace-nowrap tabular-nums`}>
      {v === null ? (
        <span className="text-ink3">{o.na}</span>
      ) : (
        <span dir="ltr" className={`[unicode-bidi:isolate] ${toneClass(v)}`}>
          {arrowPct(v)}
        </span>
      )}
    </td>
  );
}

/**
 * The rotation from the stored closes, rows best 1-month first (the card and the summary row read the same rows).
 */
export function useRotation(data: RegimeData): { rot: SectorRotation; rows: SectorRotationRow[] } {
  return useMemo(() => {
    const rot = sectorRotation(
      SECTOR_ETFS.map((s) => ({ ticker: s.ticker, bars: data.sectorBars[s.ticker] ?? [] })),
      data.sectorBars['SPY'] ?? [],
    );
    const rows = [...rot.rows].sort(
      (a, b) => (b.m1 ?? -Infinity) - (a.m1 ?? -Infinity) || a.ticker.localeCompare(b.ticker),
    );
    return { rot, rows };
  }, [data.sectorBars]);
}

/**
 * Sector rotation against SPY (`sector-rotation-1`): each sector fund's relative return over 1 week, 1 month and
 * 3 months from the stored daily closes, best 1-month first. A fund whose newest bar is not SPY's is stale.
 */
export function Rotation({ data }: { data: RegimeData }) {
  const { rot, rows } = useRotation(data);
  const note = (x: SectorRotationRow) =>
    x.state === 'stale' && x.asOf ? o.stale(x.asOf) : x.state === 'no-data' ? o.noBars : null;
  return (
    <Card
      id="rotation"
      title={o.title}
      aside={
        <span className="text-xs text-ink3">
          {rot.asOf ? o.source(dayMonth(rot.asOf)) : o.sourceNone}
        </span>
      }
    >
      {rot.asOf === null ? (
        <p className="text-sm text-ink3">{o.none}</p>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{o.caption(rot.asOf)}</caption>
          <colgroup>
            <col className="w-[38%]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="text-xs text-ink3">
              <th scope="col" className="pb-1.5 text-start font-normal">
                {o.colSector}
              </th>
              <th scope="col" className="pb-1.5 text-end font-normal">
                {o.w1}
              </th>
              <th scope="col" className="pb-1.5 text-end font-normal">
                {o.m1}
              </th>
              <th scope="col" className="pb-1.5 text-end font-normal">
                {o.m3}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.ticker}>
                <th scope="row" className={`${cell} text-start font-normal text-ink`}>
                  <span className="block truncate">{`${x.ticker} · ${o.names[x.ticker] ?? x.ticker}`}</span>
                  {note(x) && <span className="block text-xs text-warn">{note(x)}</span>}
                </th>
                <Value v={x.w1} />
                <Value v={x.m1} />
                <Value v={x.m3} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Info>{o.info}</Info>
    </Card>
  );
}
