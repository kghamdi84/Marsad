/**
 * Geopolitical Risk Index (Caldara and Iacoviello, American Economic Review, 2022).
 * The authors publish the daily series as an .xls file
 * (https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls). A job converts the
 * sheet to rows; this module validates them. Columns used: date, GPRD (total), GPRD_ACT, GPRD_THREAT,
 * GPRD_MA7 and GPRD_MA30 (7 and 30 day moving averages).
 */

export interface GprDay {
  date: string; // YYYY-MM-DD
  gprd: number;
  act: number;
  threat: number;
  ma7: number | null;
  ma30: number | null;
}

export interface GprParse {
  days: GprDay[];
  skipped: { index: number; reason: string }[];
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseGprRows(rows: readonly Record<string, unknown>[]): GprParse {
  const days: GprDay[] = [];
  const skipped: GprParse['skipped'] = [];
  rows.forEach((r, index) => {
    const date = typeof r['date'] === 'string' ? r['date'].slice(0, 10) : '';
    const gprd = num(r['GPRD']);
    const act = num(r['GPRD_ACT']);
    const threat = num(r['GPRD_THREAT']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void skipped.push({ index, reason: 'bad date' });
    if (gprd === null || act === null || threat === null || gprd < 0) {
      return void skipped.push({ index, reason: 'missing or negative GPR value' });
    }
    days.push({ date, gprd, act, threat, ma7: num(r['GPRD_MA7']), ma30: num(r['GPRD_MA30']) });
  });
  return { days, skipped };
}

/** Percentile rank (0 to 100) of `value` within `history`: the share of history at or below it. */
export function percentileRank(value: number, history: readonly number[]): number | null {
  if (history.length === 0) return null;
  let atOrBelow = 0;
  for (const h of history) if (h <= value) atOrBelow += 1;
  return (100 * atOrBelow) / history.length;
}
