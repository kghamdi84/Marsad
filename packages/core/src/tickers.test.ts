import { describe, expect, it } from 'vitest';
import { CORE_ETFS, STARTING_STOCKS, STARTING_TICKERS, normalizeTicker } from './tickers.js';

describe('tickers', () => {
  it('lists 10 stocks and 4 benchmark ETFs, all valid and unique', () => {
    expect(STARTING_STOCKS).toHaveLength(10);
    expect(CORE_ETFS).toEqual(['SPY', 'QQQ', 'IWM', 'DIA']);
    expect(new Set(STARTING_TICKERS).size).toBe(14);
    for (const t of STARTING_TICKERS) expect(normalizeTicker(t)).toBe(t);
  });
  it('normalizes plausible tickers and rejects the rest', () => {
    expect(normalizeTicker(' nvda ')).toBe('NVDA');
    expect(normalizeTicker('BRK.B')).toBe('BRK.B');
    for (const bad of ['', '1ABC', 'nvda; drop', 'WAYTOOLONGTICKER', '../x'])
      expect(normalizeTicker(bad)).toBeNull();
  });
});
