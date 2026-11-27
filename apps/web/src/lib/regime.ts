import { SECTOR_ETFS, SECTOR_ROTATION_WINDOWS } from '@marsad/core';
import type {
  BreadthDay,
  CloseBar,
  CapitulationState,
  ComponentReading,
  Condition,
  FearGreedLabel,
  Obs,
  RecessionSignal,
  RegimeInputs,
  StagedPlan,
  TopicDay,
} from '@marsad/core';
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
  /** 90% bootstrap interval of the median (event-study-2); null for older rows and below 30 episodes. */
  ciLow: number | null;
  ciHigh: number | null;
  episodes: number;
  dataFrom: string;
  dataTo: string;
}

export interface StoredBreadthDay extends BreadthDay {
  advanceAvg10: number | null;
  zweigThrust: boolean;
  mcclellanOscillator: number | null;
  mcclellanSummation: number | null;
}

export interface StoredFearGreedDay {
  date: string;
  version: string;
  composite: number | null;
  label: FearGreedLabel | null;
  available: number;
  components: ComponentReading[];
}

export interface StoredCapitulation {
  /** The newest day. */
  latest: {
    date: string;
    version: string;
    state: CapitulationState;
    conditions: Condition[];
  } | null;
  /** The newest day the watch was on, if ever. */
  lastOn: string | null;
  /** The newest episode's staged-entry plan. */
  plan: StagedPlan | null;
}

export interface RegimeData {
  /** The past year of stored days, oldest first. */
  days: StoredRegimeDay[];
  /** The past year of Marsad universe breadth, oldest first. */
  breadth: StoredBreadthDay[];
  stats: StoredEventStat[];
  /** The trailing year of each panel series, oldest first. */
  series: Record<string, Obs[]>;
  gpr: Obs[];
  /** The last 30 composite days, oldest first. */
  fearGreed: StoredFearGreedDay[];
  capitulation: StoredCapitulation;
  /** The last 40 stored topic days, oldest first. */
  topics: TopicDay[];
  /** The trailing year of closes for each panel ticker, oldest first. */
  bars: Record<string, Obs[]>;
  /** The last 70 closes of SPY and each sector fund (sector rotation), oldest first. */
  sectorBars: Record<string, CloseBar[]>;
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
  'DCOILWTICO',
  'DTWEXBGS',
] as const;

/** Daily bars shown beside the topic counts (ADR 0012). */
export const PANEL_BARS = ['GLD', 'ITA', 'IYT'] as const;

/** SPY and the Select Sector SPDRs, for the sector rotation table (stored by the bars job). */
export const ROTATION_TICKERS = ['SPY', ...SECTOR_ETFS.map((s) => s.ticker)] as const;

/** Enough closes for the longest rotation window (63 sessions) plus a few missing days. */
const ROTATION_LIMIT = SECTOR_ROTATION_WINDOWS.m3 + 7;

const n = (v: unknown): number => Number(v);

async function recentBars(ticker: string): Promise<Obs[]> {
  const rows = check(
    await client()
      .from('daily_bars')
      .select('date, close')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(260),
    `daily_bars ${ticker}`,
  ) as Record<string, unknown>[];
  return rows.map((r) => ({ date: String(r['date']), value: n(r['close']) })).reverse();
}

async function rotationBars(ticker: string): Promise<CloseBar[]> {
  const rows = check(
    await client()
      .from('daily_bars')
      .select('date, close')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(ROTATION_LIMIT),
    `daily_bars ${ticker}`,
  ) as Record<string, unknown>[];
  return rows.map((r) => ({ date: String(r['date']), close: n(r['close']) })).reverse();
}

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
    client().from('breadth_daily').select('*').order('date', { ascending: false }).limit(260),
    client().from('gpr_daily').select('date, gprd').order('date', { ascending: false }).limit(260),
    client().from('fear_greed_daily').select('*').order('date', { ascending: false }).limit(30),
    client().from('capitulation_daily').select('*').order('date', { ascending: false }).limit(1),
    client()
      .from('capitulation_daily')
      .select('date')
      .eq('state', 'on')
      .order('date', { ascending: false })
      .limit(1),
    client()
      .from('capitulation_plans')
      .select('plan')
      .order('trigger_date', { ascending: false })
      .limit(1),
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
  type R = { data: unknown; error: { message: string } | null };
  const [breadthR, gprR, fgR, capR, capOnR, planR, ...seriesList] = rest as unknown as [
    R,
    R,
    R,
    R,
    R,
    R,
    ...Obs[][],
  ];
  const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const breadth: StoredBreadthDay[] = (
    check(breadthR as never, 'breadth_daily') as Record<string, unknown>[]
  )
    .map((r) => ({
      date: String(r['date']),
      version: String(r['version']),
      members: n(r['members']),
      withChange: n(r['with_change']),
      advancers: n(r['advancers']),
      decliners: n(r['decliners']),
      unchanged: n(r['unchanged']),
      upVolume: n(r['up_volume']),
      downVolume: n(r['down_volume']),
      above50: n(r['above50']),
      n50: n(r['n50']),
      above200: n(r['above200']),
      n200: n(r['n200']),
      newHighs: n(r['new_highs']),
      newLows: n(r['new_lows']),
      n252: n(r['n252']),
      suspect: n(r['suspect']),
      advanceAvg10: nn(r['advance_avg10']),
      zweigThrust: r['zweig_thrust'] === true,
      mcclellanOscillator: nn(r['mcclellan_oscillator']),
      mcclellanSummation: nn(r['mcclellan_summation']),
    }))
    .reverse();
  const gpr = (check(gprR as never, 'gpr_daily') as Record<string, unknown>[])
    .map((r) => ({ date: String(r['date']), value: n(r['gprd']) }))
    .reverse();
  const fearGreed: StoredFearGreedDay[] = (
    check(fgR as never, 'fear_greed_daily') as Record<string, unknown>[]
  )
    .map((r) => ({
      date: String(r['date']),
      version: String(r['version']),
      composite: nn(r['composite']),
      label: (r['label'] ?? null) as FearGreedLabel | null,
      available: n(r['available']),
      components: (r['components'] ?? []) as ComponentReading[],
    }))
    .reverse();
  const capRow = (check(capR as never, 'capitulation_daily') as Record<string, unknown>[])[0];
  const onRow = (check(capOnR as never, 'capitulation_daily') as Record<string, unknown>[])[0];
  const planRow = (check(planR as never, 'capitulation_plans') as Record<string, unknown>[])[0];
  const capitulation: StoredCapitulation = {
    latest: capRow
      ? {
          date: String(capRow['date']),
          version: String(capRow['version']),
          state: String(capRow['state']) as CapitulationState,
          conditions: (capRow['conditions'] ?? []) as Condition[],
        }
      : null,
    lastOn: onRow ? String(onRow['date']) : null,
    plan: planRow ? (planRow['plan'] as StagedPlan) : null,
  };
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
        ciLow: r['ci_low'] == null ? null : n(r['ci_low']),
        ciHigh: r['ci_high'] == null ? null : n(r['ci_high']),
        episodes: Array.isArray(r['episodes']) ? r['episodes'].length : 0,
        dataFrom: String(r['data_from']),
        dataTo: String(r['data_to']),
      }))
    : [];
  const [[topicsR, ...barLists], rotationLists] = await Promise.all([
    Promise.all([
      client().from('news_topic_days').select('*').order('date', { ascending: false }).limit(40),
      ...PANEL_BARS.map((t) => recentBars(t)),
    ]),
    Promise.all(ROTATION_TICKERS.map((t) => rotationBars(t))),
  ]);
  const sectorBars: Record<string, CloseBar[]> = {};
  ROTATION_TICKERS.forEach((t, i) => (sectorBars[t] = rotationLists[i] ?? []));
  const topics: TopicDay[] = (
    check(topicsR as never, 'news_topic_days') as Record<string, unknown>[]
  )
    .map((r) => ({
      date: String(r['date']),
      version: String(r['version']),
      total: n(r['total']),
      counts: r['counts'] as TopicDay['counts'],
      samples: r['samples'] as TopicDay['samples'],
    }))
    .reverse();
  const bars: Record<string, Obs[]> = {};
  PANEL_BARS.forEach((t, i) => (bars[t] = (barLists[i] as Obs[] | undefined) ?? []));
  return { days, breadth, stats, series, gpr, fearGreed, capitulation, topics, bars, sectorBars };
}
