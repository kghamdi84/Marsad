/** An in-memory Store for tests. Records every write; `fred` seeds what getFredRange returns. */
import type {
  CompanyRef,
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
import type { SourceStatusUpdate, Store } from './store.js';

export interface FakeLog {
  gpr: GprDay[][];
  fred: { series: string; n: number }[];
  holidays: UpcomingRow[][];
  splits: Split[][];
  instruments: CompanyRef[][];
  filings: { cik: string; n: number }[];
  halts: Halt[][];
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
}

export function fakeStore(seed: FakeSeed | Record<string, FredObservation[]> = {}): {
  store: Store;
  log: FakeLog;
} {
  const isSeed = (x: unknown): x is FakeSeed =>
    typeof x === 'object' &&
    x !== null &&
    ('fred' in x || 'heartbeats' in x || 'holidays' in x || 'health' in x);
  const s: FakeSeed = isSeed(seed) ? seed : { fred: seed as Record<string, FredObservation[]> };
  const fred = s.fred ?? {};
  const log: FakeLog = {
    gpr: [],
    fred: [],
    holidays: [],
    splits: [],
    instruments: [],
    filings: [],
    halts: [],
    runs: [],
    statuses: [],
    alerts: [],
  };
  const store: Store = {
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
