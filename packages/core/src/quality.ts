/**
 * Quality at a discount (quality-1, ADR 0035): the brief's long-term strategy 5, refreshed weekly and shown with
 * the capitulation watch. Quality follows Novy-Marx ("The Other Side of Value", JFE 2013: gross profits over
 * assets) and Asness, Frazzini and Pedersen ("Quality Minus Junk", RAS 2019: profitability, low accruals, low
 * leverage); value is the earnings yield and book-to-market (Graham). Pure: the job supplies SEC XBRL frame values
 * and the stored closes. Every measure is a percentile within the eligible universe, so a score says "better than
 * this share of the companies screened", never a forecast.
 */
export const QUALITY_VERSION = 'quality-1';

/** Fewer eligible companies than this: no ranking is published (percentiles of a handful mean little). */
export const QUALITY_MIN_UNIVERSE = 30;
export const QUALITY_PASS = { quality: 70, value: 50 } as const;

export interface QualityInput {
  ticker: string;
  cik: string;
  name: string;
  grossProfit: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  shares: number | null;
  price: number | null;
  /** Fallback figures used for this company (see assembleQualityInputs). */
  notes?: string[];
}

export interface QualityMetrics {
  grossProfitability: number;
  roa: number;
  accruals: number;
  leverage: number;
  marketCap: number;
  earningsYield: number;
  bookToMarket: number;
}

export interface QualityRow extends QualityInput {
  metrics: QualityMetrics;
  /** Percentiles (0 to 100) of each measure, higher is better. */
  pct: Record<keyof Omit<QualityMetrics, 'marketCap'>, number>;
  quality: number;
  value: number;
  combined: number;
  passes: boolean;
}

export type Exclusion =
  'missing-data' | 'no-gross-profit' | 'not-profitable' | 'negative-equity' | 'no-price';

export interface QualityScreen {
  version: string;
  eligible: number;
  excluded: Record<Exclusion, number>;
  /** Every eligible company, best combined score first; empty when the universe is too small. */
  ranked: QualityRow[];
  /** Null when there are at least QUALITY_MIN_UNIVERSE eligible companies. */
  insufficient: string | null;
}

function exclusion(x: QualityInput): Exclusion | null {
  if (x.grossProfit === null) return 'no-gross-profit';
  if (
    x.netIncome === null ||
    x.operatingCashFlow === null ||
    x.assets === null ||
    !(x.assets > 0) ||
    x.liabilities === null ||
    x.equity === null ||
    x.shares === null ||
    !(x.shares > 0)
  )
    return 'missing-data';
  if (x.price === null || !(x.price > 0)) return 'no-price';
  if (!(x.netIncome > 0)) return 'not-profitable';
  if (!(x.equity > 0)) return 'negative-equity';
  return null;
}

/** Percentile of each value among all values, 0 for the lowest and 100 for the highest; ties share the average. */
export function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 1) return [50];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n);
  for (let k = 0; k < n;) {
    let j = k;
    while (j + 1 < n && (order[j + 1] as { v: number }).v === (order[k] as { v: number }).v) j++;
    const pct = (100 * ((k + j) / 2)) / (n - 1);
    for (let m = k; m <= j; m++) out[(order[m] as { i: number }).i] = pct;
    k = j + 1;
  }
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function qualityScreen(inputs: readonly QualityInput[]): QualityScreen {
  const excluded: Record<Exclusion, number> = {
    'missing-data': 0,
    'no-gross-profit': 0,
    'not-profitable': 0,
    'negative-equity': 0,
    'no-price': 0,
  };
  const ok: { x: QualityInput; m: QualityMetrics }[] = [];
  for (const x of inputs) {
    const why = exclusion(x);
    if (why) {
      excluded[why] += 1;
      continue;
    }
    const assets = x.assets as number;
    const marketCap = (x.shares as number) * (x.price as number);
    ok.push({
      x,
      m: {
        grossProfitability: (x.grossProfit as number) / assets,
        roa: (x.netIncome as number) / assets,
        accruals: ((x.netIncome as number) - (x.operatingCashFlow as number)) / assets,
        leverage: (x.liabilities as number) / assets,
        marketCap,
        earningsYield: (x.netIncome as number) / marketCap,
        bookToMarket: (x.equity as number) / marketCap,
      },
    });
  }
  if (ok.length < QUALITY_MIN_UNIVERSE)
    return {
      version: QUALITY_VERSION,
      eligible: ok.length,
      excluded,
      ranked: [],
      insufficient: `Only ${ok.length} companies have every input (at least ${QUALITY_MIN_UNIVERSE} are needed for a ranking).`,
    };
  // Lower accruals and lower leverage are better, so they are ranked on their negatives.
  const p = {
    grossProfitability: percentiles(ok.map((o) => o.m.grossProfitability)),
    roa: percentiles(ok.map((o) => o.m.roa)),
    accruals: percentiles(ok.map((o) => -o.m.accruals)),
    leverage: percentiles(ok.map((o) => -o.m.leverage)),
    earningsYield: percentiles(ok.map((o) => o.m.earningsYield)),
    bookToMarket: percentiles(ok.map((o) => o.m.bookToMarket)),
  };
  const ranked = ok.map(({ x, m }, i): QualityRow => {
    const pct = {
      grossProfitability: p.grossProfitability[i] as number,
      roa: p.roa[i] as number,
      accruals: p.accruals[i] as number,
      leverage: p.leverage[i] as number,
      earningsYield: p.earningsYield[i] as number,
      bookToMarket: p.bookToMarket[i] as number,
    };
    const quality = mean([pct.grossProfitability, pct.roa, pct.accruals, pct.leverage]);
    const value = mean([pct.earningsYield, pct.bookToMarket]);
    return {
      ...x,
      metrics: m,
      pct,
      quality,
      value,
      combined: (quality + value) / 2,
      passes: quality >= QUALITY_PASS.quality && value >= QUALITY_PASS.value,
    };
  });
  ranked.sort((a, b) => b.combined - a.combined || a.ticker.localeCompare(b.ticker));
  return { version: QUALITY_VERSION, eligible: ok.length, excluded, ranked, insufficient: null };
}

export interface FrameSpec {
  taxonomy: 'us-gaap' | 'dei';
  concept: string;
  unit: 'USD' | 'shares';
  /** Balance-sheet figures are read at the year end (instant frame); flows over the calendar year. */
  instant: boolean;
}

/** Every frame the screen reads, primary concepts first, then the fallbacks. */
export const QUALITY_FRAMES: readonly FrameSpec[] = [
  { taxonomy: 'us-gaap', concept: 'GrossProfit', unit: 'USD', instant: false },
  { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', unit: 'USD', instant: false },
  {
    taxonomy: 'us-gaap',
    concept: 'NetCashProvidedByUsedInOperatingActivities',
    unit: 'USD',
    instant: false,
  },
  { taxonomy: 'us-gaap', concept: 'Assets', unit: 'USD', instant: true },
  { taxonomy: 'us-gaap', concept: 'Liabilities', unit: 'USD', instant: true },
  { taxonomy: 'us-gaap', concept: 'StockholdersEquity', unit: 'USD', instant: true },
  { taxonomy: 'dei', concept: 'EntityCommonStockSharesOutstanding', unit: 'shares', instant: true },
  { taxonomy: 'us-gaap', concept: 'CommonStockSharesOutstanding', unit: 'shares', instant: true },
  {
    taxonomy: 'us-gaap',
    concept: 'RevenueFromContractWithCustomerExcludingAssessedTax',
    unit: 'USD',
    instant: false,
  },
  { taxonomy: 'us-gaap', concept: 'Revenues', unit: 'USD', instant: false },
  { taxonomy: 'us-gaap', concept: 'CostOfRevenue', unit: 'USD', instant: false },
  { taxonomy: 'us-gaap', concept: 'CostOfGoodsAndServicesSold', unit: 'USD', instant: false },
  { taxonomy: 'us-gaap', concept: 'ProfitLoss', unit: 'USD', instant: false },
  {
    taxonomy: 'us-gaap',
    concept: 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    unit: 'USD',
    instant: true,
  },
  {
    taxonomy: 'us-gaap',
    concept: 'WeightedAverageNumberOfDilutedSharesOutstanding',
    unit: 'shares',
    instant: false,
  },
];

/**
 * The fiscal year whose frames are complete enough: most December year-end companies file their annual report by
 * the end of March, so from April the previous calendar year is used, before that the one before.
 */
export function qualityFrameYear(today: string): number {
  const y = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 4 ? y - 1 : y - 2;
}

export const framePeriod = (spec: FrameSpec, year: number) =>
  spec.instant ? `CY${year}Q4I` : `CY${year}`;

/** Frame values by concept, then by 10-digit CIK. */
export type FrameMaps = Readonly<Record<string, ReadonlyMap<string, number>>>;

/**
 * Builds screen inputs from frames, first available figure in each chain, with every fallback named on the row:
 * gross profit (GrossProfit, else revenue minus cost of revenue), net income (NetIncomeLoss, else ProfitLoss),
 * equity (StockholdersEquity, else including noncontrolling interest), liabilities (Liabilities, else assets minus
 * equity), shares (cover-page shares, else balance-sheet shares, else diluted weighted-average shares).
 */
export function assembleQualityInputs(
  frames: FrameMaps,
  companies: readonly { ticker: string; cik: string; name: string }[],
  prices: ReadonlyMap<string, number>,
): QualityInput[] {
  const get = (concept: string, cik: string) => frames[concept]?.get(cik) ?? null;
  return companies.map((c) => {
    const notes: string[] = [];
    let grossProfit = get('GrossProfit', c.cik);
    if (grossProfit === null) {
      const revenue =
        get('RevenueFromContractWithCustomerExcludingAssessedTax', c.cik) ?? get('Revenues', c.cik);
      const cost = get('CostOfRevenue', c.cik) ?? get('CostOfGoodsAndServicesSold', c.cik);
      if (revenue !== null && cost !== null) {
        grossProfit = revenue - cost;
        notes.push('gross profit = revenue minus cost of revenue');
      }
    }
    let netIncome = get('NetIncomeLoss', c.cik);
    if (netIncome === null && (netIncome = get('ProfitLoss', c.cik)) !== null)
      notes.push('net income includes noncontrolling interest (ProfitLoss)');
    let equity = get('StockholdersEquity', c.cik);
    if (
      equity === null &&
      (equity = get(
        'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
        c.cik,
      )) !== null
    )
      notes.push('equity includes noncontrolling interest');
    const assets = get('Assets', c.cik);
    let liabilities = get('Liabilities', c.cik);
    if (liabilities === null && assets !== null && equity !== null) {
      liabilities = assets - equity;
      notes.push('liabilities = assets minus equity');
    }
    let shares = get('EntityCommonStockSharesOutstanding', c.cik);
    if (shares === null && (shares = get('CommonStockSharesOutstanding', c.cik)) !== null)
      notes.push('shares from the balance sheet');
    if (
      shares === null &&
      (shares = get('WeightedAverageNumberOfDilutedSharesOutstanding', c.cik)) !== null
    )
      notes.push('shares = diluted weighted average for the year');
    return {
      ticker: c.ticker,
      cik: c.cik,
      name: c.name,
      grossProfit,
      netIncome,
      operatingCashFlow: get('NetCashProvidedByUsedInOperatingActivities', c.cik),
      assets,
      liabilities,
      equity,
      shares,
      price: prices.get(c.ticker) ?? null,
      notes,
    };
  });
}
