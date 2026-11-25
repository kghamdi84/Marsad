/** An in-memory Store for tests. Records every write; `fred` seeds what getFredRange returns. */
import type {
  HoldingRef,
  Outcome,
  ScoredAlert,
  AnnualSection,
  Bar,
  Brief,
  HaltRow,
  DailyBar,
  RuleDoc,
  RuleStatus,
  CapitulationDay,
  CompanyRef,
  EconEvent,
  FearGreedDay,
  MarketMovers,
  StagedPlan,
  TopicDay,
  DividendRow,
  FinancialFact,
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
import { decodeList, decodeSnapshot, encodeList, encodeSnapshot } from './snapshot-codec.js';
import type {
  StoredAlert,
  BreadthRow,
  DailyClose,
  EarningsEstimateRow,
  EventStatRow,
  InsiderCandidate,
  InsiderResult,
  RegimeRow,
  SentimentBreadthRow,
  SourceStatusUpdate,
  Store,
  UniverseRow,
} from './store.js';

export interface FakeLog {
  gpr: GprDay[][];
  fred: { series: string; n: number }[];
  holidays: UpcomingRow[][];
  splits: Split[][];
  instruments: CompanyRef[][];
  filings: { cik: string; n: number }[];
  halts: Halt[][];
  bars: { ticker: string; bars: Bar[] }[];
  facts: { cik: string; facts: FinancialFact[] }[];
  insiders: InsiderResult[];
  news: NewsArticle[][];
  shortInterest: ShortInterestRow[][];
  shortVolume: ShortVolumeRow[][];
  dividends: DividendRow[][];
  annualSections: AnnualSection[][];
  regimeDays: RegimeRow[][];
  universe: { version: string; rows: UniverseRow[] }[];
  breadth: BreadthRow[][];
  snapshotsSaved: string[];
  eventStats: { ruleVersion: string; rows: EventStatRow[] }[];
  fearGreed: FearGreedDay[][];
  capitulation: CapitulationDay[][];
  plans: StagedPlan[][];
  topicDays: TopicDay[][];
  econCalendars: { from: string; to: string; events: EconEvent[] }[];
  movers: MarketMovers[][];
  briefs: { brief: Brief; inputs: unknown; delivery: Record<string, string> }[];
  ruleVersions: { id: string; version: number; hash: string; doc: RuleDoc }[];
  ruleEvents: { id: string; version: number; from: RuleStatus; to: RuleStatus; reason: string }[];
  backtestRuns: {
    ruleId: string;
    version: number;
    trials: number;
    report: Record<string, unknown>;
  }[];
  storedAlerts: StoredAlert[][];
  outcomes: Outcome[][];
  uploads: { path: string; body: string }[];
  earningsEstimates: EarningsEstimateRow[][];
  runs: JobRunRecord[];
  statuses: SourceStatusUpdate[];
  alerts: { alert: SystemAlert; policyVersion: string; snapshot: Record<string, unknown> }[];
}

export interface FakeSeed {
  fred?: Record<string, FredObservation[]>;
  heartbeats?: SourceHeartbeat[];
  holidays?: UpcomingRow[];
  /** Previous stale/recovered state per source, as stored by earlier runs. */
  health?: Record<string, 'stale' | 'recovered'>;
  instruments?: { cik: string; ticker: string }[];
  insiderCandidates?: InsiderCandidate[];
  breadthInputs?: SentimentBreadthRow[];
  dailyCloses?: Record<string, DailyClose[]>;
  recessionLevels?: { date: string; level: string }[];
  topicDates?: string[];
  resultsFilings?: { cik: string; date: string }[];
  /** Rows `latest` returns, by table (and by "column=value" filter when given), newest first. */
  latestRows?: Record<string, Record<string, unknown>[]>;
  bars?: Record<string, DailyBar[]>;
  regimeLabels?: { date: string; label: string }[];
  rules?: Record<string, { version: number; hash: string; status: RuleStatus }[]>;
  halts?: HaltRow[];
  watchlist?: string[];
  recentAlerts?: { key: string; at: string; decision: string }[];
  barsFetchedAt?: Record<string, string>;
  holdings?: HoldingRef[];
  scoredAlerts?: ScoredAlert[];
  exportTables?: Record<string, Record<string, unknown>[]>;
  /** Keys `alertId|horizon` already finished. */
  finishedOutcomes?: string[];
}

export function fakeStore(seed: FakeSeed | Record<string, FredObservation[]> = {}): {
  store: Store;
  log: FakeLog;
} {
  const isSeed = (x: unknown): x is FakeSeed =>
    typeof x === 'object' &&
    x !== null &&
    ('fred' in x ||
      'heartbeats' in x ||
      'holidays' in x ||
      'health' in x ||
      'instruments' in x ||
      'insiderCandidates' in x ||
      'breadthInputs' in x ||
      'dailyCloses' in x ||
      'recessionLevels' in x ||
      'topicDates' in x ||
      'resultsFilings' in x ||
      'latestRows' in x ||
      'bars' in x ||
      'rules' in x ||
      'halts' in x ||
      'watchlist' in x ||
      'recentAlerts' in x ||
      'regimeLabels' in x ||
      'barsFetchedAt' in x ||
      'holdings' in x ||
      'scoredAlerts' in x ||
      'finishedOutcomes' in x ||
      'exportTables' in x);
  const s: FakeSeed = isSeed(seed) ? seed : { fred: seed as Record<string, FredObservation[]> };
  const fred = s.fred ?? {};
  const snapshots = new Map<string, string>();
  const typeSnapshots = new Map<string, string>();
  const log: FakeLog = {
    gpr: [],
    fred: [],
    holidays: [],
    splits: [],
    instruments: [],
    filings: [],
    halts: [],
    bars: [],
    facts: [],
    insiders: [],
    news: [],
    shortInterest: [],
    shortVolume: [],
    dividends: [],
    annualSections: [],
    regimeDays: [],
    universe: [],
    breadth: [],
    snapshotsSaved: [],
    eventStats: [],
    fearGreed: [],
    capitulation: [],
    plans: [],
    topicDays: [],
    econCalendars: [],
    movers: [],
    briefs: [],
    ruleVersions: [],
    ruleEvents: [],
    backtestRuns: [],
    storedAlerts: [],
    outcomes: [],
    uploads: [],
    earningsEstimates: [],
    runs: [],
    statuses: [],
    alerts: [],
  };
  const store: Store = {
    getRecentHalts: (since) => Promise.resolve((s.halts ?? []).filter((h) => h.haltedAt >= since)),
    getWatchlistTickers: () => Promise.resolve([...(s.watchlist ?? [])]),
    getRecentAlerts: (since) =>
      Promise.resolve((s.recentAlerts ?? []).filter((a) => a.at >= since)),
    insertAlerts: (rows) => {
      log.storedAlerts.push([...rows]);
      return Promise.resolve(rows.length);
    },
    getDailyBars: (ticker) => Promise.resolve(s.bars?.[ticker] ?? []),
    getBarsFetchedAt: (ticker) => Promise.resolve(s.barsFetchedAt?.[ticker] ?? null),
    getOpenHoldings: () => Promise.resolve([...(s.holdings ?? [])]),
    exportRows: (table) => Promise.resolve([...(s.exportTables?.[table] ?? [])]),
    uploadExport: (path, body) => {
      log.uploads.push({ path, body });
      return Promise.resolve();
    },
    getAlertsForScoring: (since) =>
      Promise.resolve((s.scoredAlerts ?? []).filter((a) => a.createdAt >= since)),
    getFinishedOutcomeKeys: (ids) =>
      Promise.resolve(
        new Set((s.finishedOutcomes ?? []).filter((k) => ids.includes(k.split('|')[0] ?? ''))),
      ),
    upsertOutcomes: (rows) => {
      log.outcomes.push([...rows]);
      return Promise.resolve(rows.length);
    },
    getRegimeLabels: (from) =>
      Promise.resolve((s.regimeLabels ?? []).filter((r) => r.date >= from)),
    getRuleVersions: (id) => Promise.resolve([...(s.rules?.[id] ?? [])]),
    insertRuleVersion: (row) => {
      log.ruleVersions.push({ id: row.id, version: row.version, hash: row.hash, doc: row.doc });
      return Promise.resolve();
    },
    setRuleStatus: (id, version, from, to, reason) => {
      log.ruleEvents.push({ id, version, from, to, reason });
      return Promise.resolve();
    },
    saveBacktestRun: (row) => {
      log.backtestRuns.push({
        ruleId: row.ruleId,
        version: row.version,
        trials: row.trials,
        report: row.report,
      });
      return Promise.resolve();
    },
    latest: (table, columns, _orderBy, limit) => {
      const filter = columns.split('|')[1];
      const rows = s.latestRows?.[filter ? `${table}|${filter}` : table] ?? [];
      return Promise.resolve(rows.slice(0, limit));
    },
    saveBrief: (brief, inputs, delivery) => {
      log.briefs.push({ brief, inputs, delivery });
      return Promise.resolve();
    },
    upsertMovers: (rows) => {
      log.movers.push([...rows]);
      return Promise.resolve(rows.length);
    },
    getResultsFilingDates: () => Promise.resolve([...(s.resultsFilings ?? [])]),
    saveEconCalendar: (_at, _version, from, to, events) => {
      log.econCalendars.push({ from, to, events: [...events] });
      return Promise.resolve();
    },
    saveEarningsEstimates: (_at, _version, rows) => {
      log.earningsEstimates.push([...rows]);
      return Promise.resolve();
    },
    getTopicDates: () => Promise.resolve([...(s.topicDates ?? [])]),
    upsertTopicDays: (rows) => {
      log.topicDays.push([...rows]);
      return Promise.resolve(rows.length);
    },
    getBreadthInputs: (from) =>
      Promise.resolve((s.breadthInputs ?? []).filter((r) => r.date >= from)),
    getDailyCloses: (ticker) => Promise.resolve(s.dailyCloses?.[ticker] ?? []),
    getRecessionLevels: (from) =>
      Promise.resolve((s.recessionLevels ?? []).filter((r) => r.date >= from)),
    upsertFearGreedDays: (rows) => {
      log.fearGreed.push([...rows]);
      return Promise.resolve(rows.length);
    },
    upsertCapitulationDays: (rows) => {
      log.capitulation.push([...rows]);
      return Promise.resolve(rows.length);
    },
    upsertCapitulationPlans: (rows) => {
      log.plans.push([...rows]);
      return Promise.resolve(rows.length);
    },
    upsertGprDays: (days) => {
      log.gpr.push([...days]);
      return Promise.resolve(days.length);
    },
    upsertFredObservations: (series, obs) => {
      log.fred.push({ series, n: obs.length });
      return Promise.resolve(obs.length);
    },
    upsertMarketHolidays: (rows) => {
      log.holidays.push([...rows]);
      return Promise.resolve(rows.length);
    },
    upsertSplits: (splits) => {
      log.splits.push([...splits]);
      return Promise.resolve(splits.length);
    },
    getFredRange: (series, from, to) =>
      Promise.resolve((fred[series] ?? []).filter((o) => o.date >= from && o.date <= to)),
    upsertInstruments: (companies: readonly CompanyRef[]) => {
      log.instruments.push([...companies]);
      return Promise.resolve(companies.length);
    },
    upsertFilings: (cik: string, filings: readonly Filing[]) => {
      log.filings.push({ cik, n: filings.length });
      return Promise.resolve(filings.length);
    },
    upsertHalts: (halts: readonly Halt[]) => {
      log.halts.push([...halts]);
      return Promise.resolve(halts.length);
    },
    upsertDailyBars: (ticker: string, bars: readonly Bar[]) => {
      log.bars.push({ ticker, bars: [...bars] });
      return Promise.resolve(bars.length);
    },
    getInstruments: () => Promise.resolve([...(s.instruments ?? [])]),
    upsertFinancialFacts: (cik: string, facts: readonly FinancialFact[]) => {
      log.facts.push({ cik, facts: [...facts] });
      return Promise.resolve(facts.length);
    },
    getUnreadInsiderFilings: (limit: number) =>
      Promise.resolve((s.insiderCandidates ?? []).slice(0, limit)),
    saveInsiderFiling: (res: InsiderResult) => {
      log.insiders.push(res);
      return Promise.resolve(
        res.status === 'ok' ? res.doc.transactions.length + res.doc.holdings.length : 0,
      );
    },
    upsertNewsArticles: (a: readonly NewsArticle[]) => {
      log.news.push([...a]);
      return Promise.resolve(a.length);
    },
    upsertShortInterest: (r: readonly ShortInterestRow[]) => {
      log.shortInterest.push([...r]);
      return Promise.resolve(r.length);
    },
    upsertShortVolume: (r: readonly ShortVolumeRow[]) => {
      log.shortVolume.push([...r]);
      return Promise.resolve(r.length);
    },
    upsertDividends: (r: readonly DividendRow[]) => {
      log.dividends.push([...r]);
      return Promise.resolve(r.length);
    },
    upsertAnnualSections: (r: readonly AnnualSection[]) => {
      log.annualSections.push([...r]);
      return Promise.resolve(r.length);
    },
    getSnapshotDates: () =>
      Promise.resolve(
        [...snapshots.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, payload]) => ({ date, closed: payload === '' })),
      ),
    saveSnapshot: (date, rows) => {
      const enc = rows.length === 0 ? { payload: '', tickers: 0 } : encodeSnapshot(rows);
      snapshots.set(date, enc.payload);
      log.snapshotsSaved.push(date);
      return Promise.resolve(enc.tickers);
    },
    loadSnapshots: (from) =>
      Promise.resolve(
        [...snapshots.entries()]
          .filter(([d, p]) => d >= from && p !== '')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, payload]) => ({ date, rows: decodeSnapshot(payload) })),
      ),
    getTickerTypeSnapshots: () =>
      Promise.resolve(
        [...typeSnapshots.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([asOf, p]) => ({ asOf, ...decodeList(p) })),
      ),
    saveTickerTypeSnapshot: (asOf, cs, etf) => {
      typeSnapshots.set(asOf, encodeList({ cs, etf }));
      return Promise.resolve();
    },
    getShareChanges: (from) =>
      Promise.resolve(
        log.splits
          .flat()
          .filter((x) => x.executionDate >= from)
          .map((x) => ({
            ticker: x.ticker,
            executionDate: x.executionDate,
            splitFrom: x.splitFrom,
            splitTo: x.splitTo,
          })),
      ),
    upsertUniverse: (version, rows) => {
      log.universe.push({ version, rows: [...rows] });
      return Promise.resolve(rows.length);
    },
    upsertBreadthDays: (rows) => {
      log.breadth.push([...rows]);
      return Promise.resolve(rows.length);
    },
    upsertRegimeDays: (r: readonly RegimeRow[]) => {
      log.regimeDays.push([...r]);
      return Promise.resolve(r.length);
    },
    replaceEventStats: (ruleVersion: string, rows: readonly EventStatRow[]) => {
      log.eventStats.push({ ruleVersion, rows: [...rows] });
      return Promise.resolve(rows.length);
    },
    recordRun: (run) => {
      log.runs.push(run);
      return Promise.resolve();
    },
    updateSourceStatus: (u) => {
      log.statuses.push(u);
      return Promise.resolve();
    },
    getSourceHeartbeats: () => Promise.resolve([...(s.heartbeats ?? [])]),
    getHolidays: () => Promise.resolve([...(s.holidays ?? [])]),
    getLatestHealthEvents: () => Promise.resolve({ ...(s.health ?? {}) }),
    insertSystemAlerts: (alerts, policyVersion, snapshots) => {
      alerts.forEach((alert, i) =>
        log.alerts.push({ alert, policyVersion, snapshot: snapshots[i] ?? {} }),
      );
      return Promise.resolve(alerts.length);
    },
  };
  return { store, log };
}
