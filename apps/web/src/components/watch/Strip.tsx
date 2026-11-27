import { tickerSummary, toFixedHalfUp } from '@marsad/core';
import { Info } from '../Info';
import { dayMonth } from '../../lib/dates';
import { STRIP_BARS, STRIP_SERIES, type WatchData } from '../../lib/watch';
import { Change, v, w } from './shared';

interface StripItem {
  key: string;
  value: string | null;
  change: number | null;
  /** The 10-year yield moves in percentage points, not percent. */
  pts: number | null;
  date: string | undefined;
}

function items(data: WatchData): StripItem[] {
  return [
    ...STRIP_BARS.map((tk) => {
      const s = tickerSummary(data.bars[tk] ?? []);
      return {
        key: tk,
        value: s ? toFixedHalfUp(s.close, 2) : null,
        change: s?.change1d ?? null,
        pts: null,
        date: s?.date,
      };
    }),
    ...STRIP_SERIES.map((id) => {
      const o = data.series[id] ?? [];
      const last = o.at(-1);
      const prev = o.at(-2);
      const isRate = id === 'DGS10';
      return {
        key: id,
        value: last ? `${toFixedHalfUp(last.value, 2)}${isRate ? '%' : ''}` : null,
        change: !isRate && last && prev && prev.value !== 0 ? last.value / prev.value - 1 : null,
        pts: isRate && last && prev ? Number(toFixedHalfUp(last.value - prev.value, 2)) : null,
        date: last?.date,
      };
    }),
  ];
}

function Delta({ x }: { x: StripItem }) {
  const d = x.pts ?? x.change;
  if (d === null) return <span className="text-xs text-ink3">{v.noData}</span>;
  const tint = d > 0 ? 'bg-up-soft' : d < 0 ? 'bg-down-soft' : 'bg-sub';
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-px text-xs font-medium whitespace-nowrap ${tint}`}
    >
      {x.pts !== null ? (
        <span
          dir="ltr"
          className={`[unicode-bidi:isolate] tabular-nums ${d > 0 ? 'text-up' : d < 0 ? 'text-down' : ''}`}
        >
          <span aria-hidden="true">{d > 0 ? '▲ ' : d < 0 ? '▼ ' : ''}</span>
          {w.strip.points(`${d > 0 ? '+' : d < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(d), 2)}`)}
        </span>
      ) : (
        <Change v={x.change} />
      )}
    </span>
  );
}

/** Nine market tiles, each with its own data date (ETFs from Massive daily bars, the rest from FRED). */
export function Strip({ data }: { data: WatchData }) {
  return (
    <section aria-labelledby="strip-h" className="flex flex-col gap-2">
      <h2 id="strip-h" className="sr-only">
        {w.strip.title}
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,120px),1fr))] gap-2.5">
        {items(data).map((x) => {
          const name = w.strip.names[x.key] ?? x.key;
          return (
            <li
              key={x.key}
              aria-label={w.strip.aria(name, x.value ?? v.noData)}
              className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-3"
            >
              <span className="truncate text-xs font-semibold text-ink">{name}</span>
              <span
                dir="ltr"
                className={`text-start font-semibold tabular-nums [unicode-bidi:plaintext] ${
                  x.value === null ? 'text-sm text-ink3' : 'text-lg text-ink'
                }`}
              >
                {x.value ?? v.noData}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-1">
                {x.value !== null && <Delta x={x} />}
                {x.date && (
                  <span className="text-[11px] whitespace-nowrap text-ink3">
                    {dayMonth(x.date)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Info>
        <p>{w.strip.source}</p>
        <p>{w.endOfDay}</p>
      </Info>
    </section>
  );
}
