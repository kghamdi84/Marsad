import { describe, expect, it } from 'vitest';
import golden from '../../../fixtures/indicators/golden.json';
import nvda from '../../../fixtures/sec/submissions-NVDA-trimmed.json';
import {
  INDICATOR_VERSION,
  buildEventMarkers,
  snapToBar,
  summarizeBars,
  type DailyBar,
  type FilingEvent,
} from './study.js';

/** The 120 seeded golden bars on consecutive calendar days (the dates do not matter to the maths). */
function goldenBars(): DailyBar[] {
  const { o, h, l, c, v } = golden.input;
  return c.map((close, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    open: o[i] as number,
    high: h[i] as number,
    low: l[i] as number,
    close,
    volume: v[i] as number,
    vwap: null,
  }));
}

describe('summarizeBars against the pandas golden values', () => {
  const s = summarizeBars(goldenBars());
  it('matches RSI, ATR and relative volume from the independent implementation', () => {
    expect(s?.rsi14).toBeCloseTo(69.65047670346634, 9);
    expect(s?.atr14).toBeCloseTo(2.1593405549597335, 9);
    expect(s?.rvol20).toBeCloseTo(0.38719332732813827, 9);
  });
  it('matches the 50-day average, the range and the day change computed separately in Python', () => {
    expect(s?.sma50).toBeCloseTo(123.72451359097398, 9);
    expect(s?.lastClose).toBe(135.56274270516414);
    expect(s?.changePct).toBeCloseTo(-0.8296807695421512, 9);
    expect(s?.high52w).toBe(138.0728319946249);
    expect(s?.low52w).toBe(99.63377941368553);
  });
  it('says plainly when history is too short: no 200-day average from 120 bars, and the range covers 120 sessions', () => {
    expect(s?.sma200).toBeNull();
    expect(s?.trend).toBe('unknown');
    expect(s?.rangeSessions).toBe(120);
    expect(s?.sessions).toBe(120);
    expect(s?.formulaVersion).toBe(INDICATOR_VERSION);
  });
});

describe('summarizeBars edge cases', () => {
  it('returns null for no bars and nulls for a single bar', () => {
    expect(summarizeBars([])).toBeNull();
    const one = summarizeBars([goldenBars()[0] as DailyBar]);
    expect(one).toMatchObject({ previousClose: null, changePct: null, sma50: null, rsi14: null });
  });
  it('classifies the trend against both averages when 200 bars exist', () => {
    const rising: DailyBar[] = Array.from({ length: 220 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1000,
      vwap: null,
    }));
    expect(summarizeBars(rising)?.trend).toBe('above-both');
    const falling = rising.map((b, i) => ({ ...b, close: 400 - i, high: 401 - i, low: 399 - i }));
    expect(summarizeBars(falling)?.trend).toBe('below-both');
  });
  it('limits the high and low to the last 252 sessions', () => {
    const bars: DailyBar[] = Array.from({ length: 300 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      open: 10,
      high: i === 5 ? 999 : 20,
      low: 5,
      close: 10,
      volume: 1,
      vwap: null,
    }));
    const s = summarizeBars(bars);
    expect(s?.high52w).toBe(20); // the 999 spike on session 6 is older than 252 sessions
    expect(s?.rangeSessions).toBe(252);
  });
  it('refuses bars that are not in ascending date order', () => {
    const [a, b] = goldenBars() as [DailyBar, DailyBar];
    expect(() => summarizeBars([b, a])).toThrow(RangeError);
    expect(() => summarizeBars([a, a])).toThrow(RangeError);
  });
});

describe('snapToBar: a filing belongs to the bar nobody could trade before', () => {
  const dates = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'];
  it('keeps a filing accepted during or before the session on that day', () => {
    expect(snapToBar(dates, '2026-11-20T15:00:00Z', '2026-11-20')).toBe('2026-11-20'); // 10:00 ET
    expect(snapToBar(dates, '2026-11-23T13:57:54Z', '2026-11-23')).toBe('2026-11-23'); // the real NVDA 8-K, 08:57 ET
  });
  it('moves a filing accepted after the 16:00 ET close to the next trading bar', () => {
    expect(snapToBar(dates, '2026-11-20T21:00:00Z', '2026-11-20')).toBe('2026-11-23'); // 16:00 ET exactly, Friday
    expect(snapToBar(dates, '2026-11-20T20:59:59Z', '2026-11-20')).toBe('2026-11-20'); // one second before
  });
  it('moves a weekend filing to Monday', () => {
    expect(snapToBar(dates, '2026-11-21T15:00:00Z', '2026-11-21')).toBe('2026-11-23');
  });
  it('uses the filing date when no acceptance time exists', () => {
    expect(snapToBar(dates, null, '2026-11-21')).toBe('2026-11-23');
  });
  it('returns null outside the bars shown', () => {
    expect(snapToBar(dates, '2026-11-01T15:00:00Z', '2026-11-01')).toBeNull();
    expect(snapToBar(dates, '2026-11-24T22:00:00Z', '2026-11-24')).toBeNull(); // after the last bar's close
    expect(snapToBar([], null, '2026-11-20')).toBeNull();
  });
});

describe('dividend markers', () => {
  const dates = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'];
  it('puts a dividend on its ex-dividend date, or the next trading day when that day has no bar', () => {
    const m = buildEventMarkers([], [], dates, [
      { exDividendDate: '2026-11-20', cashAmount: 0.25, currency: 'USD' },
      { exDividendDate: '2026-11-21', cashAmount: 0.04, currency: 'USD' }, // a Saturday
    ]);
    expect(m.map((x) => [x.date, x.kind, x.label])).toEqual([
      ['2026-11-20', 'dividend', 'Dividend $0.25'],
      ['2026-11-23', 'dividend', 'Dividend $0.04'],
    ]);
  });
  it('leaves out a dividend whose ex-date is outside the bars shown (the declared December one)', () => {
    expect(
      buildEventMarkers([], [], dates, [
        { exDividendDate: '2026-12-02', cashAmount: 0.25, currency: 'USD' },
      ]),
    ).toEqual([]);
  });
});

describe('buildEventMarkers', () => {
  const dates = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'];
  const f = (form: string, acceptedAt: string, items: string[]): FilingEvent => ({
    form,
    filingDate: acceptedAt.slice(0, 10),
    acceptedAt,
    items,
  });
  it('marks high and medium 8-Ks and splits, and leaves out Form 4s and low-materiality 8-Ks', () => {
    const markers = buildEventMarkers(
      [
        f('8-K', '2026-11-20T15:00:00Z', ['2.02', '9.01']),
        f('8-K', '2026-11-23T15:00:00Z', ['1.01']),
        f('8-K', '2026-11-24T15:00:00Z', ['7.01']),
        f('4', '2026-11-24T15:00:00Z', []),
      ],
      [{ executionDate: '2026-11-19', splitFrom: 1, splitTo: 10 }],
      dates,
    );
    expect(markers.map((m) => [m.date, m.kind, m.label])).toEqual([
      ['2026-11-19', 'split', 'Split 10 for 1'],
      ['2026-11-20', 'high-8k', '8-K: Earnings results released'],
      ['2026-11-23', 'medium-8k', '8-K: Signed a major agreement'],
    ]);
  });
  it('places the real NVIDIA 8-K of 2026-11-23 (items 5.02 and 9.01) as a high-materiality marker', () => {
    const r = nvda.body.filings.recent;
    const i = r.accessionNumber.indexOf('0001045810-26-000090');
    const markers = buildEventMarkers(
      [
        {
          form: r.form[i] as string,
          filingDate: r.filingDate[i] as string,
          acceptedAt: r.acceptanceDateTime[i] as string,
          items: String(r.items[i]).split(','),
        },
      ],
      [],
      dates,
    );
    expect(markers).toEqual([
      {
        date: '2026-11-23',
        kind: 'high-8k',
        label: '8-K: Executive or director change',
        materiality: 'high',
      },
    ]);
  });
});
