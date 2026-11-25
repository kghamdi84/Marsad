/** An in-memory Store for tests. Records every write; `fred` seeds what getFredRange returns. */
import type {
  AnnualSection,
  Bar,
  CapitulationDay,
  CompanyRef,
  FearGreedDay,
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
  BreadthRow,
  DailyClose,
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
      'topicDates' in x);
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
    runs: [],
    statuses: [],
    alerts: [],
  };
  const store: Store = {
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
