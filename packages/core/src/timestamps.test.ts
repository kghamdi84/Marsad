import { describe, expect, it } from 'vitest';
import { inferEpochUnit, toDate, toEpochMs, toIsoUtc } from './timestamps.js';

// 2026-11-23T19:27:36.123Z in each unit.
const MS = 1795462056123;
const S = 1795462056;
const US = 1795462056123456;
const NS = 1795462056123456789n;

describe('inferEpochUnit', () => {
  it('detects each unit by magnitude', () => {
    expect(inferEpochUnit(S)).toBe('s');
    expect(inferEpochUnit(MS)).toBe('ms');
    expect(inferEpochUnit(US)).toBe('us');
    expect(inferEpochUnit(NS)).toBe('ns');
  });
  it('rejects ambiguous magnitudes', () => {
    expect(() => inferEpochUnit(123)).toThrow(RangeError);
    expect(() => inferEpochUnit(Number.NaN)).toThrow(RangeError);
    expect(() => inferEpochUnit('12.5')).toThrow(RangeError);
  });
});

describe('toEpochMs', () => {
  it('converts every unit to the same instant', () => {
    expect(toEpochMs(MS)).toBe(MS);
    expect(toEpochMs(S)).toBe(1795462056000);
    expect(toEpochMs(US)).toBe(MS);
    expect(toEpochMs(NS)).toBe(MS);
    expect(toEpochMs(String(NS))).toBe(MS);
  });
  it('handles a nanosecond number above 2^53 to the millisecond', () => {
    // Precision below about 256 ns is already lost in a double, never a whole millisecond.
    expect(toEpochMs(Number(NS))).toBe(MS);
  });
  it('matches the recorded SPY daily bar timestamp (04:00Z on 2026-10-01 is a Massive daily bar)', () => {
    expect(toIsoUtc(1790827200000)).toBe('2026-10-01T04:00:00.000Z');
  });
});

describe('toDate and toIsoUtc', () => {
  it('formats UTC ISO strings', () => {
    expect(toDate(NS).toISOString()).toBe('2026-11-23T19:27:36.123Z');
    expect(toIsoUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02T03:04:05.000Z');
  });
  it('throws on an invalid date', () => {
    expect(() => toIsoUtc(new Date('nope'))).toThrow(RangeError);
  });
});
