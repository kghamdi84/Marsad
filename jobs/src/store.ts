import { createClient } from '@supabase/supabase-js';
import {
  SNAPSHOT_ENCODING,
  decodeList,
  decodeSnapshot,
  encodeList,
  encodeSnapshot,
  MIN_SNAPSHOT_DOLLAR_VOLUME,
} from './snapshot-codec.js';
import {
  PERSONAL_EXPORT_TABLES,
  SHARED_EXPORT_TABLES,
  etDate,
  STRENGTH_VERSION,
  type StrengthRank,
} from '@marsad/core';
import type {
  CatalystEvent,
  CatalystScenario,
  HoldingRef,
  Outcome,
  ScoredAlert,
  AnnualSection,
  BreadthDay,
  AlertInput,
  Brief,
  BreadthInput,
  CardSection,
  HaltRow,
  DailyBar,
  RuleDoc,
  RuleStatus,
  BreadthSignals,
  CapitulationDay,
  EarningsEstimate,
  EconEvent,
  FearGreedDay,
  MarketMovers,
  MoversSession,
  StagedPlan,
  TopicDay,
  MarketRow,
  ShareChange,
  Bar,
  CompanyRef,
  DividendRow,
  FinancialFact,
  Form4Document,
  NewsArticle,
  ShortInterestRow,
  ShortVolumeRow,
  Filing,
  FredObservation,
  GprDay,
  Halt,
  JobRunRecord,
  SourceHeartbeat,
  Split,
  SystemAlert,
  UpcomingRow,
} from '@marsad/core';

export interface SourceStatusUpdate {
  source: string;
  lastMessageAt: Date;
  latencyMs: number;
  planTier: 'real-time' | 'delayed' | 'end-of-day' | 'unavailable' | 'unknown';
  state: 'live' | 'delayed' | 'stale' | 'unavailable' | 'unknown';
  note: string;
}

/** The writes jobs need. Implemented over Supabase here and by fakes in tests. */
export interface Store {
  upsertGprDays(days: readonly GprDay[], fetchedAt: Date): Promise<number>;
  upsertFredObservations(
    series: string,
    observations: readonly FredObservation[],
    fetchedAt: Date,
  ): Promise<number>;
  upsertMarketHolidays(rows: readonly UpcomingRow[], fetchedAt: Date): Promise<number>;
  upsertSplits(splits: readonly Split[], fetchedAt: Date): Promise<number>;
  /** Stored FRED observations for a series between two dates, inclusive, oldest first. */
  getFredRange(series: string, from: string, to: string): Promise<FredObservation[]>;
  upsertInstruments(companies: readonly CompanyRef[]): Promise<number>;
  upsertFilings(cik: string, filings: readonly Filing[], fetchedAt: Date): Promise<number>;
  upsertHalts(halts: readonly Halt[], seenAt: Date): Promise<number>;
  /** Daily bars keyed by ticker and ET date; `bars` carry the epoch ms of each ET midnight. */
  upsertDailyBars(ticker: string, bars: readonly Bar[], fetchedAt: Date): Promise<number>;
  /** The instruments (issuer CIK and ticker) the SEC job has stored. */
  getInstruments(): Promise<{ cik: string; ticker: string }[]>;
  upsertFinancialFacts(
    cik: string,
    facts: readonly FinancialFact[],
    fetchedAt: Date,
  ): Promise<number>;
  /** Form 4 filings already stored in `filings` that have not been read yet, newest first. */
  getUnreadInsiderFilings(limit: number): Promise<InsiderCandidate[]>;
  saveInsiderFiling(result: InsiderResult): Promise<number>;
  upsertNewsArticles(articles: readonly NewsArticle[], fetchedAt: Date): Promise<number>;
  upsertShortInterest(rows: readonly ShortInterestRow[], fetchedAt: Date): Promise<number>;
  upsertShortVolume(rows: readonly ShortVolumeRow[], fetchedAt: Date): Promise<number>;
  upsertDividends(rows: readonly DividendRow[], fetchedAt: Date): Promise<number>;
  upsertAnnualSections(rows: readonly AnnualSection[], fetchedAt: Date): Promise<number>;
  upsertRegimeDays(rows: readonly RegimeRow[]): Promise<number>;
  /** Every stored market snapshot date, with whether the market was closed that day. */
  getSnapshotDates(): Promise<{ date: string; closed: boolean }[]>;
  saveSnapshot(date: string, rows: readonly MarketRow[], fetchedAt: Date): Promise<number>;
  /** Snapshots on or after `from`, oldest first, decoded. Closed days are left out. */
  loadSnapshots(from: string): Promise<{ date: string; rows: MarketRow[] }[]>;
  getTickerTypeSnapshots(): Promise<{ asOf: string; cs: string[]; etf: string[] }[]>;
  saveTickerTypeSnapshot(
    asOf: string,
    cs: readonly string[],
    etf: readonly string[],
  ): Promise<void>;
  /** All stored splits executed on or after `from` (every ticker). */
  getShareChanges(from: string): Promise<ShareChange[]>;
  upsertUniverse(version: string, rows: readonly UniverseRow[]): Promise<number>;
  upsertBreadthDays(rows: readonly BreadthRow[]): Promise<number>;
  replaceEventStats(ruleVersion: string, rows: readonly EventStatRow[]): Promise<number>;
  /** Breadth fields the sentiment job reads, on or after `from`, oldest first. */
  getBreadthInputs(from: string): Promise<SentimentBreadthRow[]>;
  /** Stored daily bars (date, low, close) of one ticker, oldest first. */
  getDailyCloses(ticker: string): Promise<DailyClose[]>;
  /** The stored recession level of every regime day on or after `from`, oldest first. */
  getRecessionLevels(from: string): Promise<{ date: string; level: string }[]>;
  upsertFearGreedDays(rows: readonly FearGreedDay[]): Promise<number>;
  upsertCapitulationDays(rows: readonly CapitulationDay[]): Promise<number>;
  upsertCapitulationPlans(rows: readonly StagedPlan[]): Promise<number>;
  /** Dates of 8-K results filings (item 2.02) per issuer CIK, oldest first. */
  getResultsFilingDates(): Promise<{ cik: string; date: string }[]>;
  saveEconCalendar(
    at: Date,
    version: string,
    from: string,
    to: string,
    events: readonly EconEvent[],
  ): Promise<void>;
  saveEarningsEstimates(
    at: Date,
    version: string,
    rows: readonly EarningsEstimateRow[],
  ): Promise<void>;
  upsertMovers(rows: readonly StoredMovers[]): Promise<number>;
  /** The universe strength ranks of one session (strength-1). */
  upsertStrengthRanks(date: string, rows: readonly StrengthRank[]): Promise<number>;
  /** Halts whose halt time is on or after `since`. */
  getRecentHalts(since: string): Promise<HaltRow[]>;
  /** Tickers on any saved watchlist. */
  getWatchlistTickers(): Promise<string[]>;
  /** Dedupe keys and times of alerts created on or after `since`, and how many were pushed. */
  getRecentAlerts(since: string): Promise<{ key: string; at: string; decision: string }[]>;
  insertAlerts(rows: readonly StoredAlert[]): Promise<number>;
  /** The owner's quiet hours and daily push cap (alert_preferences), or null when none are saved. */
  getAlertPreferences(): Promise<{
    quietStart: string;
    quietEnd: string;
    dailyPushCap: number;
  } | null>;
  /** Full stored daily bars of one ticker, oldest first. */
  getDailyBars(ticker: string): Promise<DailyBar[]>;
  /** When the newest stored bar of a ticker was fetched, or null without bars. */
  getBarsFetchedAt(ticker: string): Promise<string | null>;
  /** Directional-or-not alerts since an instant (suppressed signals left out), for the scorecard. */
  getAlertsForScoring(since: string): Promise<ScoredAlert[]>;
  /** Keys `alertId|horizon` of outcomes already finished. */
  getFinishedOutcomeKeys(alertIds: readonly string[]): Promise<Set<string>>;
  upsertOutcomes(rows: readonly Outcome[], version: string): Promise<number>;
  /** Stored outcomes of these alerts. */
  getOutcomes(alertIds: readonly string[]): Promise<Outcome[]>;
  /** Every row of an export table (allow-listed), oldest first by its natural order. */
  exportRows(table: string): Promise<Record<string, unknown>[]>;
  /** Writes one export file to the private exports bucket (replacing a file of the same path). */
  uploadExport(path: string, body: string): Promise<void>;
  /** Open holdings of every owner (the app has one), with their row ids. */
  getOpenHoldings(): Promise<HoldingRef[]>;
  /** Active catalyst scenarios not expired before `today` (every owner; the app has one). */
  getActiveScenarios(today: string): Promise<CatalystScenario[]>;
  /** Filings, Form 4 transactions and news since an instant, as catalyst events, plus halts. */
  getCatalystEvents(since: string): Promise<CatalystEvent[]>;
  /** Stored 8-K filings carrying any of these items for these tickers (the analog count). */
  countEightKAnalogs(tickers: readonly string[], items: readonly string[]): Promise<number>;
  /** Regime label of every stored day on or after `from`. */
  getRegimeLabels(from: string): Promise<{ date: string; label: string }[]>;
  getRuleVersions(id: string): Promise<{ version: number; hash: string; status: RuleStatus }[]>;
  insertRuleVersion(row: {
    id: string;
    version: number;
    hash: string;
    doc: RuleDoc;
    source: 'playbook' | 'user';
  }): Promise<void>;
  setRuleStatus(
    id: string,
    version: number,
    from: RuleStatus,
    to: RuleStatus,
    reason: string,
    evidence: Record<string, unknown>,
  ): Promise<void>;
  saveBacktestRun(row: {
    ruleId: string;
    version: number;
    engine: string;
    params: Record<string, unknown>;
    trials: number;
    report: Record<string, unknown>;
  }): Promise<void>;
  /** The newest rows of one allow-listed table, newest first (the brief job's reads). */
  latest(
    table: LatestTable,
    columns: string,
    orderBy: string,
    limit: number,
  ): Promise<Record<string, unknown>[]>;
  saveBrief(brief: Brief, inputs: unknown, delivery: Record<string, string>): Promise<void>;
  /** UTC dates already stored in news_topic_days. */
  getTopicDates(): Promise<string[]>;
  upsertTopicDays(rows: readonly TopicDay[], fetchedAt: Date): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
  updateSourceStatus(update: SourceStatusUpdate): Promise<void>;
  /** Last message time of every source in `source_status`. */
  getSourceHeartbeats(): Promise<SourceHeartbeat[]>;
  /** Market holidays and early closes for one exchange, as the calendar builder reads them. */
  getHolidays(exchange: string): Promise<UpcomingRow[]>;
  /** The newest stale or recovered event per source: the heartbeat's previous state. */
  getLatestHealthEvents(): Promise<Record<string, 'stale' | 'recovered'>>;
  insertSystemAlerts(
    alerts: readonly SystemAlert[],
    policyVersion: string,
    snapshots: readonly Record<string, unknown>[],
  ): Promise<number>;
}

/** One session's universe movers (watch-1) with the whole-market movers (movers-1, ADR 0049). */
export type StoredMovers = MarketMovers & { market: MoversSession | null };

export interface UniverseRow {
  monthStart: string;
  ticker: string;
  rank: number;
  dollarVolume: number;
}

/** One alert as stored: its input snapshot, decision, card and push text. */
export interface StoredAlert {
  version: string;
  input: AlertInput;
  key: string;
  decision: string;
  reasons: string[];
  card: CardSection[];
  push: { title: string; body: string };
  sourceAt: string | null;
  createdAt: string;
  delivery: Record<string, string>;
}

/** Tables the brief job may read with `latest`. */
export const LATEST_TABLES = [
  'regime_daily',
  'fear_greed_daily',
  'capitulation_daily',
  'regime_event_stats',
  'breadth_daily',
  'fred_observations',
  'econ_calendar_snapshots',
  'earnings_estimate_snapshots',
  'news_topic_days',
  'source_status',
  'daily_bars',
  'briefs',
] as const;
export type LatestTable = (typeof LATEST_TABLES)[number];

/** One watchlist company's estimated next results release. */
export interface EarningsEstimateRow extends EarningsEstimate {
  ticker: string;
  cik: string;
}

/** The breadth fields the composite and the capitulation watch read. */
export type SentimentBreadthRow = BreadthInput & { above50: number; n50: number };

export interface DailyClose {
  date: string;
  low: number;
  close: number;
}

/** One breadth day with its series-level signals. */
export type BreadthRow = BreadthDay & Omit<BreadthSignals, 'date'>;

/** One stored regime day: the label, its inputs and the recession filter, with both rule versions. */
export interface RegimeRow {
  date: string;
  ruleVersion: string;
  label: string;
  reason: string;
  inputs: Record<string, unknown>;
  recessionVersion: string;
  recessionLevel: string;
  recession: Record<string, unknown>;
}

export interface EventStatRow {
  condition: string;
  horizon: number;
  n: number;
  sufficient: boolean;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  /** 90% bootstrap interval of the median (event-study-2). */
  ciLow: number | null;
  ciHigh: number | null;
  episodes: string[];
  dataFrom: string;
  dataTo: string;
}

export interface InsiderCandidate {
  accession: string;
  cik: string;
  primaryDocument: string;
  acceptedAt: string | null;
}

export type InsiderResult =
  | {
      status: 'ok';
      accession: string;
      issuerCik: string;
      filedAt: string | null;
      doc: Form4Document;
    }
  | {
      status: 'error';
      accession: string;
      issuerCik: string;
      filedAt: string | null;
      error: string;
    };

const CHUNK = 1000;

export function supabaseStore(url: string, secretKey: string): Store {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async upsertGprDays(days, fetchedAt) {
      let written = 0;
      for (let i = 0; i < days.length; i += CHUNK) {
        const rows = days.slice(i, i + CHUNK).map((d) => ({
          date: d.date,
          gprd: d.gprd,
          gprd_act: d.act,
          gprd_threat: d.threat,
          gprd_ma7: d.ma7,
          gprd_ma30: d.ma30,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('gpr_daily').upsert(rows, { onConflict: 'date' });
        if (error) throw new Error(`gpr_daily upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertFredObservations(series, observations, fetchedAt) {
      let written = 0;
      for (let i = 0; i < observations.length; i += CHUNK) {
        const rows = observations.slice(i, i + CHUNK).map((o) => ({
          series_id: series,
          date: o.date,
          value: o.value,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db
          .from('fred_observations')
          .upsert(rows, { onConflict: 'series_id,date' });
        if (error) throw new Error(`fred_observations upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertMarketHolidays(rows, fetchedAt) {
      const out = rows.map((r) => ({
        date: r.date,
        exchange: r.exchange,
        name: r.name,
        status: r.status,
        open_at: r.open ?? null,
        close_at: r.close ?? null,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db
        .from('market_holidays')
        .upsert(out, { onConflict: 'exchange,date' });
      if (error) throw new Error(`market_holidays upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertSplits(splits, fetchedAt) {
      const out = splits
        .filter((s) => s.vendorId !== undefined)
        .map((s) => ({
          vendor_id: s.vendorId,
          ticker: s.ticker,
          execution_date: s.executionDate,
          split_from: s.splitFrom,
          split_to: s.splitTo,
          adjustment_type: s.adjustmentType,
          historical_adjustment_factor: s.historicalAdjustmentFactor ?? null,
          fetched_at: fetchedAt.toISOString(),
        }));
      if (out.length === 0) return 0;
      const { error } = await db.from('splits').upsert(out, { onConflict: 'vendor_id' });
      if (error) throw new Error(`splits upsert failed: ${error.message}`);
      return out.length;
    },
    async getFredRange(series, from, to) {
      // Paged: the API returns at most 1,000 rows a request, and a long range (VIX since 1990) has about 9,600.
      const out: { date: string; value: number | null }[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('fred_observations')
          .select('date, value')
          .eq('series_id', series)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`fred_observations read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({ date: r.date as string, value: r.value === null ? null : Number(r.value) });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async upsertInstruments(companies) {
      if (companies.length === 0) return 0;
      const rows = companies.map((c) => ({ cik: c.cik, ticker: c.ticker, name: c.name || null }));
      const { error } = await db.from('instruments').upsert(rows, { onConflict: 'cik' });
      if (error) throw new Error(`instruments upsert failed: ${error.message}`);
      return rows.length;
    },
    async upsertFilings(cik, filings, fetchedAt) {
      let written = 0;
      for (let i = 0; i < filings.length; i += CHUNK) {
        const rows = filings.slice(i, i + CHUNK).map((f) => ({
          accession: f.accession,
          cik,
          form: f.form,
          filing_date: f.filingDate,
          accepted_at: f.acceptedAt,
          primary_document: f.primaryDocument,
          items: f.items,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('filings').upsert(rows, { onConflict: 'accession' });
        if (error) throw new Error(`filings upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertHalts(halts, seenAt) {
      if (halts.length === 0) return 0;
      const rows = halts.map((h) => ({
        symbol: h.symbol,
        halted_at: h.haltedAt.toISOString(),
        name: h.name || null,
        market: h.market || null,
        reason_code: h.reasonCode,
        reason_meaning: h.reasonMeaning,
        news_related: h.newsRelated,
        resumption_quote_at: h.resumptionQuoteAt?.toISOString() ?? null,
        resumption_trade_at: h.resumptionTradeAt?.toISOString() ?? null,
        pause_threshold_price: h.pauseThresholdPrice,
        active: h.active,
        last_seen_at: seenAt.toISOString(),
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db
          .from('halts')
          .upsert(rows.slice(i, i + CHUNK), { onConflict: 'symbol,halted_at' });
        if (error) throw new Error(`halts upsert failed: ${error.message}`);
      }
      return rows.length;
    },
    async upsertDailyBars(ticker, bars, fetchedAt) {
      let written = 0;
      for (let i = 0; i < bars.length; i += CHUNK) {
        const rows = bars.slice(i, i + CHUNK).map((b) => ({
          ticker,
          date: etDate(new Date(b.t)),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
          vwap: b.vw ?? null,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('daily_bars').upsert(rows, { onConflict: 'ticker,date' });
        if (error) throw new Error(`daily_bars upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async recordRun(run) {
      const { error } = await db.from('job_runs').insert(run);
      if (error) throw new Error(`job_runs insert failed: ${error.message}`);
    },
    async updateSourceStatus(u) {
      const { error } = await db
        .from('source_status')
        .update({
          last_message_at: u.lastMessageAt.toISOString(),
          last_latency_ms: u.latencyMs,
          plan_tier: u.planTier,
          state: u.state,
          note: u.note,
          updated_at: new Date().toISOString(),
        })
        .eq('source', u.source);
      if (error) throw new Error(`source_status update failed: ${error.message}`);
    },
    async getSourceHeartbeats() {
      const { data, error } = await db.from('source_status').select('source, last_message_at');
      if (error) throw new Error(`source_status read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        source: r.source as string,
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at as string) : null,
      }));
    },
    async getHolidays(exchange) {
      const { data, error } = await db
        .from('market_holidays')
        .select('date, exchange, name, status, open_at, close_at')
        .eq('exchange', exchange);
      if (error) throw new Error(`market_holidays read failed: ${error.message}`);
      return (data ?? []).map((h) => ({
        date: h.date as string,
        exchange: h.exchange as string,
        name: h.name as string,
        status: h.status as string,
        ...(h.open_at ? { open: h.open_at as string } : {}),
        ...(h.close_at ? { close: h.close_at as string } : {}),
      }));
    },
    async getLatestHealthEvents() {
      const { data, error } = await db
        .from('system_alerts')
        .select('source, event, created_at')
        .in('event', ['stale', 'recovered'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw new Error(`system_alerts read failed: ${error.message}`);
      const out: Record<string, 'stale' | 'recovered'> = {};
      for (const r of data ?? []) {
        const source = r.source as string;
        if (!(source in out)) out[source] = r.event as 'stale' | 'recovered';
      }
      return out;
    },
    async insertSystemAlerts(alerts, policyVersion, snapshots) {
      if (alerts.length === 0) return 0;
      const rows = alerts.map((a, i) => ({
        event: a.event,
        source: a.source,
        priority: a.priority,
        headline: a.headline,
        trigger: a.trigger,
        paused_rules: [...a.pausedRules],
        last_good_at: a.lastGoodAt,
        created_at: a.createdAt,
        policy_version: policyVersion,
        snapshot: snapshots[i] ?? {},
        // Every system alert is critical: pushed (ADR 0031) and copied by email (ADR 0032).
        delivery: { push: 'pending', email: 'pending', telegram: 'pending' },
      }));
      const { error } = await db.from('system_alerts').insert(rows);
      if (error) throw new Error(`system_alerts insert failed: ${error.message}`);
      return rows.length;
    },
    async getInstruments() {
      const { data, error } = await db
        .from('instruments')
        .select('cik, ticker')
        .not('cik', 'is', null);
      if (error) throw new Error(`instruments read failed: ${error.message}`);
      return (data ?? []).map((r) => ({ cik: r.cik as string, ticker: r.ticker as string }));
    },
    async upsertFinancialFacts(cik, facts, fetchedAt) {
      let written = 0;
      for (let i = 0; i < facts.length; i += CHUNK) {
        const rows = facts.slice(i, i + CHUNK).map((f) => ({
          fact_key: [cik, f.taxonomy, f.concept, f.unit, f.start ?? '', f.end, f.accession].join(
            '|',
          ),
          cik,
          taxonomy: f.taxonomy,
          concept: f.concept,
          unit: f.unit,
          period_start: f.start,
          period_end: f.end,
          value: f.value,
          accession: f.accession,
          form: f.form,
          fiscal_year: f.fy,
          fiscal_period: f.fp,
          filed: f.filed,
          frame: f.frame,
          fetched_at: fetchedAt.toISOString(),
        }));
        const { error } = await db.from('financial_facts').upsert(rows, { onConflict: 'fact_key' });
        if (error) throw new Error(`financial_facts upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async getUnreadInsiderFilings(limit) {
      // Forms 3, 4 and 5 and their amendments. Newest first, so a fresh Form 4 is read before an old Form 3.
      const { data, error } = await db
        .from('filings')
        .select('accession, cik, primary_document, accepted_at')
        .in('form', ['3', '3/A', '4', '4/A', '5', '5/A'])
        .not('primary_document', 'is', null)
        .order('accepted_at', { ascending: false })
        .limit(600);
      if (error) throw new Error(`filings read failed: ${error.message}`);
      const rows = data ?? [];
      // Asked in chunks: a few hundred accession numbers in one address would be too long for the API.
      const done = new Set<string>();
      for (let i = 0; i < rows.length; i += 150) {
        const seen = await db
          .from('insider_filings')
          .select('accession')
          .in(
            'accession',
            rows.slice(i, i + 150).map((r) => r.accession as string),
          );
        if (seen.error) throw new Error(`insider_filings read failed: ${seen.error.message}`);
        for (const r of seen.data ?? []) done.add(r.accession as string);
      }
      return rows
        .filter((r) => !done.has(r.accession as string))
        .slice(0, limit)
        .map((r) => ({
          accession: r.accession as string,
          cik: r.cik as string,
          primaryDocument: r.primary_document as string,
          acceptedAt: (r.accepted_at as string | null) ?? null,
        }));
    },
    async saveInsiderFiling(res) {
      if (res.status === 'error') {
        const { error } = await db.from('insider_filings').upsert(
          {
            accession: res.accession,
            issuer_cik: res.issuerCik,
            status: 'error',
            error: res.error.slice(0, 500),
            filed_at: res.filedAt,
            parsed_at: new Date().toISOString(),
          },
          { onConflict: 'accession' },
        );
        if (error) throw new Error(`insider_filings upsert failed: ${error.message}`);
        return 0;
      }
      const owner = res.doc.owners[0];
      const head = await db.from('insider_filings').upsert(
        {
          accession: res.accession,
          issuer_cik: res.issuerCik,
          status: 'ok',
          error: null,
          document_type: res.doc.documentType,
          period_of_report: res.doc.periodOfReport,
          owner_cik: owner?.cik ?? null,
          owner_name: owner?.name ?? null,
          is_director: owner?.isDirector ?? null,
          is_officer: owner?.isOfficer ?? null,
          officer_title: owner?.officerTitle ?? null,
          is_ten_percent_owner: owner?.isTenPercentOwner ?? null,
          co_owners: res.doc.owners.slice(1).map((o) => o.name),
          no_securities_owned: res.doc.noSecuritiesOwned,
          original_submission: res.doc.dateOfOriginalSubmission,
          plan_10b5: res.doc.plan10b5,
          filed_at: res.filedAt,
          parsed_at: new Date().toISOString(),
        },
        { onConflict: 'accession' },
      );
      if (head.error) throw new Error(`insider_filings upsert failed: ${head.error.message}`);
      let written = 0;
      if (res.doc.transactions.length > 0) {
        const rows = res.doc.transactions.map((t, i) => ({
          accession: res.accession,
          line: i + 1,
          table_kind: t.table,
          security_title: t.securityTitle,
          trade_date: t.date,
          code: t.code,
          shares: t.shares,
          price_per_share: t.pricePerShare,
          acquired_disposed: t.acquiredDisposed,
          shares_after: t.sharesAfter,
          ownership: t.ownership,
          exercise_price: t.exercisePrice,
          value_usd: t.valueUsd,
          footnotes: t.footnotes,
        }));
        const { error } = await db
          .from('insider_transactions')
          .upsert(rows, { onConflict: 'accession,line' });
        if (error) throw new Error(`insider_transactions upsert failed: ${error.message}`);
        written += rows.length;
      }
      if (res.doc.holdings.length > 0) {
        const rows = res.doc.holdings.map((h, i) => ({
          accession: res.accession,
          line: i + 1,
          table_kind: h.table,
          security_title: h.securityTitle,
          shares: h.shares,
          ownership: h.ownership,
          nature_of_ownership: h.natureOfOwnership,
          exercise_price: h.exercisePrice,
          exercise_date: h.exerciseDate,
          expiration_date: h.expirationDate,
          underlying_title: h.underlyingTitle,
          underlying_shares: h.underlyingShares,
          footnotes: h.footnotes,
        }));
        const { error } = await db
          .from('insider_holdings')
          .upsert(rows, { onConflict: 'accession,line' });
        if (error) throw new Error(`insider_holdings upsert failed: ${error.message}`);
        written += rows.length;
      }
      return written;
    },
    async upsertNewsArticles(articles, fetchedAt) {
      if (articles.length === 0) return 0;
      const rows = articles.map((a) => ({
        id: a.id,
        published_at: a.publishedAt,
        publisher: a.publisher,
        title: a.title,
        url: a.url,
        author: a.author,
        tickers: a.tickers,
        description: a.description,
        sentiment: a.sentiment,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db.from('news_articles').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`news_articles upsert failed: ${error.message}`);
      return rows.length;
    },
    async upsertShortInterest(rows, fetchedAt) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        ticker: r.ticker,
        settlement_date: r.settlementDate,
        short_interest: r.shortInterest,
        avg_daily_volume: r.avgDailyVolume,
        days_to_cover: r.daysToCover,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db
        .from('short_interest')
        .upsert(out, { onConflict: 'ticker,settlement_date' });
      if (error) throw new Error(`short_interest upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertShortVolume(rows, fetchedAt) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        ticker: r.ticker,
        date: r.date,
        total_volume: r.totalVolume,
        short_volume: r.shortVolume,
        short_volume_ratio: r.shortVolumeRatio,
        exempt_volume: r.exemptVolume,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db.from('short_volume').upsert(out, { onConflict: 'ticker,date' });
      if (error) throw new Error(`short_volume upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertDividends(rows, fetchedAt) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        id: r.id,
        ticker: r.ticker,
        ex_dividend_date: r.exDividendDate,
        record_date: r.recordDate,
        pay_date: r.payDate,
        declaration_date: r.declarationDate,
        cash_amount: r.cashAmount,
        currency: r.currency,
        frequency: r.frequency,
        distribution_type: r.distributionType,
        split_adjusted_cash_amount: r.splitAdjustedCashAmount,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db.from('dividends').upsert(out, { onConflict: 'id' });
      if (error) throw new Error(`dividends upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertAnnualSections(rows, fetchedAt) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        cik: r.cik,
        ticker: r.ticker,
        section: r.section,
        period_end: r.periodEnd,
        filing_date: r.filingDate,
        filing_url: r.filingUrl,
        text: r.text,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db
        .from('annual_sections')
        .upsert(out, { onConflict: 'cik,section,period_end' });
      if (error) throw new Error(`annual_sections upsert failed: ${error.message}`);
      return out.length;
    },
    async getSnapshotDates() {
      const out: { date: string; closed: boolean }[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('market_snapshots')
          .select('date, encoding')
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`market_snapshots read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows) out.push({ date: r.date as string, closed: r.encoding === 'closed' });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async saveSnapshot(date, rows, fetchedAt) {
      const closed = rows.length === 0;
      const enc = closed ? { payload: '', tickers: 0 } : encodeSnapshot(rows);
      const { error } = await db.from('market_snapshots').upsert(
        {
          date,
          adjusted: false,
          tickers: enc.tickers,
          min_dollar_volume: MIN_SNAPSHOT_DOLLAR_VOLUME,
          encoding: closed ? 'closed' : SNAPSHOT_ENCODING,
          payload: enc.payload,
          fetched_at: fetchedAt.toISOString(),
        },
        { onConflict: 'date' },
      );
      if (error) throw new Error(`market_snapshots upsert failed: ${error.message}`);
      return enc.tickers;
    },
    async loadSnapshots(from) {
      const out: { date: string; rows: MarketRow[] }[] = [];
      // About 100 KB a row, so a few dozen rows per request.
      for (let start = 0; ; start += 50) {
        const { data, error } = await db
          .from('market_snapshots')
          .select('date, encoding, payload')
          .gte('date', from)
          .neq('encoding', 'closed')
          .order('date', { ascending: true })
          .range(start, start + 49);
        if (error) throw new Error(`market_snapshots read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows) {
          if (r.encoding !== SNAPSHOT_ENCODING)
            throw new Error(
              `market_snapshots ${String(r.date)}: unknown encoding ${String(r.encoding)}`,
            );
          out.push({ date: r.date as string, rows: decodeSnapshot(r.payload as string) });
        }
        if (rows.length < 50) break;
      }
      return out;
    },
    async getTickerTypeSnapshots() {
      const { data, error } = await db
        .from('ticker_type_snapshots')
        .select('as_of, payload')
        .order('as_of', { ascending: true });
      if (error) throw new Error(`ticker_type_snapshots read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        asOf: r.as_of as string,
        ...decodeList(r.payload as string),
      }));
    },
    async saveTickerTypeSnapshot(asOf, cs, etf) {
      const { error } = await db.from('ticker_type_snapshots').upsert(
        {
          as_of: asOf,
          common_stocks: cs.length,
          etfs: etf.length,
          encoding: SNAPSHOT_ENCODING,
          payload: encodeList({ cs, etf }),
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'as_of' },
      );
      if (error) throw new Error(`ticker_type_snapshots upsert failed: ${error.message}`);
    },
    async getShareChanges(from) {
      const out: ShareChange[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('splits')
          .select('ticker, execution_date, split_from, split_to')
          .gte('execution_date', from)
          .order('execution_date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`splits read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({
            ticker: r.ticker as string,
            executionDate: r.execution_date as string,
            splitFrom: Number(r.split_from),
            splitTo: Number(r.split_to),
          });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async upsertUniverse(version, rows) {
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000).map((r) => ({
          version,
          month_start: r.monthStart,
          ticker: r.ticker,
          rank: r.rank,
          dollar_volume: r.dollarVolume,
        }));
        const { error } = await db
          .from('universe_members')
          .upsert(chunk, { onConflict: 'version,month_start,ticker' });
        if (error) throw new Error(`universe_members upsert failed: ${error.message}`);
      }
      return rows.length;
    },
    async upsertBreadthDays(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          date: r.date,
          version: r.version,
          members: r.members,
          with_change: r.withChange,
          advancers: r.advancers,
          decliners: r.decliners,
          unchanged: r.unchanged,
          up_volume: r.upVolume,
          down_volume: r.downVolume,
          above50: r.above50,
          n50: r.n50,
          above200: r.above200,
          n200: r.n200,
          new_highs: r.newHighs,
          new_lows: r.newLows,
          n252: r.n252,
          suspect: r.suspect,
          advance_avg10: r.advanceAvg10,
          zweig_thrust: r.zweigThrust,
          volume_ratio: r.volumeRatio,
          mcclellan_oscillator: r.mcclellanOscillator,
          mcclellan_summation: r.mcclellanSummation,
          computed_at: new Date().toISOString(),
        }));
        const { error } = await db.from('breadth_daily').upsert(chunk, { onConflict: 'date' });
        if (error) throw new Error(`breadth_daily upsert failed: ${error.message}`);
      }
      return rows.length;
    },
    async getBreadthInputs(from) {
      const out: SentimentBreadthRow[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('breadth_daily')
          .select('date, new_highs, new_lows, n252, mcclellan_summation, above50, n50')
          .gte('date', from)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`breadth_daily read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({
            date: r.date as string,
            newHighs: Number(r.new_highs),
            newLows: Number(r.new_lows),
            n252: Number(r.n252),
            mcclellanSummation:
              r.mcclellan_summation === null ? null : Number(r.mcclellan_summation),
            above50: Number(r.above50),
            n50: Number(r.n50),
          });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getDailyCloses(ticker) {
      const out: DailyClose[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('daily_bars')
          .select('date, low, close')
          .eq('ticker', ticker)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`daily_bars read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({ date: r.date as string, low: Number(r.low), close: Number(r.close) });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getRecessionLevels(from) {
      const out: { date: string; level: string }[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('regime_daily')
          .select('date, recession_level')
          .gte('date', from)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`regime_daily read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({ date: r.date as string, level: String(r.recession_level) });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async upsertFearGreedDays(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          date: r.date,
          version: r.version,
          composite: r.composite,
          label: r.label,
          available: r.available,
          components: r.components,
          computed_at: new Date().toISOString(),
        }));
        const { error } = await db.from('fear_greed_daily').upsert(chunk, { onConflict: 'date' });
        if (error) throw new Error(`fear_greed_daily upsert failed: ${error.message}`);
      }
      return rows.length;
    },
    async upsertCapitulationDays(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          date: r.date,
          version: r.version,
          state: r.state,
          conditions: r.conditions,
          computed_at: new Date().toISOString(),
        }));
        const { error } = await db.from('capitulation_daily').upsert(chunk, { onConflict: 'date' });
        if (error) throw new Error(`capitulation_daily upsert failed: ${error.message}`);
      }
      return rows.length;
    },
    async upsertCapitulationPlans(rows) {
      if (rows.length === 0) return 0;
      const out = rows.map((p) => ({
        trigger_date: p.triggerDate,
        version: p.version,
        plan: p,
        computed_at: new Date().toISOString(),
      }));
      const { error } = await db
        .from('capitulation_plans')
        .upsert(out, { onConflict: 'trigger_date' });
      if (error) throw new Error(`capitulation_plans upsert failed: ${error.message}`);
      return out.length;
    },
    async getResultsFilingDates() {
      const out: { cik: string; date: string }[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('filings')
          .select('cik, filing_date')
          .eq('form', '8-K')
          .contains('items', ['2.02'])
          .order('filing_date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`filings read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows) out.push({ cik: r.cik as string, date: r.filing_date as string });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async saveEconCalendar(at, version, from, to, events) {
      const { error } = await db.from('econ_calendar_snapshots').insert({
        fetched_at: at.toISOString(),
        version,
        range_from: from,
        range_to: to,
        events,
      });
      if (error) throw new Error(`econ_calendar_snapshots insert failed: ${error.message}`);
    },
    async saveEarningsEstimates(at, version, rows) {
      const { error } = await db
        .from('earnings_estimate_snapshots')
        .insert({ computed_at: at.toISOString(), version, estimates: rows });
      if (error) throw new Error(`earnings_estimate_snapshots insert failed: ${error.message}`);
    },
    async latest(table, columns, orderBy, limit) {
      if (!LATEST_TABLES.includes(table)) throw new Error(`latest: table ${table} not allowed`);
      // An optional equality filter is written "column=value" after a pipe in `columns`, e.g. "date, value|series_id=VIXCLS".
      const [cols, filter] = columns.split('|') as [string, string | undefined];
      let q = db.from(table).select(cols);
      if (filter) {
        const [k, v] = filter.split('=') as [string, string];
        q = q.eq(k, v);
      }
      const { data, error } = await q.order(orderBy, { ascending: false }).limit(limit);
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    async saveBrief(brief, inputs, delivery) {
      const { error } = await db.from('briefs').upsert(
        {
          kind: brief.kind,
          for_date: brief.date,
          version: brief.version,
          title: brief.title,
          push_body: brief.pushBody,
          sections: brief.sections,
          inputs,
          delivery,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'kind,for_date' },
      );
      if (error) throw new Error(`briefs upsert failed: ${error.message}`);
    },
    async exportRows(table) {
      if (![...PERSONAL_EXPORT_TABLES, ...SHARED_EXPORT_TABLES].includes(table as never))
        throw new Error(`${table} is not an export table`);
      const out: Record<string, unknown>[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from(table)
          .select('*')
          .range(start, start + 999);
        if (error) throw new Error(`${table} read failed: ${error.message}`);
        out.push(...((data ?? []) as Record<string, unknown>[]));
        if ((data ?? []).length < 1000) break;
      }
      return out;
    },
    async uploadExport(path, body) {
      const { error } = await db.storage
        .from('exports')
        .upload(path, new Blob([body], { type: 'application/json' }), {
          contentType: 'application/json',
          upsert: true,
        });
      if (error) throw new Error(`exports upload ${path} failed: ${error.message}`);
    },
    async getAlertsForScoring(since) {
      const { data, error } = await db
        .from('alerts')
        .select('id, created_at, kind, ticker, rule_id, rule_status, input')
        .neq('decision', 'suppress')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(5000);
      if (error) throw new Error(`alerts read failed: ${error.message}`);
      return (data ?? []).map((r) => {
        const input = (r.input ?? {}) as {
          plan?: { stop?: number; targets?: number[] };
          qualityScore?: number;
        };
        // Only a plan with a price stop can be scored for stop or target first; a written catalyst plan cannot.
        const stop = input.plan?.stop;
        return {
          id: String(r.id),
          createdAt: new Date(String(r.created_at)).toISOString(),
          kind: String(r.kind),
          ticker: r.ticker === null ? null : String(r.ticker),
          ruleId: String(r.rule_id),
          ruleStatus: r.rule_status === 'shadow' ? 'shadow' : 'live',
          ...(typeof stop === 'number'
            ? { plan: { stop, targets: input.plan?.targets ?? [] } }
            : {}),
          ...(typeof input.qualityScore === 'number' ? { qualityScore: input.qualityScore } : {}),
        };
      });
    },
    async getFinishedOutcomeKeys(alertIds) {
      const out = new Set<string>();
      for (let i = 0; i < alertIds.length; i += 200) {
        const { data, error } = await db
          .from('alert_outcomes')
          .select('alert_id, horizon')
          .in('alert_id', alertIds.slice(i, i + 200))
          .in('status', ['done', 'unavailable']);
        if (error) throw new Error(`alert_outcomes read failed: ${error.message}`);
        for (const r of data ?? []) out.add(`${String(r.alert_id)}|${String(r.horizon)}`);
      }
      return out;
    },
    async getOutcomes(alertIds) {
      const out: Outcome[] = [];
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      for (let i = 0; i < alertIds.length; i += 200) {
        const { data, error } = await db
          .from('alert_outcomes')
          .select(
            'alert_id, horizon, status, note, ref_date, end_date, ret, bench_ret, excess, mfe, mae, hit',
          )
          .in('alert_id', alertIds.slice(i, i + 200));
        if (error) throw new Error(`alert_outcomes read failed: ${error.message}`);
        for (const r of data ?? [])
          out.push({
            alertId: String(r.alert_id),
            horizon: String(r.horizon) as Outcome['horizon'],
            status: String(r.status) as Outcome['status'],
            note: r.note === null ? null : String(r.note),
            refDate: r.ref_date === null ? null : String(r.ref_date),
            endDate: r.end_date === null ? null : String(r.end_date),
            ret: n(r.ret),
            benchRet: n(r.bench_ret),
            excess: n(r.excess),
            mfe: n(r.mfe),
            mae: n(r.mae),
            hit: (r.hit ?? null) as Outcome['hit'],
          });
      }
      return out;
    },
    async upsertOutcomes(rows, version) {
      if (rows.length === 0) return 0;
      const { error } = await db.from('alert_outcomes').upsert(
        rows.map((o) => ({
          alert_id: o.alertId,
          horizon: o.horizon,
          version,
          status: o.status,
          note: o.note,
          ref_date: o.refDate,
          end_date: o.endDate,
          ret: o.ret,
          bench_ret: o.benchRet,
          excess: o.excess,
          mfe: o.mfe,
          mae: o.mae,
          hit: o.hit,
          computed_at: new Date().toISOString(),
        })),
        { onConflict: 'alert_id,horizon' },
      );
      if (error) throw new Error(`alert_outcomes upsert failed: ${error.message}`);
      return rows.length;
    },
    async getBarsFetchedAt(ticker) {
      const { data, error } = await db
        .from('daily_bars')
        .select('fetched_at')
        .eq('ticker', ticker)
        .order('date', { ascending: false })
        .limit(1);
      if (error) throw new Error(`daily_bars read failed: ${error.message}`);
      const r = (data ?? [])[0];
      return r ? new Date(String(r.fetched_at)).toISOString() : null;
    },
    async getActiveScenarios(today) {
      const { data, error } = await db
        .from('catalyst_scenarios')
        .select('*')
        .eq('active', true)
        .gte('expires_on', today)
        .limit(200);
      if (error) throw new Error(`catalyst_scenarios read failed: ${error.message}`);
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return (data ?? []).map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        tickers: (r.tickers ?? []) as string[],
        keywords: (r.keywords ?? []) as string[],
        triggers: {
          eightKItems: (r.eight_k_items ?? []) as string[],
          form4Codes: (r.form4_codes ?? []) as string[],
          newsMinTier: n(r.news_min_tier) as 1 | 2 | 3 | 4 | null,
          halts: r.halts === true,
          movePct: n(r.move_pct),
          volumeRatio: n(r.volume_ratio),
        },
        plan: {
          entry: String(r.plan_entry),
          chaseGuardPct: Number(r.chase_guard_pct),
          invalidation: String(r.plan_invalidation),
          size: String(r.plan_size ?? ''),
        },
        expiresOn: String(r.expires_on),
      }));
    },
    async getCatalystEvents(since) {
      const instruments = await this.getInstruments();
      const tickerOf = new Map(instruments.map((i) => [i.cik, i.ticker]));
      const [f, ins, nw, halts] = await Promise.all([
        db
          .from('filings')
          .select('accession, cik, form, filing_date, accepted_at, items')
          .in('form', ['8-K', '8-K/A'])
          .gte('filing_date', since.slice(0, 10))
          .limit(2000),
        db
          .from('insider_filings')
          .select('accession, issuer_cik, owner_name, filed_at, insider_transactions(code)')
          .eq('status', 'ok')
          .gte('filed_at', since)
          .limit(2000),
        db
          .from('news_articles')
          .select('id, published_at, publisher, title, tickers')
          .gte('published_at', since)
          .limit(2000),
        this.getRecentHalts(since),
      ]);
      for (const [what, r] of [
        ['filings', f],
        ['insider_filings', ins],
        ['news_articles', nw],
      ] as const)
        if (r.error) throw new Error(`${what} read failed: ${r.error.message}`);
      const events: CatalystEvent[] = [];
      for (const r of f.data ?? []) {
        const ticker = tickerOf.get(String(r.cik));
        if (!ticker) continue;
        events.push({
          kind: '8-K',
          ticker,
          at: new Date(String(r.accepted_at ?? `${String(r.filing_date)}T12:00:00Z`)).toISOString(),
          items: (r.items ?? []) as string[],
          accession: String(r.accession),
        });
      }
      for (const r of ins.data ?? []) {
        const ticker = tickerOf.get(String(r.issuer_cik));
        if (!ticker) continue;
        const codes = new Set(
          ((r.insider_transactions ?? []) as { code: string }[]).map((t) => t.code),
        );
        for (const code of codes)
          events.push({
            kind: 'form4',
            ticker,
            at: new Date(String(r.filed_at)).toISOString(),
            code,
            owner: String(r.owner_name ?? ''),
            accession: String(r.accession),
          });
      }
      for (const r of nw.data ?? [])
        events.push({
          kind: 'news',
          tickers: (r.tickers ?? []) as string[],
          at: new Date(String(r.published_at)).toISOString(),
          title: String(r.title),
          publisher: String(r.publisher),
          id: String(r.id),
        });
      for (const h of halts)
        events.push({
          kind: 'halt',
          ticker: h.symbol,
          at: h.haltedAt,
          reason: h.reasonMeaning ? `${h.reasonCode} (${h.reasonMeaning})` : h.reasonCode,
        });
      return events;
    },
    async countEightKAnalogs(tickers, items) {
      if (items.length === 0) return 0;
      const instruments = await this.getInstruments();
      const ciks = instruments.filter((i) => tickers.includes(i.ticker)).map((i) => i.cik);
      if (ciks.length === 0) return 0;
      const { count, error } = await db
        .from('filings')
        .select('accession', { count: 'exact', head: true })
        .in('cik', ciks)
        .in('form', ['8-K', '8-K/A'])
        .overlaps('items', [...items]);
      if (error) throw new Error(`filings count failed: ${error.message}`);
      return count ?? 0;
    },
    async getOpenHoldings() {
      const { data, error } = await db
        .from('holdings')
        .select(
          'id, ticker, shares, cost_basis, opened_on, stop, targets, trend_break, time_stop_sessions',
        )
        .is('closed_on', null)
        .order('id', { ascending: true })
        .limit(500);
      if (error) throw new Error(`holdings read failed: ${error.message}`);
      return (data ?? []).map((r) => {
        const tb = /^(sma|ema)(\d{1,3})$/.exec(String(r.trend_break ?? ''));
        return {
          id: Number(r.id),
          ticker: String(r.ticker),
          shares: Number(r.shares),
          costBasis: Number(r.cost_basis),
          openedOn: String(r.opened_on),
          stop: r.stop === null ? null : Number(r.stop),
          targets: ((r.targets as unknown[] | null) ?? []).map(Number),
          trendBreak: tb ? { ind: tb[1] as 'sma' | 'ema', period: Number(tb[2]) } : null,
          timeStopSessions: r.time_stop_sessions === null ? null : Number(r.time_stop_sessions),
        };
      });
    },
    async getDailyBars(ticker) {
      const out: DailyBar[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('daily_bars')
          .select('date, open, high, low, close, volume, vwap')
          .eq('ticker', ticker)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`daily_bars read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows)
          out.push({
            date: r.date as string,
            open: Number(r.open),
            high: Number(r.high),
            low: Number(r.low),
            close: Number(r.close),
            volume: Number(r.volume),
            vwap: r.vwap === null ? null : Number(r.vwap),
          });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getRegimeLabels(from) {
      const out: { date: string; label: string }[] = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await db
          .from('regime_daily')
          .select('date, label')
          .gte('date', from)
          .order('date', { ascending: true })
          .range(start, start + 999);
        if (error) throw new Error(`regime_daily read failed: ${error.message}`);
        const rows = data ?? [];
        for (const r of rows) out.push({ date: r.date as string, label: String(r.label) });
        if (rows.length < 1000) break;
      }
      return out;
    },
    async getRuleVersions(id) {
      const { data, error } = await db
        .from('rules')
        .select('version, hash, status')
        .eq('id', id)
        .order('version', { ascending: true });
      if (error) throw new Error(`rules read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        version: Number(r.version),
        hash: String(r.hash),
        status: r.status as RuleStatus,
      }));
    },
    async insertRuleVersion(row) {
      const { error } = await db.from('rules').insert({
        id: row.id,
        version: row.version,
        hash: row.hash,
        doc: row.doc,
        source: row.source,
      });
      if (error) throw new Error(`rules insert failed: ${error.message}`);
      const ev = await db.from('rule_events').insert({
        rule_id: row.id,
        version: row.version,
        from_status: null,
        to_status: 'draft',
        reason: 'new version',
      });
      if (ev.error) throw new Error(`rule_events insert failed: ${ev.error.message}`);
    },
    async setRuleStatus(id, version, from, to, reason, evidence) {
      const { error } = await db
        .from('rules')
        .update({ status: to })
        .eq('id', id)
        .eq('version', version)
        .eq('status', from);
      if (error) throw new Error(`rules status update failed: ${error.message}`);
      const ev = await db.from('rule_events').insert({
        rule_id: id,
        version,
        from_status: from,
        to_status: to,
        reason,
        evidence,
      });
      if (ev.error) throw new Error(`rule_events insert failed: ${ev.error.message}`);
    },
    async saveBacktestRun(row) {
      const { error } = await db.from('backtest_runs').insert({
        rule_id: row.ruleId,
        version: row.version,
        engine: row.engine,
        params: row.params,
        trials: row.trials,
        report: row.report,
      });
      if (error) throw new Error(`backtest_runs insert failed: ${error.message}`);
    },
    async getRecentHalts(since) {
      const { data, error } = await db
        .from('halts')
        .select(
          'symbol, halted_at, reason_code, reason_meaning, news_related, resumption_trade_at, last_seen_at',
        )
        .gte('halted_at', since)
        .order('halted_at', { ascending: true })
        .limit(1000);
      if (error) throw new Error(`halts read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        symbol: String(r.symbol),
        haltedAt: new Date(String(r.halted_at)).toISOString(),
        reasonCode: String(r.reason_code),
        reasonMeaning: r.reason_meaning === null ? null : String(r.reason_meaning),
        newsRelated: r.news_related === true,
        resumptionTradeAt:
          r.resumption_trade_at === null
            ? null
            : new Date(String(r.resumption_trade_at)).toISOString(),
        lastSeenAt: new Date(String(r.last_seen_at)).toISOString(),
      }));
    },
    async getWatchlistTickers() {
      const { data, error } = await db.from('watchlist_items').select('ticker').limit(1000);
      if (error) throw new Error(`watchlist_items read failed: ${error.message}`);
      return [...new Set((data ?? []).map((r) => String(r.ticker)))];
    },
    async getAlertPreferences() {
      const { data, error } = await db
        .from('alert_preferences')
        .select('quiet_start, quiet_end, daily_push_cap')
        .limit(2);
      if (error) throw new Error(`alert_preferences read failed: ${error.message}`);
      // Only the app owner can write a row (RLS), so more than one means something is wrong: use the defaults.
      if (!data || data.length !== 1) return null;
      const r = data[0] as Record<string, unknown>;
      return {
        quietStart: String(r['quiet_start']),
        quietEnd: String(r['quiet_end']),
        dailyPushCap: Number(r['daily_push_cap']),
      };
    },
    async getRecentAlerts(since) {
      const { data, error } = await db
        .from('alerts')
        .select('dedupe_key, created_at, decision')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw new Error(`alerts read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        key: String(r.dedupe_key),
        at: new Date(String(r.created_at)).toISOString(),
        decision: String(r.decision),
      }));
    },
    async insertAlerts(rows) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        created_at: r.createdAt,
        version: r.version,
        kind: r.input.kind,
        priority: r.input.priority,
        ticker: r.input.ticker ?? null,
        rule_id: r.input.ruleId,
        rule_version: r.input.ruleVersion,
        rule_status: r.input.ruleStatus,
        dedupe_key: r.key,
        decision: r.decision,
        reasons: r.reasons,
        headline: r.input.headline.slice(0, 120),
        push: r.push,
        card: r.card,
        input: r.input,
        source_at: r.sourceAt,
        latency_ms: r.sourceAt === null ? null : Date.parse(r.createdAt) - Date.parse(r.sourceAt),
        delivery: r.delivery,
      }));
      const { error } = await db.from('alerts').insert(out);
      if (error) throw new Error(`alerts insert failed: ${error.message}`);
      return out.length;
    },
    async upsertStrengthRanks(date, rows) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        version: STRENGTH_VERSION,
        date,
        ticker: r.ticker,
        return_63: r.return63,
        rank: r.rank,
        members: r.members,
        percentile: r.percentile,
        computed_at: new Date().toISOString(),
      }));
      for (let i = 0; i < out.length; i += 500) {
        const { error } = await db
          .from('strength_rank_daily')
          .upsert(out.slice(i, i + 500), { onConflict: 'version,date,ticker' });
        if (error) throw new Error(`strength_rank_daily upsert failed: ${error.message}`);
      }
      return out.length;
    },
    async upsertMovers(rows) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        date: r.date,
        version: r.version,
        n: r.n,
        gainers: r.gainers,
        losers: r.losers,
        sectors: r.sectors,
        market_version: r.market?.version ?? null,
        computed_at: new Date().toISOString(),
      }));
      // The owner-only whole-market row first, so the shared marker never points at a row that is not there.
      const market = rows.flatMap((r) =>
        r.market
          ? [
              {
                date: r.date,
                version: r.market.version,
                session: r.market,
                computed_at: new Date().toISOString(),
              },
            ]
          : [],
      );
      if (market.length > 0) {
        const m = await db.from('market_movers_market').upsert(market, { onConflict: 'date' });
        if (m.error) throw new Error(`market_movers_market upsert failed: ${m.error.message}`);
      }
      const { error } = await db.from('market_movers_daily').upsert(out, { onConflict: 'date' });
      if (error) throw new Error(`market_movers_daily upsert failed: ${error.message}`);
      return out.length;
    },
    async getTopicDates() {
      const { data, error } = await db
        .from('news_topic_days')
        .select('date')
        .order('date', { ascending: true })
        .limit(1000);
      if (error) throw new Error(`news_topic_days read failed: ${error.message}`);
      return (data ?? []).map((r) => r.date as string);
    },
    async upsertTopicDays(rows, fetchedAt) {
      if (rows.length === 0) return 0;
      const out = rows.map((r) => ({
        date: r.date,
        version: r.version,
        total: r.total,
        counts: r.counts,
        samples: r.samples,
        fetched_at: fetchedAt.toISOString(),
      }));
      const { error } = await db.from('news_topic_days').upsert(out, { onConflict: 'date' });
      if (error) throw new Error(`news_topic_days upsert failed: ${error.message}`);
      return out.length;
    },
    async upsertRegimeDays(rows) {
      let written = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          date: r.date,
          rule_version: r.ruleVersion,
          label: r.label,
          reason: r.reason,
          inputs: r.inputs,
          recession_version: r.recessionVersion,
          recession_level: r.recessionLevel,
          recession: r.recession,
          computed_at: new Date().toISOString(),
        }));
        const { error } = await db.from('regime_daily').upsert(chunk, { onConflict: 'date' });
        if (error) throw new Error(`regime_daily upsert failed: ${error.message}`);
        written += chunk.length;
      }
      return written;
    },
    async replaceEventStats(ruleVersion, rows) {
      const out = rows.map((r) => ({
        rule_version: ruleVersion,
        condition: r.condition,
        horizon: r.horizon,
        n: r.n,
        sufficient: r.sufficient,
        median: r.median,
        q1: r.q1,
        q3: r.q3,
        min: r.min,
        max: r.max,
        ci_low: r.ciLow,
        ci_high: r.ciHigh,
        episodes: r.episodes,
        data_from: r.dataFrom,
        data_to: r.dataTo,
        computed_at: new Date().toISOString(),
      }));
      const { error } = await db
        .from('regime_event_stats')
        .upsert(out, { onConflict: 'rule_version,condition,horizon' });
      if (error) throw new Error(`regime_event_stats upsert failed: ${error.message}`);
      return out.length;
    },
  };
}
