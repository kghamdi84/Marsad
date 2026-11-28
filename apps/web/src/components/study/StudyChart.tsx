import { lazy, Suspense, useMemo, useState } from 'react';
import {
  priceLevels,
  resampleBars,
  toFixedHalfUp,
  type BarSummary,
  type ChartMarker,
  type DailyBar,
  type EarningsMove,
  type Timeframe,
} from '@marsad/core';
import type { ChartToggles, PriceLine } from '../PriceChart';
import { Info } from '../Info';
import { Segmented, SkeletonCards, cardClass, useRemembered, useWide } from '../Card';
import { Num, signedPct } from '../ui/kit';
import { dayMonthYear } from '../../lib/dates';
import type { StudyData } from '../../lib/study';
import { t } from '../../strings';
import { markerLetter } from './markers';
import { useAnalystTargets } from './research/Research';
import { Choice } from './research/shared';

const PriceChart = lazy(() => import('../PriceChart'));

const ui = t.study.ui;
const rc = t.study.research.chart;
const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANGES = ['1m', '3m', '6m', 'ytd', '1y', '5y', 'all'] as const;
type Range = (typeof RANGES)[number];
const SESSIONS: Partial<Record<Range, number>> = {
  '1m': 21,
  '3m': 63,
  '6m': 126,
  '1y': 252,
  '5y': 1260,
};
const TIMEFRAMES = ['daily', 'weekly', 'monthly'] as const;
const OVERLAYS = ['results', 'filings', 'dividend', 'split', 'insider', 'halt', 'alert'] as const;
type Overlay = (typeof OVERLAYS)[number];
const overlayOf = (m: ChartMarker): Overlay =>
  m.results
    ? 'results'
    : m.kind === 'high-8k' || m.kind === 'medium-8k'
      ? 'filings'
      : m.kind === 'insider-buy'
        ? 'insider'
        : (m.kind as Overlay);

const defaultToggles: ChartToggles = {
  sma50: true,
  sma200: true,
  ema20: false,
  rsi: false,
  volume: true,
};

/** The indicator toggles, remembered in this browser only (storage may be blocked, so every access is guarded). */
function useStoredToggles() {
  const key = 'marsad.study.toggles';
  const [v, setV] = useState<ChartToggles>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as Partial<ChartToggles>) : {};
      const out = { ...defaultToggles };
      for (const k of Object.keys(out) as (keyof ChartToggles)[])
        if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
      return out;
    } catch {
      return defaultToggles;
    }
  });
  const set = (next: ChartToggles) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Not remembered; the choice still applies to this visit.
    }
  };
  return [v, set] as const;
}

/** One marker in words: "2026-11-23: 8-K: Executive or director change (High)". */
const markerText = (m: ChartMarker) =>
  `${m.date}: ${m.label}${m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}`;

/** The detail line for the picked session: each marker on it, with the next-session move for results. */
function MarkerDetail({
  markers,
  date,
  moves,
}: {
  markers: readonly ChartMarker[];
  date: string | null;
  moves: ReadonlyMap<string, EarningsMove>;
}) {
  const on = date ? markers.filter((m) => m.date === date) : [];
  return (
    <p aria-live="polite" className="text-xs text-ink2">
      {on.length === 0
        ? markers.length === 0
          ? t.study.noMarkers
          : ui.markerPrompt
        : on.map((m, i) => {
            const move = m.results ? moves.get(m.date) : undefined;
            return (
              <span key={`${m.label}-${i}`} className="block">
                <span className="font-semibold text-ink">{markerLetter(m)}</span>
                {' · '}
                <Num>{dayMonthYear(m.date)}</Num>
                {' · '}
                {m.label}
                {m.materiality ? ` (${t.study.materiality[m.materiality]})` : ''}
                {move && (
                  <>
                    {' · '}
                    <span className={move.pct > 0 ? 'text-up' : move.pct < 0 ? 'text-down' : ''}>
                      <Num>{ui.nextSession(signedPct(move.pct, 1))}</Num>
                    </span>
                    {move.large ? ` (${ui.largeMove})` : ''}
                  </>
                )}
              </span>
            );
          })}
    </p>
  );
}

/**
 * The Study price chart: ranges from 1M to All as far as stored bars reach, daily, weekly or monthly candles
 * (resampled from daily bars), indicators with Bollinger Bands, event overlays, analyst targets and support and
 * resistance levels as horizontal lines. Self-contained: it reads the analyst targets itself.
 */
export function StudyChart({
  data,
  summary,
  markers,
  moves,
}: {
  data: StudyData;
  summary: BarSummary;
  markers: readonly ChartMarker[];
  moves: ReadonlyMap<string, EarningsMove>;
}) {
  const ticker = data.ticker;
  const bars = data.bars;
  const wide = useWide();
  const [toggles, setToggles] = useStoredToggles();
  const [range, setRange] = useRemembered<Range>('marsad.study.range', RANGES, '1y');
  const [tf, setTf] = useRemembered<Timeframe>('marsad.study.timeframe', TIMEFRAMES, 'daily');
  const [bollinger, setBollinger] = useState(false);
  const [ov, setOv] = useState<Record<Overlay, boolean>>({
    results: true,
    filings: true,
    dividend: true,
    split: true,
    insider: true,
    halt: true,
    alert: true,
  });
  const [targets, setTargets] = useState(false);
  const [levelsOn, setLevelsOn] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const analyst = useAnalystTargets(ticker);
  const a = analyst.ok ? analyst.value : null;

  const last = bars.at(-1) as DailyBar;
  const startOf = (r: Range): string | null => {
    if (r === 'all') return bars[0]?.date ?? null;
    if (r === 'ytd')
      return bars.find((b) => b.date >= `${last.date.slice(0, 4)}-01-01`)?.date ?? null;
    const n = SESSIONS[r] as number;
    return bars.length > n ? (bars[bars.length - 1 - n] as DailyBar).date : null;
  };
  const shown = useMemo(() => resampleBars(bars, tf), [bars, tf]);
  const start = startOf(range) ?? bars[0]?.date ?? last.date;
  const visible = shown.filter((b) => b.date >= start).length;
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
  const lines = useMemo(() => {
    const out: PriceLine[] = [];
    if (targets && a) {
      if (a.target_high_price !== null)
        out.push({ price: a.target_high_price, title: rc.targetHigh, tone: 'up', style: 'dashed' });
      if (a.target_mean_price !== null)
        out.push({
          price: a.target_mean_price,
          title: rc.targetMean,
          tone: 'ink',
          style: 'dashed',
        });
      if (a.target_low_price !== null)
        out.push({ price: a.target_low_price, title: rc.targetLow, tone: 'down', style: 'dashed' });
    }
    if (levelsOn)
      for (const l of levels.levels)
        out.push({
          price: l.price,
          title: l.kind === 'support' ? rc.support : rc.resistance,
          tone: 'muted',
          style: 'dotted',
        });
    return out;
  }, [targets, a, levelsOn, levels]);

  // The picked session, or the newest marker until one is picked.
  const shownDate = picked ?? placed.at(-1)?.date ?? null;
  const staleLine =
    data.lastCompletedDay && summary.asOf < data.lastCompletedDay
      ? t.study.stale(summary.asOf, data.lastCompletedDay)
      : t.study.current;

  const pill = (pressed: boolean, label: string, on: () => void, key?: string) => (
    <button
      key={key ?? label}
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
  const chip = (k: keyof ChartToggles, label: string) =>
    pill(toggles[k], label, () => setToggles({ ...toggles, [k]: !toggles[k] }), k);

  return (
    <section aria-labelledby="chart-h" className={`${cardClass} gap-2.5`}>
      <h2 id="chart-h" className="sr-only">
        {t.study.chart}
      </h2>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div role="group" aria-label={t.study.indicators} className="flex flex-wrap gap-1.5">
          {chip('sma50', t.study.sma50)}
          {chip('sma200', t.study.sma200)}
          {chip('ema20', t.study.ema20)}
          {chip('rsi', ui.rsiChip(summary.rsi14 === null ? null : toFixedHalfUp(summary.rsi14, 1)))}
          {chip('volume', t.study.volume)}
          {pill(bollinger, rc.indicatorNames['bollinger'] ?? '', () => setBollinger(!bollinger))}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Segmented
            label={rc.timeframe}
            options={TIMEFRAMES.map((k) => ({ key: k, label: rc.timeframes[k] ?? k }))}
            value={tf}
            onChange={setTf}
          />
          <Choice
            label={ui.chartRange}
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({
              key: r,
              label: rc.ranges[r] ?? r,
              disabled: startOf(r) === null ? rc.short(SESSIONS[r] ?? 0, bars.length) : null,
            }))}
          />
        </div>
      </div>
      <div role="group" aria-label={rc.overlays} className="flex flex-wrap gap-1.5">
        {OVERLAYS.map((k) =>
          pill(ov[k], rc.overlayNames[k] ?? k, () => setOv({ ...ov, [k]: !ov[k] }), k),
        )}
        {a && pill(targets, rc.targets, () => setTargets(!targets))}
        {pill(levelsOn, rc.levels, () => setLevelsOn(!levelsOn))}
      </div>
      <div
        role="figure"
        aria-label={
          tf === 'daily'
            ? t.study.chartLabel(ticker, summary.asOf)
            : rc.aria(ticker, rc.timeframes[tf] ?? tf, summary.asOf)
        }
        className="overflow-hidden rounded-[10px] bg-elev"
      >
        <Suspense fallback={<SkeletonCards heights={[wide ? '300px' : '240px']} />}>
          <PriceChart
            bars={shown}
            markers={placed}
            toggles={toggles}
            height={wide ? 300 : 240}
            visibleSessions={visible}
            onPick={setPicked}
            bollinger={bollinger}
            priceLines={lines}
          />
        </Suspense>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <MarkerDetail markers={placed} date={shownDate} moves={moves} />
        <span className="text-xs text-ink3">
          <Num>
            {ui.legend(
              t.study.range(summary.rangeSessions),
              usd(summary.low52w),
              usd(summary.high52w),
            )}
          </Num>
        </span>
      </div>
      <p className="text-xs text-ink2">
        {ui.trendLine(
          t.study.trendLabels[summary.trend],
          summary.sma50 === null ? t.study.unavailable : usd(summary.sma50),
          summary.sma200 === null ? t.study.unavailable : usd(summary.sma200),
        )}
      </p>
      {levelsOn && (
        <p className="text-xs text-ink3">
          <Num>
            {levels.levels.length === 0
              ? rc.noLevels
              : levels.levels
                  .map((l) =>
                    rc.levelShort(
                      l.kind === 'support' ? rc.support : rc.resistance,
                      l.touches,
                      toFixedHalfUp(l.price, 2),
                      `${l.distancePct >= 0 ? '+' : '−'}${toFixedHalfUp(Math.abs(l.distancePct), 1)}%`,
                    ),
                  )
                  .join(' · ')}
          </Num>
          <span className="block">
            <Num>{rc.levelsNote(dayMonthYear(last.date), levels.formulaVersion)}</Num>
          </span>
        </p>
      )}
      <p className="text-xs text-ink3">{rc.intraday}</p>
      {placed.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-ink2 select-none">
            {ui.markersAll(placed.length)}
          </summary>
          <div className="flex flex-col gap-2 border-t border-line p-3">
            <Info>{t.study.markersNote}</Info>
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {[...placed].reverse().map((m, i) => (
                <li key={`${m.date}-${m.label}-${i}`}>
                  <button
                    type="button"
                    aria-pressed={shownDate === m.date}
                    onClick={() => setPicked(m.date)}
                    className="flex min-h-11 w-full items-center gap-3 border-b border-line py-1.5 text-start text-sm text-ink2"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-7 flex-none items-center justify-center rounded-full border bg-surface text-[11px] font-bold ${
                        m.results || m.kind === 'high-8k'
                          ? 'border-warn text-warn'
                          : m.kind === 'alert'
                            ? 'border-up text-up'
                            : m.kind === 'halt'
                              ? 'border-crit text-crit'
                              : 'border-line-strong text-ink3'
                      }`}
                    >
                      {markerLetter(m)}
                    </span>
                    <span>{markerText(m)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      <p
        className={staleLine === t.study.current ? 'text-xs text-ink3' : 'text-sm text-warn'}
        role="status"
      >
        {staleLine}
      </p>
      <p className="text-xs text-ink3">
        {t.study.provenance(summary.asOf, summary.sessions, summary.formulaVersion)}
      </p>
    </section>
  );
}
