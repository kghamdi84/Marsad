import { useState } from 'react';
import { tickerSummary, toFixedHalfUp } from '@marsad/core';
import { Card, Segmented } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { num } from '../study/Panel';
import { dayMonth } from '../../lib/dates';
import { STRIP_BARS, type WatchData } from '../../lib/watch';
import { Aside, Change, u, w } from './shared';

/** The 11 Select Sector SPDRs, tinted by direction (the sign and arrow carry it too). */
export function SectorsCard({ data }: { data: WatchData }) {
  const m = data.movers;
  return (
    <Card
      id="sectors-h"
      title={w.sectors.title}
      aside={m ? <Aside>{w.sectors.aside(m.sectors.length, dayMonth(m.date))}</Aside> : undefined}
    >
      {!m ? (
        <p className="text-sm text-ink3">{w.sectors.none}</p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,128px),1fr))] gap-2">
            {m.sectors.map((x) => (
              <li
                key={x.ticker}
                className={`flex min-w-0 flex-col gap-0.5 rounded-lg border border-line p-2.5 ${
                  x.change === null || x.change === 0
                    ? 'bg-sub'
                    : x.change > 0
                      ? 'bg-up-soft'
                      : 'bg-down-soft'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                  <span className="text-ink">{x.ticker}</span>
                  <span className="whitespace-nowrap">
                    <Change v={x.change} digits={2} />
                  </span>
                </span>
                <span className="truncate text-xs text-ink2">{x.sector}</span>
              </li>
            ))}
          </ul>
          <Info>
            <p>{w.sectors.asOf(m.date)}</p>
            <p>{w.sectors.source}</p>
          </Info>
        </>
      )}
    </Card>
  );
}

type MoverList = NonNullable<WatchData['movers']>['gainers'];

const moverMax = (m: NonNullable<WatchData['movers']>) =>
  Math.max(1e-9, ...[...m.gainers, ...m.losers].map((x) => Math.abs(x.change)));

function MoverRows({ xs, max }: { xs: MoverList; max: number }) {
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {xs.map((x) => (
          <tr key={x.ticker}>
            <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-ink">
              <TickerLink ticker={x.ticker} />
            </td>
            <td className="py-1.5 align-middle">
              <span aria-hidden="true" className="block h-2 rounded-full bg-sub">
                <span
                  className={`block h-full rounded-full ${x.change > 0 ? 'bg-up' : 'bg-down'}`}
                  style={{ width: `${toFixedHalfUp((Math.abs(x.change) / max) * 100, 1)}%` }}
                />
              </span>
              <span className="text-[11px] text-ink3">
                {toFixedHalfUp(x.close, 2)} {'·'}{' '}
                {w.movers.dollarVolume(
                  Math.round(x.dollarVolume / 1e6).toLocaleString('en-US') + ' million',
                )}
              </span>
            </td>
            <td className={`w-20 py-1.5 ps-2 align-middle font-semibold ${num}`}>
              <Change v={x.change} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MoversCard({ data }: { data: WatchData }) {
  const m = data.movers;
  return (
    <Card
      id="movers-h"
      title={w.movers.title}
      subtitle={m ? w.movers.asOf(m.date, m.n) : undefined}
    >
      {!m ? (
        <p className="text-sm text-ink3">{w.movers.none}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[[w.movers.gainers, m.gainers] as const, [w.movers.losers, m.losers] as const].map(
            ([title, xs]) => (
              <div key={title} className="flex flex-col gap-1">
                <h3 className="text-[13px] font-semibold text-ink3">{title}</h3>
                <MoverRows xs={xs} max={moverMax(m)} />
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

const GAP_ROWS = 10;

interface GapRow {
  tk: string;
  gap: number;
  day: number | null;
  date: string;
}

function gapRows(data: WatchData): GapRow[] {
  return [...new Set([...data.tickers, ...STRIP_BARS])]
    .flatMap((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return s && s.gap !== null ? [{ tk, gap: s.gap, day: s.change1d, date: s.date }] : [];
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, GAP_ROWS);
}

const fmtPct = (x: number) =>
  `${x > 0 ? '+' : x < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(x) * 100, 1)}%`;

function GapRows({ rows }: { rows: GapRow[] }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.gap)));
  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {rows.map((x) => {
          // What the close kept: the day's change in the gap's direction, capped at the gap.
          const kept =
            x.day === null || Math.sign(x.day) !== Math.sign(x.gap)
              ? 0
              : Math.min(Math.abs(x.day), Math.abs(x.gap));
          const bg = x.gap > 0 ? 'bg-up' : 'bg-down';
          return (
            <tr key={x.tk}>
              <td className="w-14 py-1.5 pe-2 align-middle font-semibold text-ink">
                <TickerLink ticker={x.tk} />
              </td>
              <td className="py-1.5 align-middle">
                <span aria-hidden="true" className="relative block h-2 rounded-full bg-sub">
                  <span
                    className={`absolute inset-y-0 start-0 rounded-full opacity-45 ${bg}`}
                    style={{ width: `${toFixedHalfUp((Math.abs(x.gap) / max) * 100, 1)}%` }}
                  />
                  <span
                    className={`absolute inset-y-0 start-0 rounded-full ${bg}`}
                    style={{ width: `${toFixedHalfUp((kept / max) * 100, 1)}%` }}
                  />
                </span>
                <span className="text-[11px] text-ink3">
                  {x.date}
                  {x.day !== null && (
                    <>
                      {' '}
                      {'·'} {u.dayChange(fmtPct(x.day))}
                    </>
                  )}
                </span>
              </td>
              <td className={`w-20 py-1.5 ps-2 align-middle font-semibold ${num}`}>
                <Change v={x.gap} digits={2} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function GapsCard({ data }: { data: WatchData }) {
  const rows = gapRows(data);
  return (
    <Card id="gaps-h" title={w.gaps.title} subtitle={w.gaps.intro}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink3">{w.gaps.none}</p>
      ) : (
        <>
          <GapRows rows={rows} />
          <p className="text-xs text-ink3">{u.gapLegend}</p>
        </>
      )}
    </Card>
  );
}

type MgTab = 'up' | 'down' | 'gaps';

/** Phones: movers and gaps share one card, switched with a segmented control. */
export function MoversGapsPhone({ data }: { data: WatchData }) {
  const [tab, setTab] = useState<MgTab>('up');
  const m = data.movers;
  const gaps = gapRows(data);
  return (
    <Card id="movers-gaps-h" title={u.moversGaps}>
      <Segmented
        label={u.moversGaps}
        options={[
          { key: 'up', label: u.tabUp },
          { key: 'down', label: u.tabDown },
          { key: 'gaps', label: u.tabGaps },
        ]}
        value={tab}
        onChange={setTab}
        stretch
      />
      {tab === 'gaps' ? (
        gaps.length === 0 ? (
          <p className="text-sm text-ink3">{w.gaps.none}</p>
        ) : (
          <>
            <GapRows rows={gaps} />
            <Info>{w.gaps.intro}</Info>
            <p className="text-xs text-ink3">{u.gapLegend}</p>
          </>
        )
      ) : !m ? (
        <p className="text-sm text-ink3">{w.movers.none}</p>
      ) : (
        <>
          <MoverRows xs={tab === 'up' ? m.gainers : m.losers} max={moverMax(m)} />
          <p className="text-xs text-ink3">{w.movers.asOf(m.date, m.n)}</p>
        </>
      )}
    </Card>
  );
}
