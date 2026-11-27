import { useEffect, useRef } from 'react';
import { useDisplay } from '../lib/display';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  TrackingModeExitMode,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { ema, rsi, sma, toFixedHalfUp, type ChartMarker, type DailyBar } from '@marsad/core';
import { t } from '../strings';
import { markerLetter } from './study/markers';

export interface ChartToggles {
  sma50: boolean;
  sma200: boolean;
  ema20: boolean;
  rsi: boolean;
  volume: boolean;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function line(dates: readonly string[], values: readonly (number | null)[]) {
  const out: { time: Time; value: number }[] = [];
  values.forEach((v, i) => {
    if (v !== null) out.push({ time: dates[i] as Time, value: v });
  });
  return out;
}

/**
 * Daily candlesticks with the indicators of choice and event markers (TradingView Lightweight Charts, whose
 * attribution logo is left on as the licence asks). Blue is up and orange is down; the shape of a candle and
 * the numbers on the page carry the same information, so colour is never the only signal.
 */
export default function PriceChart({
  bars,
  markers,
  toggles,
  height = 420,
  visibleSessions,
  onPick,
}: {
  bars: readonly DailyBar[];
  markers: readonly ChartMarker[];
  toggles: ChartToggles;
  height?: number;
  /** Show only the newest sessions (the rest stay loaded, so long averages are drawn from full history). */
  visibleSessions?: number;
  /** Called with a bar date when a click or tap lands on a session that carries a marker. */
  onPick?: (date: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  // Kept in a ref so a new callback does not redraw the chart.
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  const { theme } = useDisplay();
  useEffect(() => {
    const el = host.current;
    if (!el || bars.length === 0) return;
    const up = token('--color-up', '#5aa9ff');
    const down = token('--color-down', '#ff9f43');
    const text = token('--color-ink3', '#b7c1d2');
    const grid = token('--color-line', '#263241');
    const warn = token('--color-warn', '#ffd166');
    const fg = token('--color-ink2', '#e8ecf3');
    const crit = token('--color-crit', '#ff6b70');
    const emaColor = token('--color-ema', '#c9a8ff');

    const chart = createChart(el, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: text,
        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        panes: { separatorColor: grid },
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid },
      timeScale: { borderColor: grid },
      // On a touch screen, touch and hold shows the crosshair; it goes when the finger lifts.
      trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
    });

    const dates = bars.map((b) => b.date);
    const closes = bars.map((b) => b.close);
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up,
      borderUpColor: up,
      wickUpColor: up,
      downColor: down,
      borderDownColor: down,
      wickDownColor: down,
    });
    candles.setData(
      bars.map((b) => ({
        time: b.date as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    if (toggles.volume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        color: grid,
      });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        bars.map((b, i) => ({
          time: b.date as Time,
          value: b.volume,
          color: i > 0 && b.close < (bars[i - 1] as DailyBar).close ? `${down}66` : `${up}66`,
        })),
      );
    }
    if (toggles.sma50)
      chart
        .addSeries(LineSeries, {
          color: text,
          lineWidth: 1,
          title: 'SMA 50',
          lastValueVisible: false,
        })
        .setData(line(dates, sma(closes, 50)));
    if (toggles.sma200)
      chart
        .addSeries(LineSeries, {
          color: warn,
          lineWidth: 2,
          title: 'SMA 200',
          lastValueVisible: false,
        })
        .setData(line(dates, sma(closes, 200)));
    if (toggles.ema20)
      chart
        .addSeries(LineSeries, {
          color: emaColor,
          lineWidth: 1,
          lineStyle: 2,
          title: 'EMA 20',
          lastValueVisible: false,
        })
        .setData(line(dates, ema(closes, 20)));
    if (toggles.rsi) {
      const r = chart.addSeries(LineSeries, { color: fg, lineWidth: 1, title: 'RSI 14' }, 1);
      r.setData(line(dates, rsi(closes, 14)));
      r.createPriceLine({ price: 70, color: down, lineStyle: 2, lineWidth: 1, title: '70' });
      r.createPriceLine({ price: 30, color: up, lineStyle: 2, lineWidth: 1, title: '30' });
    }

    const barDates = new Set(dates);
    const placed: SeriesMarker<Time>[] = markers
      .filter((m) => barDates.has(m.date))
      .map((m) => ({
        time: m.date as Time,
        // Dividends and insider buys sit below the bar so they never hide an 8-K, split, halt or alert above it.
        position: m.kind === 'dividend' || m.kind === 'insider-buy' ? 'belowBar' : 'aboveBar',
        shape: m.kind === 'split' || m.kind === 'halt' ? 'square' : 'circle',
        // As in the design: results in the warn colour, Marsad alerts in the up colour, halts critical, the rest muted.
        color: m.results
          ? warn
          : m.kind === 'alert'
            ? up
            : m.kind === 'halt'
              ? crit
              : m.kind === 'high-8k'
                ? warn
                : text,
        text: markerLetter(m),
      }));
    createSeriesMarkers(candles, placed);

    // A click or tap on a session with a marker picks it; the detail shows under the chart.
    const markedDates = new Set(placed.map((p) => p.time as string));
    chart.subscribeClick((param) => {
      const day = typeof param.time === 'string' ? param.time : null;
      if (day && markedDates.has(day)) pick.current?.(day);
    });

    // The day and close under the crosshair (pointer or touch and hold); hidden when the crosshair leaves.
    const byDate = new Map(bars.map((b) => [b.date, b.close]));
    chart.subscribeCrosshairMove((param) => {
      const box = readout.current;
      if (!box) return;
      const day = typeof param.time === 'string' ? param.time : null;
      const close = day ? byDate.get(day) : undefined;
      if (!day || close === undefined || !param.point) {
        box.hidden = true;
        return;
      }
      const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
      box.textContent = t.study.ui.readout(label, toFixedHalfUp(close, 2));
      box.hidden = false;
    });

    chart.timeScale().fitContent();
    if (visibleSessions && bars.length > visibleSessions)
      chart.timeScale().setVisibleLogicalRange({
        from: bars.length - visibleSessions,
        to: bars.length - 0.5,
      });
    return () => chart.remove();
    // The theme is a dependency: the colours are read from the theme tokens when the chart is drawn.
  }, [bars, markers, toggles, height, visibleSessions, theme]);

  return (
    <div className="relative">
      <div ref={host} className="w-full" style={{ minHeight: height }} />
      <div
        ref={readout}
        hidden
        aria-hidden="true"
        data-testid="chart-readout"
        className="pointer-events-none absolute start-2 top-2 z-10 rounded-md bg-raised px-2 py-1 text-xs font-semibold text-ink tabular-nums shadow"
      />
    </div>
  );
}
