import { describe, expect, it } from 'vitest';
import { SCREEN_PRESETS, type ScreenFilter } from '@marsad/core';
import { decodeFilters, decodeSort, encodeFilters, encodeSort } from './screener';

describe('screener link format', () => {
  it('round-trips every preset and every operator shape', () => {
    for (const p of SCREEN_PRESETS) {
      expect(decodeFilters(encodeFilters(p.filters))).toEqual({ filters: p.filters, ignored: [] });
      expect(decodeSort(encodeSort(p.sort))).toEqual(p.sort);
    }
    const shapes: ScreenFilter[] = [
      { field: 'return_1m', op: 'between', value: [-0.05, 0.1] },
      { field: 'pe_ratio', op: 'notNull' },
      { field: 'above_sma_50', op: 'eq', value: false },
      { field: 'rsi_14', op: 'lt', value: 30 },
    ];
    const text = encodeFilters(shapes);
    expect(text).toBe(
      'return_1m:between:-0.05_0.1,pe_ratio:notNull,above_sma_50:eq:false,rsi_14:lt:30',
    );
    expect(decodeFilters(text).filters).toEqual(shapes);
  });

  it('drops what core cannot run and says why, never guessing a value', () => {
    expect(decodeFilters('rsi_14:gte:,nope:gte:1,beta:between:2_1,above_sma_200:eq:maybe')).toEqual(
      {
        filters: [],
        ignored: [
          'rsi_14 gte needs a number',
          'unknown field nope',
          'beta between has its low above its high',
          'above_sma_200 takes eq with true or false',
        ],
      },
    );
    expect(decodeFilters(undefined)).toEqual({ filters: [], ignored: [] });
    expect(decodeSort('sector_etf:asc')).toBeNull();
    expect(decodeSort('close:sideways')).toBeNull();
    expect(decodeSort('ticker:asc')).toEqual({ field: 'ticker', dir: 'asc' });
  });
});
