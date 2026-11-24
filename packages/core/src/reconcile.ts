/**
 * Cross-source checks. Each compares a value from one source with the same quantity from an
 * independent source and reports whether they agree within a stated tolerance. A disagreement
 * becomes a system alert and marks the affected values, so a vendor error cannot pass silently.
 *
 * Tolerances are starting points chosen for each pair, documented here and tunable:
 * - VIX close vs FRED VIXCLS: 0.05 index points (both are the official close; rounding only).
 * - 10-year yield, vendor vs FRED DGS10: 0.02 percentage points (2 basis points).
 * - Vendor VWAP vs VWAP computed from minute bars: 0.1% (different bar sets can differ slightly).
 */
import type { SystemAlert } from './health.js';

export const TOLERANCES = {
  vixAbs: 0.05,
  yieldAbs: 0.02,
  vwapRel: 0.001,
} as const;

export interface CheckResult {
  name: string;
  ok: boolean;
  left: { label: string; value: number | null };
  right: { label: string; value: number | null };
  /** Absolute difference, or null if either side was missing. */
  diff: number | null;
  /** The tolerance applied, as an absolute number. */
  tolerance: number;
  /** Why it failed or could not be checked. */
  detail: string;
}

export interface CompareOptions {
  abs?: number;
  /** Relative to the right-hand value. When both are given, the larger allowance applies. */
  rel?: number;
}

/**
 * Compares two values. A missing side is a failure ("cannot verify"), never a pass: an unchecked
 * value must not look verified.
 */
export function compareValues(
  name: string,
  left: { label: string; value: number | null },
  right: { label: string; value: number | null },
  options: CompareOptions,
): CheckResult {
  const absTol = options.abs ?? 0;
  const relTol =
    options.rel !== undefined && right.value !== null ? Math.abs(right.value) * options.rel : 0;
  const tolerance = Math.max(absTol, relTol);
  if (left.value === null || right.value === null) {
    const missing = left.value === null ? left.label : right.label;
    return {
      name,
      ok: false,
      left,
      right,
      diff: null,
      tolerance,
      detail: `${missing} is missing, cannot verify`,
    };
  }
  const diff = Math.abs(left.value - right.value);
  const ok = diff <= tolerance;
  return {
    name,
    ok,
    left,
    right,
    diff,
    tolerance,
    detail: ok
      ? 'agrees'
      : `differs by ${diff.toPrecision(4)}, allowed ${tolerance.toPrecision(4)}`,
  };
}

export const reconcileVixClose = (vendor: number | null, fredVixcls: number | null): CheckResult =>
  compareValues(
    'VIX close',
    { label: 'vendor VIX', value: vendor },
    { label: 'FRED VIXCLS', value: fredVixcls },
    { abs: TOLERANCES.vixAbs },
  );

export const reconcileTenYear = (vendor: number | null, fredDgs10: number | null): CheckResult =>
  compareValues(
    '10-year yield',
    { label: 'vendor 10y', value: vendor },
    { label: 'FRED DGS10', value: fredDgs10 },
    { abs: TOLERANCES.yieldAbs },
  );

export const reconcileVwap = (vendor: number | null, computed: number | null): CheckResult =>
  compareValues(
    'VWAP',
    { label: 'vendor VWAP', value: vendor },
    { label: 'computed VWAP', value: computed },
    { rel: TOLERANCES.vwapRel },
  );

export interface FilingCompare {
  /** Accession numbers seen in each source. */
  edgar: ReadonlySet<string>;
  vendor: ReadonlySet<string>;
}

export interface FilingReconciliation {
  ok: boolean;
  missingFromVendor: string[];
  missingFromEdgar: string[];
}

/** Completeness: every filing in EDGAR (the authority) should appear in the vendor feed, and vice versa. */
export function reconcileFilings(c: FilingCompare): FilingReconciliation {
  const missingFromVendor = [...c.edgar].filter((a) => !c.vendor.has(a)).sort();
  const missingFromEdgar = [...c.vendor].filter((a) => !c.edgar.has(a)).sort();
  return {
    ok: missingFromVendor.length === 0 && missingFromEdgar.length === 0,
    missingFromVendor,
    missingFromEdgar,
  };
}

export interface ReconciliationReport {
  ranAt: string;
  checks: CheckResult[];
  failed: CheckResult[];
  /** Quantities that must be marked "unverified" in the UI until a later run passes. */
  affected: string[];
}

export function buildReport(checks: readonly CheckResult[], now: Date): ReconciliationReport {
  const failed = checks.filter((c) => !c.ok);
  return {
    ranAt: now.toISOString(),
    checks: [...checks],
    failed,
    affected: failed.map((c) => c.name),
  };
}

/** One system alert per failed check. */
export function reportAlerts(report: ReconciliationReport): SystemAlert[] {
  return report.failed.map((c) => ({
    kind: 'system',
    priority: 'critical',
    event: 'mismatch',
    source: 'reconciliation',
    headline: `${c.name} mismatch: ${c.detail}`.slice(0, 90),
    trigger: `${c.left.label} ${c.left.value ?? 'missing'} vs ${c.right.label} ${c.right.value ?? 'missing'}: ${c.detail}.`,
    pausedRules: [],
    lastGoodAt: null,
    createdAt: report.ranAt,
  }));
}
