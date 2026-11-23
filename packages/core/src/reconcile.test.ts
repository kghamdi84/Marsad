import { describe, expect, it } from 'vitest';
import {
  buildReport,
  compareValues,
  reconcileFilings,
  reconcileTenYear,
  reconcileVixClose,
  reconcileVwap,
  reportAlerts,
} from './reconcile.js';

const NOW = new Date('2026-11-24T22:30:00Z');

describe('compareValues', () => {
  it('passes within the absolute tolerance and fails outside it', () => {
    expect(reconcileVixClose(27.91, 27.9).ok).toBe(true);
    const bad = reconcileVixClose(28.1, 27.9);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('differs by');
  });
  it('treats a missing side as a failure, never a pass', () => {
    const r = reconcileTenYear(null, 4.11);
    expect(r).toMatchObject({ ok: false, diff: null });
    expect(r.detail).toBe('vendor 10y is missing, cannot verify');
  });
  it('uses a relative tolerance for VWAP', () => {
    expect(reconcileVwap(100.05, 100).ok).toBe(true); // 0.05% off
    expect(reconcileVwap(100.2, 100).ok).toBe(false); // 0.2% off
  });
  it('takes the larger of absolute and relative allowances', () => {
    const r = compareValues(
      'x',
      { label: 'a', value: 1000.4 },
      { label: 'b', value: 1000 },
      { abs: 0.1, rel: 0.001 },
    );
    expect(r.tolerance).toBeCloseTo(1, 9);
    expect(r.ok).toBe(true);
  });
});

describe('reconcileFilings', () => {
  it('finds filings missing on either side', () => {
    const r = reconcileFilings({
      edgar: new Set(['a', 'b', 'c']),
      vendor: new Set(['b', 'c', 'd']),
    });
    expect(r).toEqual({ ok: false, missingFromVendor: ['a'], missingFromEdgar: ['d'] });
  });
  it('is ok when both agree', () => {
    expect(reconcileFilings({ edgar: new Set(['a']), vendor: new Set(['a']) }).ok).toBe(true);
  });
});

describe('report and alerts', () => {
  it('marks the failed quantities as affected and raises one critical alert each', () => {
    const report = buildReport(
      [reconcileVixClose(28.5, 27.9), reconcileTenYear(4.11, 4.11), reconcileVwap(null, 100)],
      NOW,
    );
    expect(report.affected).toEqual(['VIX close', 'VWAP']);
    const alerts = reportAlerts(report);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({
      kind: 'system',
      priority: 'critical',
      event: 'mismatch',
      source: 'reconciliation',
    });
    expect(alerts[0]?.headline.length).toBeLessThanOrEqual(90);
  });
  it('raises nothing when every check passes', () => {
    const report = buildReport([reconcileVixClose(27.9, 27.9)], NOW);
    expect(report.failed).toEqual([]);
    expect(reportAlerts(report)).toEqual([]);
  });
});
