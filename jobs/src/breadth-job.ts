import {
  BREADTH_VERSION,
  UNIVERSE_VERSION,
  adjustForSplits,
  breadthHistory,
  breadthSignals,
  etDate,
  fetchGroupedDaily,
  fetchSplitsSince,
  fetchTickersOfType,
  marketMovers,
  moversSession,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type MassiveConfig,
  type TickerSeries,
  strengthRanks,
} from '@marsad/core';
import type { BreadthRow, Store, StoredMovers, UniverseRow } from './store.js';

export interface BreadthJobDeps {
  http: HttpClient;
  cfg: MassiveConfig;
  store: Store;
  now: () => Date;
  /** How far back the history reaches, in calendar days (the free plan allows 2 years). */
  historyDays?: number;
  /** Most new sessions fetched in one run (the first run fetches about 520). */
  maxNewSessions?: number;
  /** Universe size; 1,000 in production, smaller in tests. */
  universeSize?: number;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Weekdays from `from` up to but not including `to` (market holidays are found when the vendor returns nothing). */
export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = day(from); t < day(to); t += DAY) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) out.push(iso(t));
  }
  return out;
}

/** The date of each ticker-list snapshot: the first weekday from the 2nd of January, April, July and October. */
export function quarterSnapshotDates(from: string, to: string): string[] {
  const out: string[] = [];
  const [y0] = from.split('-').map(Number) as [number];
  const [y1] = to.split('-').map(Number) as [number];
  for (let y = y0 - 1; y <= y1; y++)
    for (const m of [1, 4, 7, 10]) {
      let t = Date.UTC(y, m - 1, 2);
      while ([0, 6].includes(new Date(t).getUTCDay())) t += DAY;
      const d = iso(t);
      if (d <= to) out.push(d);
    }
  // Keep the last snapshot on or before `from` (it covers the first months) and every one after it.
  const before = out.filter((d) => d <= from);
  return [...before.slice(-1), ...out.filter((d) => d > from)];
}

/**
 * Keeps the stored market snapshots up to date (one grouped-daily call per missing session), refreshes the quarterly
 * ticker lists and the all-market split history, then recomputes every universe and every breadth day from what is
 * stored (ADR 0010). Resumable: sessions already stored are never fetched again, so a failed first run continues.
 */
export async function runBreadthJob(deps: BreadthJobDeps): Promise<JobRunRecord> {
  const { http, cfg, store, now } = deps;
  const run = await runJob(
    'massive-breadth',
    async () => {
      const started = now().getTime();
      const today = etDate(now());
      const start = iso(day(today) - (deps.historyDays ?? 730) * DAY);
      const failed: string[] = [];

      // 1. Sessions not stored yet, oldest first; today is left out until it is complete.
      const stored = new Set((await store.getSnapshotDates()).map((s) => s.date));
      const missing = weekdaysBetween(start, today).filter((d) => !stored.has(d));
      let fetched = 0;
      let closed = 0;
      for (const d of missing.slice(0, deps.maxNewSessions ?? missing.length)) {
        const r = await fetchGroupedDaily(http, cfg, d);
        if (!r.ok) {
          failed.push(`grouped ${d}: ${r.display} (${r.kind}: ${r.message})`);
          break; // keep the order: the next run continues from here
        }
        const rows = r.data.value ?? [];
        await store.saveSnapshot(d, rows, now());
        if (rows.length === 0) closed += 1;
        fetched += 1;
      }

      // 2. Ticker lists (common stocks and ETFs) as of each quarter, so delisted names count while they traded.
      const haveTypes = new Set((await store.getTickerTypeSnapshots()).map((s) => s.asOf));
      for (const asOf of quarterSnapshotDates(start, iso(day(today) - DAY))) {
        if (haveTypes.has(asOf) || failed.length > 0) continue;
        const cs = await fetchTickersOfType(http, cfg, 'CS', asOf);
        const etf = cs.ok ? await fetchTickersOfType(http, cfg, 'ETF', asOf) : cs;
        if (!cs.ok || !etf.ok) {
          const bad = !cs.ok ? cs : etf;
          if (!bad.ok) failed.push(`tickers ${asOf}: ${bad.display} (${bad.kind}: ${bad.message})`);
          continue;
        }
        await store.saveTickerTypeSnapshot(asOf, cs.data.value ?? [], etf.data.value ?? []);
      }

      // 3. Splits: everything since the start the first time, then the last two weeks again (late corrections).
      if (failed.length === 0) {
        const known = await store.getShareChanges(start);
        const latest = known.reduce((m, s) => (s.executionDate > m ? s.executionDate : m), '');
        const since = latest === '' ? start : iso(day(latest) - 14 * DAY);
        const s = await fetchSplitsSince(http, cfg, since);
        if (s.ok)
          await store.upsertSplits(
            (s.data.value ?? []).map((x) => ({
              ticker: x.ticker,
              executionDate: x.executionDate,
              splitFrom: x.splitFrom,
              splitTo: x.splitTo,
              adjustmentType: x.adjustmentType,
              vendorId: x.vendorId,
            })),
            now(),
          );
        else failed.push(`splits since ${since}: ${s.display} (${s.kind}: ${s.message})`);
      }

      // 4. Recompute everything from what is stored.
      const snaps = await store.loadSnapshots(start);
      const dates = snaps.map((s) => s.date);
      const raw = new Map<string, { close: (number | null)[]; volume: (number | null)[] }>();
      snaps.forEach((s, i) => {
        for (const r of s.rows) {
          let t = raw.get(r.ticker);
          if (!t) {
            t = {
              close: new Array(dates.length).fill(null),
              volume: new Array(dates.length).fill(null),
            };
            raw.set(r.ticker, t);
          }
          t.close[i] = r.close;
          t.volume[i] = r.volume;
        }
      });
      const shareChanges = await store.getShareChanges(start);
      const series = adjustForSplits(dates, raw as Map<string, TickerSeries>, shareChanges);
      const types = await store.getTickerTypeSnapshots();
      const sets = types.map((t) => ({ asOf: t.asOf, set: new Set([...t.cs, ...t.etf]) }));
      const listAt = (i: number) => {
        const d = dates[i] as string;
        return [...sets].reverse().find((s) => s.asOf <= d) ?? sets[0];
      };
      const eligibleAt = (i: number): ReadonlySet<string> => listAt(i)?.set ?? new Set<string>();
      if (sets.length === 0 && dates.length > 0) {
        if (failed.length > 0)
          throw new Error(
            `Breadth: ${fetched} sessions fetched, then: ${failed.join('; ')}. Stored sessions were kept; the next run continues.`.slice(
              0,
              480,
            ),
          );
        throw new Error('No common-stock or ETF ticker lists stored, so no universe can be built');
      }
      const h = breadthHistory(dates, series, eligibleAt, deps.universeSize);
      const signals = breadthSignals(h.days);
      const rows: BreadthRow[] = h.days.map((d, i) => {
        const s = signals[i];
        return {
          ...d,
          advanceAvg10: s?.advanceAvg10 ?? null,
          zweigThrust: s?.zweigThrust ?? false,
          volumeRatio: s?.volumeRatio ?? null,
          mcclellanOscillator: s?.mcclellanOscillator ?? null,
          mcclellanSummation: s?.mcclellanSummation ?? null,
        };
      });
      const universe: UniverseRow[] = h.universes.flatMap((u) =>
        u.members.map((m) => ({
          monthStart: u.date,
          ticker: m.ticker,
          rank: m.rank,
          dollarVolume: m.dollarVolume,
        })),
      );
      await store.upsertUniverse(UNIVERSE_VERSION, universe);
      const written = await store.upsertBreadthDays(rows);

      // Movers and the sector heatmap for the last 5 sessions (ADR 0014), from the month's universe, and the
      // whole-market movers (movers-1, ADR 0049) over every common stock and ETF stored that session.
      const movers: StoredMovers[] = [];
      for (let i = Math.max(1, dates.length - 5); i < dates.length; i++) {
        const d = dates[i] as string;
        const u = [...h.universes].reverse().find((x) => x.date <= d);
        if (!u) continue;
        movers.push({
          ...marketMovers(dates, series, new Set(u.members.map((m) => m.ticker)), i),
          market: moversSession({
            dates,
            series,
            eligible: eligibleAt(i),
            eligibleAsOf: listAt(i)?.asOf ?? null,
            splits: shareChanges,
            i,
          }),
        });
      }
      await store.upsertMovers(movers);

      // Strength rank of the newest session within its month's universe (strength-1, council leftover).
      const lastAt = dates.length - 1;
      const lastUniverse = [...h.universes].reverse().find((x) => x.at <= lastAt);
      const ranks = lastUniverse
        ? strengthRanks(
            series,
            lastUniverse.members.map((m) => m.ticker),
            lastAt,
          )
        : [];
      if (ranks.length > 0) await store.upsertStrengthRanks(dates[lastAt] as string, ranks);

      const last = rows.at(-1);
      if (failed.length > 0)
        throw new Error(
          `Breadth: ${fetched} sessions fetched, then: ${failed.join('; ')}. Stored sessions were kept; the next run continues.`.slice(
            0,
            480,
          ),
        );
      await store.updateSourceStatus({
        source: 'massive_breadth',
        lastMessageAt: now(),
        latencyMs: now().getTime() - started,
        planTier: 'end-of-day',
        state: 'live',
        note: last
          ? `${BREADTH_VERSION}: ${dates.length} sessions, latest ${last.date}, ${last.members} members`
          : 'No sessions stored yet',
      });
      return {
        rows: written,
        details: {
          fetched,
          closed,
          sessions: dates.length,
          universes: h.universes.length,
          latest: last?.date,
          above200: last ? `${last.above200}/${last.n200}` : null,
          above50: last ? `${last.above50}/${last.n50}` : null,
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
