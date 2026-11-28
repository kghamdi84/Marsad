import { lazy, Suspense, useMemo, useState } from 'react';
import {
  LEVELS_VERSION,
  priceLevels,
  resampleBars,
  type ChartMarker,
  type DailyBar,
  type TauricAnalyst,
  type Timeframe,
} from '@marsad/core';
import { SkeletonCards, Segmented, useWide } from '../../Card';
import type { ChartToggles, PriceLine } from '../../PriceChart';
import { Num } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { Choice, R, SourceLine, Tile, money, signedPctText } from './shared';

const PriceChart = lazy(() => import('../../PriceChart'));

const RANGES = ['1m', '3m', '6m', 'ytd', '1y', '5y', 'all'] as const;
type Range = (typeof RANGES)[number];
const SESSIONS: Partial<Record<Range, number>> = { '1m': 21, '3m': 63, '6m': 126, '1y': 252, '5y': 1260 };
const TIMEFRAMES = ['daily', 'weekly', 'monthly'] as const;
const OVERLAYS = ['results', 'filings', 'dividend', 'split', 'insider', 'halt', 'alert'] as const;
type Overlay = (typeof OVERLAYS)[number];
const INDICATORS = ['sma50', 'sma200', 'ema20', 'rsi', 'volume', 'bollinger'] as const;
type Indicator = (typeof INDICATORS)[number];

const overlayOf = (m: ChartMarker): Overlay =>
  m.results
    ? 'results'
    : m.kind === 'high-8k' || m.kind === 'medium-8k'
      ? 'filings'
      : m.kind === 'insider-buy'
        ? 'insider'
        : (m.kind as Overlay);

/**
 * The advanced chart: the Study price chart over a chosen range and candle size (weekly and monthly resampled
 * from daily bars), with indicators, event markers, analyst targets and support and resistance levels.
 */
export function AdvancedChartView({
  ticker,
  bars,
  markers,
  analyst,
}: {
  ticker: string;
  bars: readonly DailyBar[];
  markers: readonly ChartMarker[];
  analyst: Part<TauricAnalyst>;
}) {
  const x = R.chart;
  const wide = useWide();
  const [range, setRange] = useState<Range>('1y');
  const [tf, setTf] = useState<Timeframe>('daily');
  const [ind, setInd] = useState<Record<Indicator, boolean>>({
    sma50: true,
    sma200: true,
    ema20: false,
    rsi: false,
    volume: true,
    bollinger: false,
  });
  const [ov, setOv] = useState<Record<Overlay, boolean>>({
    results: true,
    filings: true,
    dividend: true,
    split: true,
    insider: true,
    halt: true,
    alert: true,
  });
  const [targets, setTargets] = useState(true);
  const [showLevels, setShowLevels] = useState(false);

  const last = bars.at(-1);
  const startOf = (r: Range): string | null => {
    if (!last) return null;
    if (r === 'all') return bars[0]?.date ?? null;
    if (r === 'ytd') return bars.find((b) => b.date >= `${last.date.slice(0, 4)}-01-01`)?.date ?? null;
    const n = SESSIONS[r] as number;
    return bars.length > n ? (bars[bars.length - 1 - n] as DailyBar).date : null;
  };
  const shown = useMemo(() => resampleBars(bars, tf), [bars, tf]);
  const start = startOf(range);
  const visible = start ? shown.filter((b) => b.date >= start).length : shown.length;
  // A marker sits on the candle whose period holds its day (each candle is dated by its last session).
  const placed = useMemo(() => {
    const dates = shown.map((b) => b.date);
    return markers
      .filter((m) => ov[overlayOf(m)])
      .flatMap((m) => {
        const d = tf === 'daily' ? m.date : dates.find((dd) => dd >= m.date);
        return d ? [{ ...m, date: d }] : [];
      });
  }, [markers, ov, shown, tf]);
  const levels = useMemo(() => priceLevels(bars), [bars]);
  const a = analyst.ok ? analyst.value : null;
  const lines: PriceLine[] = useMemo(() => {
    const out: PriceLine[] = [];
    if (targets && a) {
      if (a.target_high_price !== null)
        out.push({ price: a.target_high_price, title: x.targetHigh, tone: 'up', style: 'dashed' });
      if (a.target_mean_price !== null)
        out.push({ price: a.target_mean_price, title: x.targetMean, tone: 'ink', style: 'dashed' });
      if (a.target_low_price !== null)
        out.push({ price: a.target_low_price, title: x.targetLow, tone: 'down', style: 'dashed' });
    }
    if (showLevels)
      for (const l of levels.levels)
        out.push({
          price: l.price,
          title: l.kind === 'support' ? x.support : x.resistance,
          tone: 'muted',
          style: 'dotted',
        });
    return out;
  }, [targets, a, showLevels, levels, x]);
  const toggles: ChartToggles = {
    sma50: ind.sma50,
    sma200: ind.sma200,
    ema20: ind.ema20,
    rsi: ind.rsi,
    volume: ind.volume,
  };
  const chip = (pressed: boolean, label: string, on: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={pressed}
      onClick={on}
      className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
        pressed ? 'border-line-strong bg-elev text-ink' : 'border-line text-ink3'
      }`}
    >
      {label}
    </button>
  );
  if (!last) return <p className="text-sm text-ink3">{x.noBars}</p>;
  return (
    <Tile id="rs-chart" title={x.title(ticker)}>
      <div className="flex flex-wrap items-start gap-3">
        <Choice
          label={x.range}
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({
            key: r,
            label: x.ranges[r] ?? r,
            disabled: startOf(r) === null ? x.short(SESSIONS[r] ?? 0, bars.length) : null,
          }))}
        />
        <Segmented
          label={x.timeframe}
          options={TIMEFRAMES.map((k) => ({ key: k, label: x.timeframes[k] ?? k }))}
          value={tf}
          onChange={setTf}
        />
      </div>
      <p className="text-xs text-ink3">{x.intraday}</p>
      <div role="group" aria-label={x.indicators} className="flex flex-wrap gap-1.5">
        {INDICATORS.map((k) => chip(ind[k], x.indicatorNames[k] ?? k, () => setInd({ ...ind, [k]: !ind[k] })))}
      </div>
      <div role="group" aria-label={x.overlays} className="flex flex-wrap gap-1.5">
        {OVERLAYS.map((k) => chip(ov[k], x.overlayNames[k] ?? k, () => setOv({ ...ov, [k]: !ov[k] })))}
        {a && chip(targets, x.targets, () => setTargets(!targets))}
        {chip(showLevels, x.levels, () => setShowLevels(!showLevels))}
      </div>
      <div
        role="figure"
        aria-label={x.aria(ticker, x.timeframes[tf] ?? tf, dayMonthYear(last.date))}
        className="overflow-hidden rounded-[10px] bg-elev"
      >
        <Suspense fallback={<SkeletonCards heights={[wide ? '340px' : '260px']} />}>
          <PriceChart
            bars={shown}
            markers={placed}
            toggles={toggles}
            height={wide ? 340 : 260}
            visibleSessions={visible}
            bollinger={ind.bollinger}
            priceLines={lines}
          />
        </Suspense>
      </div>
      {a && targets && !analyst.ok ? null : null}
      {showLevels && (
        <section aria-labelledby="rs-levels" className="flex flex-col gap-1">
          <h3 id="rs-levels" className="text-xs font-semibold text-ink2">
            {x.levelsTitle}
          </h3>
          {levels.levels.length === 0 ? (
            <p className="text-sm text-ink3">{x.noLevels}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sm text-ink2">
              {levels.levels.map((l) => (
                <li key={`${l.kind}-${l.price}`}>
                  <Num>
                    {x.levelLine(
                      l.kind === 'support' ? x.support : x.resistance,
                      l.touches,
                      money(l.price),
                      signedPctText(l.distancePct, 1),
                      dayMonthYear(l.from),
                      dayMonthYear(l.to),
                    )}
                  </Num>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink3">
            <Num>{x.levelsNote(dayMonthYear(last.date), LEVELS_VERSION)}</Num>
          </p>
        </section>
      )}
      <SourceLine>{x.source(dayMonthYear(last.date), bars.length)}</SourceLine>
    </Tile>
  );
}
