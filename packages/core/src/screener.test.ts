import { describe, expect, it } from 'vitest';
import { buildCalendar } from './calendar.js';
import {
  SCREEN_PRESETS,
  SCREENER_VERSION,
  screen,
  sessionsBetween,
  type ScreenFilter,
} from './screener.js';
import { SUMMARY_FIELDS, TICKER_SUMMARY_VERSION, type TickerSummaryRow } from './ticker-summary.js';

/** A summary row with every figure null, then the overrides. */
function row(ticker: string, over: Partial<TickerSummaryRow> = {}): TickerSummaryRow {
  const base = Object.fromEntries(
    SUMMARY_FIELDS.map((f) => [f, null]),
  ) as unknown as TickerSummaryRow;
  return {
    ...base,
    version: TICKER_SUMMARY_VERSION,
    date: '2026-11-27',
    ticker,
    coverage: 'tracked',
    unavailable: {},
    sources: {},
    formula_versions: {},
    ...over,
  };
}

const preset = (id: string) => {
  const p = SCREEN_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

describe('screen (screener-1)', () => {
  it('a null in a filtered field excludes the row and is counted, never passed', () => {
    const rows = [
      row('AAA', { volume_ratio_20: 2.5 }),
      row('BBB', { volume_ratio_20: 1.2 }),
      row('CCC', { volume_ratio_20: null }),
      row('DDD', { volume_ratio_20: 2 }),
    ];
    const r = screen(rows, preset('unusual-volume').filters, preset('unusual-volume').sort);
    if (!r.ok) throw new Error(r.reason);
    expect(r.formulaVersion).toBe(SCREENER_VERSION);
    expect(r.total).toBe(4);
    expect(r.matched).toBe(2);
    expect(r.excludedMissing).toBe(1);
    expect(r.missingByField).toEqual({ volume_ratio_20: 1 });
    expect(r.failed).toBe(1);
    expect(r.rows.map((m) => m.row.ticker)).toEqual(['AAA', 'DDD']);
    expect(r.rows[0]!.reasons).toEqual([
      { field: 'volume_ratio_20', op: 'gte', value: 2, actual: 2.5 },
    ]);
  });

  it('counts missing data per field; a row null in two fields counts once in the total', () => {
    const rows = [
      row('AAA', { rsi_14: null, beta: null }),
      row('BBB', { rsi_14: 40, beta: null }),
      row('CCC', { rsi_14: 40, beta: 1 }),
    ];
    const filters: ScreenFilter[] = [
      { field: 'rsi_14', op: 'between', value: [30, 50] },
      { field: 'beta', op: 'lte', value: 1.5 },
    ];
    const r = screen(rows, filters);
    if (!r.ok) throw new Error(r.reason);
    expect(r.excludedMissing).toBe(2);
    expect(r.missingByField).toEqual({ rsi_14: 1, beta: 2 });
    expect(r.matched).toBe(1);
    expect(r.rows[0]!.reasons.map((x) => x.actual)).toEqual([40, 1]);
  });

  it('between is inclusive; gt and lt are strict', () => {
    const rows = [30, 40, 50, 60].map((v, i) => row(`T${i}`, { rsi_14: v }));
    const between = screen(rows, [{ field: 'rsi_14', op: 'between', value: [30, 50] }]);
    const gt = screen(rows, [{ field: 'rsi_14', op: 'gt', value: 30 }]);
    const lt = screen(rows, [{ field: 'rsi_14', op: 'lt', value: 60 }]);
    if (!between.ok || !gt.ok || !lt.ok) throw new Error('not ok');
    expect(between.matched).toBe(3);
    expect(gt.matched).toBe(3);
    expect(lt.matched).toBe(3);
  });

  it('isNull and notNull test the null itself and never count as missing data', () => {
    const rows = [row('AAA', { pe_ratio: null }), row('BBB', { pe_ratio: 12 })];
    const isNull = screen(rows, [{ field: 'pe_ratio', op: 'isNull' }]);
    const notNull = screen(rows, [{ field: 'pe_ratio', op: 'notNull' }]);
    if (!isNull.ok || !notNull.ok) throw new Error('not ok');
    expect(isNull.rows.map((m) => m.row.ticker)).toEqual(['AAA']);
    expect(notNull.rows.map((m) => m.row.ticker)).toEqual(['BBB']);
    expect(isNull.excludedMissing).toBe(0);
    expect(notNull.excludedMissing).toBe(0);
    expect(notNull.failed).toBe(1);
  });

  it('sorts by one field in either direction with nulls last, ties by ticker', () => {
    const rows = [
      row('DDD', { return_1m: null }),
      row('BBB', { return_1m: 0.05 }),
      row('AAA', { return_1m: 0.05 }),
      row('CCC', { return_1m: -0.02 }),
    ];
    const desc = screen(rows, [], { field: 'return_1m', dir: 'desc' });
    const asc = screen(rows, [], { field: 'return_1m', dir: 'asc' });
    if (!desc.ok || !asc.ok) throw new Error('not ok');
    expect(desc.rows.map((m) => m.row.ticker)).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(asc.rows.map((m) => m.row.ticker)).toEqual(['CCC', 'AAA', 'BBB', 'DDD']);
  });

  it('preset: above the 200-day average (a boolean field)', () => {
    const rows = [
      row('AAA', { above_sma_200: true }),
      row('BBB', { above_sma_200: false }),
      row('CCC', { above_sma_200: null }),
    ];
    const p = preset('above-200-day');
    expect(p.name).toBe('Above 200-day average');
    const r = screen(rows, p.filters, p.sort);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((m) => m.row.ticker)).toEqual(['AAA']);
    expect(r.missingByField).toEqual({ above_sma_200: 1 });
  });

  it('preset: near the 52-week high is the top 10% of the range', () => {
    const rows = [
      row('AAA', { range_position_52w: 0.9 }),
      row('BBB', { range_position_52w: 0.89 }),
      row('CCC', { range_position_52w: 1 }),
    ];
    const p = preset('near-52-week-high');
    expect(p.name).toBe('Near 52-week high (top 10% of range)');
    const r = screen(rows, p.filters, p.sort);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((m) => m.row.ticker)).toEqual(['CCC', 'AAA']);
  });

  it('preset: pays a dividend means trailing 12-month dividends above zero', () => {
    const rows = [
      row('AAA', { dividends_ttm: 1.2, dividend_yield_ttm: 0.02 }),
      row('BBB', { dividends_ttm: 0, dividend_yield_ttm: 0 }),
      row('CCC', { dividends_ttm: null }),
      row('DDD', { dividends_ttm: 2, dividend_yield_ttm: 0.05 }),
    ];
    const p = preset('pays-dividend');
    expect(p.name).toBe('Pays a dividend');
    const r = screen(rows, p.filters, p.sort);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((m) => m.row.ticker)).toEqual(['DDD', 'AAA']);
    expect(r.failed).toBe(1);
    expect(r.excludedMissing).toBe(1);
  });

  it('preset: earnings within 10 sessions, counted in trading days after the row date', () => {
    // Row date Friday 2026-11-27. 2026-12-11 is 10 weekdays later; 2026-12-14 is 11.
    const rows = [
      row('AAA', { next_earnings_date: '2026-12-11' }),
      row('BBB', { next_earnings_date: '2026-12-14' }),
      row('CCC', { next_earnings_date: '2026-12-01' }),
      row('DDD', { next_earnings_date: null }),
    ];
    const p = preset('earnings-within-10');
    expect(p.name).toBe('Earnings within 10 sessions');
    const r = screen(rows, p.filters, p.sort);
    if (!r.ok) throw new Error(r.reason);
    expect(r.rows.map((m) => [m.row.ticker, m.sessionsToEarnings])).toEqual([
      ['CCC', 2],
      ['AAA', 10],
    ]);
    expect(r.missingByField).toEqual({ sessions_to_earnings: 1 });
  });

  it('with a market calendar, exchange holidays are not counted as sessions', () => {
    const cal = buildCalendar([
      { exchange: 'NYSE', date: '2026-12-25', name: 'Christmas', status: 'closed' },
    ]);
    expect(sessionsBetween('2026-12-21', '2026-12-28')).toBe(5);
    expect(sessionsBetween('2026-12-21', '2026-12-28', cal)).toBe(4);
    expect(sessionsBetween('2026-12-28', '2026-12-21')).toBeNull();
  });

  it('rejects an unknown field, a wrong value type or a reversed range', () => {
    const bad = (f: unknown) => screen([row('AAA')], [f as ScreenFilter]);
    expect(bad({ field: 'ticker', op: 'eq', value: 1 })).toEqual({
      ok: false,
      reason: 'unknown field ticker',
    });
    expect(bad({ field: 'rsi_14', op: 'gte', value: '50' }).ok).toBe(false);
    expect(bad({ field: 'above_sma_50', op: 'gte', value: 1 }).ok).toBe(false);
    expect(bad({ field: 'rsi_14', op: 'between', value: [70, 30] })).toEqual({
      ok: false,
      reason: 'rsi_14 between has its low above its high',
    });
    expect(bad({ field: 'rsi_14', op: 'near', value: 1 }).ok).toBe(false);
  });

  it('market-coverage rows (price fields only) are counted as missing data, not as passing', () => {
    const rows = [row('MKT', { coverage: 'market', close: 10 }), row('TRK', { rsi_14: 55 })];
    const r = screen(rows, [{ field: 'rsi_14', op: 'gte', value: 50 }]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.matched).toBe(1);
    expect(r.excludedMissing).toBe(1);
    expect(r.dates).toEqual(['2026-11-27']);
  });

  it('preset names describe the condition only', () => {
    expect(SCREEN_PRESETS.map((p) => p.name)).toEqual([
      'Above 200-day average',
      'Near 52-week high (top 10% of range)',
      'Unusual volume (20-day ratio ≥ 2)',
      'Pays a dividend',
      'Earnings within 10 sessions',
    ]);
    for (const p of SCREEN_PRESETS)
      expect(p.name).not.toMatch(/\b(buy|sell|bullish|bearish|strong|best|opportunit)/i);
  });
});
