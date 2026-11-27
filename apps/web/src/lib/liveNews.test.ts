import { describe, expect, it } from 'vitest';
import { NEW_TAG_MS, isNew } from './liveNews';

describe('isNew', () => {
  const arrived = new Map([
    ['a1', 1_000],
    ['0001045810-26-000123', 50_000],
  ]);
  it('is true while any source id arrived under a minute ago', () => {
    expect(isNew(['x', 'a1'], { arrived, now: 1_000 + NEW_TAG_MS - 1 })).toBe(true);
    expect(isNew(['0001045810-26-000123'], { arrived, now: 50_000 })).toBe(true);
  });
  it('is false at exactly one minute, and for ids that never arrived live', () => {
    expect(isNew(['a1'], { arrived, now: 1_000 + NEW_TAG_MS })).toBe(false);
    expect(isNew(['x'], { arrived, now: 1_000 })).toBe(false);
    expect(isNew([], { arrived, now: 1_000 })).toBe(false);
  });
});
