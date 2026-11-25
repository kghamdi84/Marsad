import {
  QUALITY_FRAMES,
  QUALITY_VERSION,
  assembleQualityInputs,
  fetchCompanyTickers,
  fetchFrame,
  framePeriod,
  qualityFrameYear,
  qualityScreen,
  runJob,
  type HttpClient,
  type JobRunRecord,
  type QualityRow,
  type SecConfig,
} from '@marsad/core';

/** How many ranked companies are stored per screen (the passing ones are always among the first). */
export const QUALITY_STORED = 50;

export interface QualityStore {
  /** The newest month of the Marsad universe (top 1,000 US common stocks by dollar volume). */
  getLatestUniverse(): Promise<{ monthStart: string; tickers: string[] } | null>;
  /** The newest stored session closes for every US ticker. */
  getLatestCloses(): Promise<{ date: string; closes: Map<string, number> } | null>;
  saveQualityScreen(
    run: {
      asOf: string;
      version: string;
      fiscalYear: number;
      priceDate: string | null;
      universe: number;
      noCik: number;
      eligible: number;
      passed: number;
      excluded: Record<string, number>;
      insufficient: string | null;
    },
    rows: readonly (QualityRow & { rank: number })[],
  ): Promise<number>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface QualityJobDeps {
  http: HttpClient;
  sec: SecConfig;
  store: QualityStore;
  now: () => Date;
}

/**
 * Weekly quality-at-a-discount screen (quality-1, ADR 0035): SEC XBRL frames for the latest complete fiscal year,
 * the SEC ticker list for CIKs, the Marsad universe and the newest stored closes. A failed SEC request fails the
 * run (no partial screen is stored); companies without a CIK or without every figure are counted, not hidden.
 */
export async function runQualityJob(deps: QualityJobDeps): Promise<JobRunRecord> {
  const { http, sec, store, now } = deps;
  const run = await runJob(
    'quality-screen',
    async () => {
      const at = now();
      const today = at.toISOString().slice(0, 10);
      const year = qualityFrameYear(today);
      const universe = await store.getLatestUniverse();
      if (!universe || universe.tickers.length === 0)
        throw new Error('No Marsad universe is stored yet (the breadth job builds it).');
      const closes = await store.getLatestCloses();
      if (!closes) throw new Error('No stored market snapshot (the breadth job stores them).');
      const list = await fetchCompanyTickers(http, sec);
      if (!list.ok) throw new Error(`SEC ticker list: ${list.display}`);
      const byTicker = new Map((list.data.value ?? []).map((c) => [c.ticker, c]));
      const frames: Record<string, Map<string, number>> = {};
      for (const spec of QUALITY_FRAMES) {
        const period = framePeriod(spec, year);
        const r = await fetchFrame(http, sec, spec.taxonomy, spec.concept, spec.unit, period);
        if (!r.ok) throw new Error(`SEC frame ${spec.concept} ${period}: ${r.display}`);
        frames[spec.concept] = new Map((r.data.value ?? []).map((x) => [x.cik, x.value]));
      }
      const companies = universe.tickers.flatMap((t) => {
        const c = byTicker.get(t);
        return c ? [{ ticker: t, cik: c.cik, name: c.name }] : [];
      });
      const noCik = universe.tickers.length - companies.length;
      const screen = qualityScreen(assembleQualityInputs(frames, companies, closes.closes));
      const rows = screen.ranked.slice(0, QUALITY_STORED).map((r, i) => ({ ...r, rank: i + 1 }));
      const passed = screen.ranked.filter((r) => r.passes).length;
      const written = await store.saveQualityScreen(
        {
          asOf: today,
          version: QUALITY_VERSION,
          fiscalYear: year,
          priceDate: closes.date,
          universe: universe.tickers.length,
          noCik,
          eligible: screen.eligible,
          passed,
          excluded: screen.excluded,
          insufficient: screen.insufficient,
        },
        rows,
      );
      return {
        rows: written,
        details: {
          version: QUALITY_VERSION,
          fiscalYear: year,
          priceDate: closes.date,
          universe: universe.tickers.length,
          noCik,
          eligible: screen.eligible,
          passed,
          excluded: screen.excluded,
          ...(screen.insufficient ? { insufficient: screen.insufficient } : {}),
          top: rows.slice(0, 5).map((r) => r.ticker),
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
