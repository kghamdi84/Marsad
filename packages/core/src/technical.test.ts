import { describe, expect, it } from 'vitest';
import { macd } from './indicators.js';
import type { DailyBar } from './study.js';
import { TECHNICAL_VERSION, rsiZone, technicalSummary } from './technical.js';

/** `n` weekday-ish bars (consecutive calendar days are fine here) with closes from `close(i)`, high and low 1 away. */
function series(n: number, close: (i: number) => number): DailyBar[] {
  const out: DailyBar[] = [];
  const start = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const c = close(i);
    out.push({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      open: c,
      high: c + 1,
      low: c - 1,
      close: c,
      volume: 1000,
      vwap: null,
    });
  }
  return out;
}

const get = (s: ReturnType<typeof technicalSummary>, id: string) =>
  s.signals.find((x) => x.id === id);

describe('technical-1 summary', () => {
  it('reads a steady rise (closes 1 to 260) by hand', () => {
    const bars = series(260, (i) => i + 1);
    const s = technicalSummary(bars);
    expect(s.formulaVersion).toBe(TECHNICAL_VERSION);
    expect(s.asOf).toBe(bars.at(-1)?.date);
    expect(s.close).toBe(260);
    // SMA 20 = mean(241..260) = 250.5; SMA 50 = mean(211..260) = 235.5; SMA 200 = mean(61..260) = 160.5.
    expect(get(s, 'above-sma20')).toMatchObject({ positive: true, value: 260, reference: 250.5 });
    expect(get(s, 'above-sma50')).toMatchObject({ positive: true, reference: 235.5 });
    expect(get(s, 'above-sma200')).toMatchObject({ positive: true, reference: 160.5 });
    expect(get(s, 'sma50-above-sma200')).toMatchObject({
      positive: true,
      value: 235.5,
      reference: 160.5,
    });
    // No down day: RSI 100, in the 70-and-over zone; the rule is "at or above 50".
    expect(get(s, 'rsi-50')).toMatchObject({ positive: true, value: 100, reference: 50 });
    expect(s.rsiZone).toBe('70-plus');
    // 52 weeks = the last 252 bars, closes 9 to 260: low 8, high 261, position (260 - 8) / 253.
    expect(s.range52w?.low).toBe(8);
    expect(s.range52w?.high).toBe(261);
    expect(s.range52w?.positionPct).toBeCloseTo((252 / 253) * 100, 10);
    expect(get(s, 'upper-half-52w')?.positive).toBe(true);
    // MACD against its signal, as the tested indicator module computes them.
    const m = macd(bars.map((b) => b.close));
    const line = m.line.at(-1) as number;
    const signal = m.signal.at(-1) as number;
    expect(get(s, 'macd-above-signal')).toMatchObject({
      value: line,
      reference: signal,
      positive: line > signal,
    });
    expect(s.available).toBe(7);
    expect(s.positive).toBe(s.signals.filter((x) => x.positive).length);
  });

  it('reads a steady fall as negative on every rule', () => {
    const s = technicalSummary(series(260, (i) => 400 - i));
    for (const id of [
      'above-sma20',
      'above-sma50',
      'above-sma200',
      'sma50-above-sma200',
      'rsi-50',
      'upper-half-52w',
    ])
      expect(get(s, id)?.positive).toBe(false);
    expect(get(s, 'rsi-50')?.value).toBe(0);
    expect(s.rsiZone).toBe('under-30');
    expect(s.available).toBe(7);
  });

  it('leaves rules that need more history not available', () => {
    // 30 sessions: SMA 20 and RSI 14 exist; SMA 50, SMA 200, MACD signal (34 sessions) and the 52 weeks do not.
    const s = technicalSummary(series(30, (i) => 50 + (i % 3)));
    expect(get(s, 'above-sma20')?.positive).not.toBeNull();
    expect(get(s, 'rsi-50')?.positive).not.toBeNull();
    for (const id of [
      'above-sma50',
      'above-sma200',
      'sma50-above-sma200',
      'macd-above-signal',
      'upper-half-52w',
    ]) {
      expect(get(s, id)?.positive).toBeNull();
      expect(get(s, id)?.value).toBeNull();
    }
    expect(s.available).toBe(2);
    expect(s.range52w).toBeNull();
  });

  it('handles no bars and rejects bars out of order', () => {
    const s = technicalSummary([]);
    expect(s.close).toBeNull();
    expect(s.available).toBe(0);
    const bars = series(3, (i) => i + 1);
    expect(() => technicalSummary([bars[1] as DailyBar, bars[0] as DailyBar])).toThrow(RangeError);
  });

  it('puts RSI zone boundaries in the upper zone', () => {
    expect(rsiZone(29.99)).toBe('under-30');
    expect(rsiZone(30)).toBe('30-50');
    expect(rsiZone(50)).toBe('50-70');
    expect(rsiZone(70)).toBe('70-plus');
  });
});
