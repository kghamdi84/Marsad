import type { Obs, RecessionSignal, RegimeInputs } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export interface StoredRegimeDay {
  date: string;
  ruleVersion: string;
  label: string;
  reason: string;
  inputs: RegimeInputs;
  recessionVersion: string;
  recessionLevel: string;
  available: number;
  triggered: number;
  signals: RecessionSignal[];
}

export interface StoredEventStat {
  condition: string;
  horizon: number;
  n: number;
  sufficient: boolean;
  median: number | null;
  q1: number | null;
  q3: number | null;
  episodes: number;
  dataFrom: string;
  dataTo: string;
}

export interface RegimeData {
  /** The past year of stored days, oldest first. */
  days: StoredRegimeDay[];
  stats: StoredEventStat[];
  /** The trailing year of each panel series, oldest first. */
  series: Record<string, Obs[]>;
  gpr: Obs[];
}

/** FRED series shown in the panels. */
export const PANEL_SERIES = [
  'VIXCLS',
  'VXVCLS',
  'BAMLH0A0HYM2',
  'BAMLC0A0CM',
  'DGS10',
  'T10Y3M',
  'T10Y2Y',
  'USEPUINDXD',
] as const;

const n = (v: unknown): number => Number(v);

async function recent(seriesId: string): Promise<Obs[]> {
  const rows = check(
    await client()
      .from('fred_observations')
      .select('date, value')
      .eq('series_id', seriesId)
      .not('value', 'is', null)
      .order('date', { ascending: false })
      .limit(260),
    `fred_observations ${seriesId}`,
  ) as Record<string, unknown>[];
  return rows.map((r) => ({ date: String(r['date']), value: n(r['value']) })).reverse();
}

/** Everything the Regime page shows. Every read goes through row-level security. */
export async function loadRegime(): Promise<RegimeData> {
  const [daysR, ...rest] = await Promise.all([
    client()
      .from('regime_daily')
      .select(
        'date, rule_version, label, reason, inputs, recession_version, recession_level, recession',
      )
      .order('date', { ascending: false })
      .limit(252),
    client().from('gpr_daily').select('date, gprd').order('date', { ascending: false }).limit(260),
    ...PANEL_SERIES.map((id) => recent(id)),
  ]);
  const days = (check(daysR, 'regime_daily') as Record<string, unknown>[])
    .map((r) => {
      const rec = (r['recession'] ?? {}) as Record<string, unknown>;
      return {
        date: String(r['date']),
        ruleVersion: String(r['rule_version']),
        label: String(r['label']),
        reason: String(r['reason']),
        inputs: r['inputs'] as RegimeInputs,
        recessionVersion: String(r['recession_version']),
        recessionLevel: String(r['recession_level']),
        available: n(rec['available'] ?? 0),
        triggered: n(rec['triggered'] ?? 0),
        signals: (rec['signals'] ?? []) as RecessionSignal[],
      };
    })
    .reverse();
  const [gprR, ...seriesList] = rest as [
    { data: unknown; error: { message: string } | null },
    ...Obs[][],
  ];
  const gpr = (check(gprR as never, 'gpr_daily') as Record<string, unknown>[])
    .map((r) => ({ date: String(r['date']), value: n(r['gprd']) }))
    .reverse();
  const series: Record<string, Obs[]> = {};
  PANEL_SERIES.forEach((id, i) => (series[id] = seriesList[i] ?? []));

  const version = days.at(-1)?.ruleVersion;
  const stats = version
    ? (
        check(
          await client().from('regime_event_stats').select('*').eq('rule_version', version),
          'regime_event_stats',
        ) as Record<string, unknown>[]
      ).map((r) => ({
        condition: String(r['condition']),
        horizon: n(r['horizon']),
        n: n(r['n']),
        sufficient: r['sufficient'] === true,
        median: r['median'] === null ? null : n(r['median']),
        q1: r['q1'] === null ? null : n(r['q1']),
        q3: r['q3'] === null ? null : n(r['q3']),
        episodes: Array.isArray(r['episodes']) ? r['episodes'].length : 0,
        dataFrom: String(r['data_from']),
        dataTo: String(r['data_to']),
      }))
    : [];
  return { days, stats, series, gpr };
}
