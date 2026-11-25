import { createClient } from '@supabase/supabase-js';
import {
  SNAPSHOT_ENCODING,
  decodeList,
  decodeSnapshot,
  encodeList,
  encodeSnapshot,
  MIN_SNAPSHOT_DOLLAR_VOLUME,
} from './snapshot-codec.js';
import { etDate } from '@marsad/core';
import type {
  AnnualSection,
  BreadthDay,
  BreadthInput,
  BreadthSignals,
  CapitulationDay,
  EarningsEstimate,
  EconEvent,
  FearGreedDay,
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

export interface UniverseRow {
  monthStart: string;
  ticker: string;
  rank: number;
  dollarVolume: number;
}

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
