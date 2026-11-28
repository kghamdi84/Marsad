import { currentMix, type DailyBar, type MixSeries } from '@marsad/core';
import { Segmented, useRemembered } from '../Card';
import { arrowPct, longDate, p, Source, tone } from './shared';

const RANGES = ['d60', 'm1', 'm3', 'm6', 'y1'] as const;
type Range = (typeof RANGES)[number];
const SESSIONS: Record<Range, number> = { d60: 60, m1: 21, m3: 63, m6: 126, y1: 252 };

const W = 600;
const H = 180;
const PAD = 8;

function path(values: readonly number[], lo: number, hi: number): string {
  const span = hi - lo || 1;
  return values
    .map((v, i) => {
      const x = PAD + (i / Math.max(1, values.length - 1)) * (W - 2 * PAD);
      const y = PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** The two lines and the zero line; the figure's name carries both end values for assistive technology. */
function Lines({ mix }: { mix: MixSeries }) {
  const port = mix.points.map((x) => x.portfolio);
  const spy = mix.points.map((x) => x.spy);
  const lo = Math.min(0, ...port, ...spy);
  const hi = Math.max(0, ...port, ...spy);
  const zeroY = PAD + (1 - (0 - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const endP = port.at(-1) ?? 0;
  const endS = spy.at(-1) ?? 0;
  return (
    <svg
      role="img"
      aria-label={p.mix.aria(arrowPct(endP), arrowPct(endS), longDate(mix.from), longDate(mix.to))}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-44 w-full"
    >
      <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} className="stroke-line" strokeWidth={1} />
      <path
        d={path(spy, lo, hi)}
        fill="none"
        className="stroke-ink3"
        strokeWidth={1.5}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path(port, lo, hi)}
        fill="none"
        className="stroke-accent"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * "Portfolio vs SPY": today's shares of each holding valued at past closes, against SPY, over a chosen span. The
 * label says plainly that this is not the account's history.
 */
export function MixChart({
  holdings,
  bars,
  storageKey,
  fallback,
}: {
  holdings: readonly { ticker: string; shares: number }[];
  bars: Readonly<Record<string, readonly DailyBar[]>>;
  storageKey: string;
  fallback: Range;
}) {
  const [range, setRange] = useRemembered<Range>(storageKey, RANGES, fallback);
  const mix = currentMix(holdings, bars, SESSIONS[range]);
  const endP = mix?.points.at(-1)?.portfolio ?? null;
  const endS = mix?.points.at(-1)?.spy ?? null;
  return (
    <figure aria-labelledby={`${storageKey}-cap`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id={`${storageKey}-cap`} className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{p.mix.title}</span>
          <span className="text-xs text-ink3">{p.mix.label}</span>
        </figcaption>
        <Segmented
          label={p.mix.rangeLabel}
          options={RANGES.map((k) => ({ key: k, label: p.mix.ranges[k] }))}
          value={range}
          onChange={setRange}
        />
      </div>
      {mix ? (
        <>
          <Lines mix={mix} />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
            <span>
              <span
                aria-hidden="true"
                className="me-1 inline-block h-0.5 w-4 bg-accent align-middle"
              />
              {p.mix.portfolio}{' '}
              <span className={`font-semibold tabular-nums ${tone(endP)}`}>
                {endP === null ? p.na : arrowPct(endP)}
              </span>
            </span>
            <span>
              <span
                aria-hidden="true"
                className="me-1 inline-block w-4 border-t-2 border-dashed border-ink3 align-middle"
              />
              {p.mix.spy}{' '}
              <span className={`font-semibold tabular-nums ${tone(endS)}`}>
                {endS === null ? p.na : arrowPct(endS)}
              </span>
            </span>
          </p>
          <Source>
            {p.mix.span(mix.sessions, longDate(mix.from), longDate(mix.to))}
            {mix.sessions < SESSIONS[range] && ` ${p.mix.shorter(SESSIONS[range])}`}
            {mix.leftOut.length > 0 && ` ${p.mix.leftOut(mix.leftOut.join(', '))}`}
          </Source>
        </>
      ) : (
        <p className="text-sm text-ink3">{p.mix.none}</p>
      )}
    </figure>
  );
}
