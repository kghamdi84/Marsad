import { describe, expect, it } from 'vitest';
import { buildExport, fnv1a } from './exports.js';
import { canonicalRule, ruleHash } from './rules.js';

describe('fnv1a', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    // From the FNV reference test suite (isthe.com/chongo/tech/comp/fnv): "" and "a" and "foobar".
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
  it('agrees with the rule hash on the same text', () => {
    const doc = {
      id: 'x',
      name: 'x',
      side: 'long' as const,
      entry: { left: { ind: 'close' as const }, op: '>' as const, right: 1 },
      exit: { left: { ind: 'close' as const }, op: '<' as const, right: 1 },
    };
    expect(fnv1a(canonicalRule(doc))).toBe(ruleHash(doc));
  });
});

describe('buildExport', () => {
  it('one file per table in a dated owner folder, and a manifest that checks them', () => {
    const at = new Date('2026-11-29T07:10:00Z');
    const { files, manifest } = buildExport('u1', at, {
      trades: [{ id: 1, ticker: 'RKLB' }],
      holdings: [],
    });
    expect(files.map((f) => f.path)).toEqual([
      'u1/2026-11-29/holdings.json',
      'u1/2026-11-29/trades.json',
      'u1/2026-11-29/manifest.json',
    ]);
    expect(manifest.tables).toEqual([
      { name: 'holdings', rows: 0, chars: files[0]!.body.length, fnv1a: fnv1a(files[0]!.body) },
      { name: 'trades', rows: 1, chars: files[1]!.body.length, fnv1a: fnv1a(files[1]!.body) },
    ]);
    expect(JSON.parse(files[1]!.body)).toEqual([{ id: 1, ticker: 'RKLB' }]);
    expect(JSON.parse(files[2]!.body)).toEqual(manifest);
  });
});
