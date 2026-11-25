import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { ema, rsi, sma, type ChartMarker, type DailyBar, type MarkerKind } from '@marsad/core';

/** The short text drawn on the chart for each marker kind; the full label is in the list beneath it. */
const MARKER_TEXT: Record<MarkerKind, string> = {
  'high-8k': '8-K',
  'medium-8k': '8-K',
  split: 'Split',
  dividend: 'Div',
  'insider-buy': 'Buy',
  halt: 'Halt',
  alert: 'Alert',
};

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
}: {
  bars: readonly DailyBar[];
  markers: readonly ChartMarker[];
  toggles: ChartToggles;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || bars.length === 0) return;
    const up = token('--color-up', '#5aa9ff');
    const down = token('--color-down', '#ff9f43');
    const text = token('--color-muted', '#a3b0bd');
    const grid = token('--color-line', '#263241');
    const warn = token('--color-warn', '#ffd166');
    const fg = token('--color-fg', '#e6edf3');

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
          color: fg,
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
          color: up,
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
        shape:
          m.kind === 'split' || m.kind === 'halt'
            ? 'square'
            : m.kind === 'high-8k'
              ? 'arrowDown'
              : m.kind === 'insider-buy'
                ? 'arrowUp'
                : 'circle',
        color:
          m.kind === 'high-8k' || m.kind === 'halt'
            ? warn
            : m.kind === 'medium-8k' || m.kind === 'alert'
              ? fg
              : m.kind === 'dividend'
                ? text
                : up,
        text: MARKER_TEXT[m.kind],
      }));
    createSeriesMarkers(candles, placed);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, markers, toggles, height]);

  return <div ref={host} className="w-full" style={{ minHeight: height }} />;
}
