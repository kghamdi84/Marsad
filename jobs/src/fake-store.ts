/** An in-memory Store for tests. Records every write; `fred` seeds what getFredRange returns. */
import type {
  CompanyRef,
  Filing,
  FredObservation,
  GprDay,
  JobRunRecord,
  Split,
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
  runs: JobRunRecord[];
  statuses: SourceStatusUpdate[];
}

export function fakeStore(fred: Record<string, FredObservation[]> = {}): {
  store: Store;
  log: FakeLog;
} {
  const log: FakeLog = {
    gpr: [],
    fred: [],
    holidays: [],
    splits: [],
    instruments: [],
    filings: [],
    runs: [],
    statuses: [],
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
    recordRun: (run) => {
      log.runs.push(run);
      return Promise.resolve();
    },
    updateSourceStatus: (u) => {
      log.statuses.push(u);
      return Promise.resolve();
    },
  };
  return { store, log };
}
