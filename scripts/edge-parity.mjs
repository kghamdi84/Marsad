/**
 * Runs the same core calculations under Node (from packages/core/src) and under Deno (from the generated
 * Edge Function copy) and prints JSON, so CI can require byte-identical output. One engine, two runtimes
 * (integrity rule 3). Usage:
 *   node --import tsx scripts/edge-parity.mjs packages/core/src/index.ts
 *   deno run -A --no-lock scripts/edge-parity.mjs supabase/functions/_shared/core/index.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (globalThis.Deno ? globalThis.Deno.args : process.argv.slice(2))[0];
if (!arg) throw new Error('Pass the path to the core index.ts');
const core = await import(pathToFileURL(resolve(arg)).href);

const upcoming = JSON.parse(
  readFileSync(join(root, 'fixtures/massive/market-status-upcoming.json'), 'utf8'),
);
const golden = JSON.parse(readFileSync(join(root, 'fixtures/indicators/golden.json'), 'utf8'));
const cal = core.buildCalendar(upcoming.data, 'NYSE');
const instants = [
  '2026-11-24T14:00:00Z', // pre-market
  '2026-11-24T20:46:00Z', // regular
  '2026-11-27T19:30:00Z', // day after Thanksgiving, early close
  '2026-11-26T15:00:00Z', // Thanksgiving, closed
];
const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
const highs = closes.map((c) => c + 1);
const lows = closes.map((c) => c - 1);
const volume = closes.map((_, i) => 1000 + i * 10);
const aiPayload = {
  facts: [
    { id: 'F1', label: 'Revenue', value: 4_180_000_000, unit: 'usd' },
    { id: 'F2', label: 'Revenue growth', value: 12.4, unit: 'pct' },
    { id: 'F3', label: 'Operating margin change', value: -2.5, unit: 'pct' },
    { id: 'F4', label: '8-K item 5.02 filed in FY2026', value: '5.02', unit: 'text' },
  ],
  documents: [],
};
const policy = core.DEFAULT_SOURCE_POLICIES.find((p) => p.source === 'nasdaq_halts');
const out = {
  sma: core.sma(closes, 20),
  ema: core.ema(closes, 12),
  rsi: core.rsi(closes, 14),
  atr: core.atr(highs, lows, closes, 14),
  vwap: core.vwap(highs, lows, closes, volume),
  rvol: core.rvol(volume, 20),
  macd: core.macd(closes),
  sessions: instants.map((i) => core.sessionInfo(new Date(i), cal)),
  health: core.evaluateSourceHealth(
    policy,
    new Date('2026-11-24T20:10:00Z'),
    new Date('2026-11-24T20:46:00Z'),
    cal,
  ),
  etWall: core.etWallToUtc('2026-11-24', 9, 30).toISOString(),
  goldenKeys: Object.keys(golden).sort(),
  // The verifier and the filings and news knowledge must behave identically in both runtimes.
  verify: [
    'Revenue was $4.18B [F1]. Revenue grew 12.4% year over year [F2].',
    'Revenue grew 14.1% year over year [F2].',
    'Operating margin rose 2.5% [F3].',
    'Revenue was $4.2B [F2].',
    'The FY2026 10-K lists item 5.02 [F4].',
  ].map((t) => core.verifyText(t, aiPayload)),
  eightK: core.describeEightK(['9.01', '2.02', '5.02']),
  news: core.clusterNews([
    {
      id: 'a',
      publisher: 'Reuters',
      title: 'Nvidia CEO Jensen Huang reinstated after board vote',
      publishedAt: '2026-11-24T14:00:00Z',
      url: 'u',
      tickers: ['NVDA'],
    },
    {
      id: 'b',
      publisher: 'Bloomberg',
      title: 'Nvidia reinstates CEO Jensen Huang after board vote',
      publishedAt: '2026-11-24T14:20:00Z',
      url: 'u',
      tickers: ['NVDA'],
    },
  ]),
  form4: (() => {
    const f4 = JSON.parse(
      readFileSync(join(root, 'fixtures/sec/form4-0001696841-26-000016.json'), 'utf8'),
    );
    const doc = core.parseForm4(f4.body);
    return { doc, summary: core.summarizeForm4(doc) };
  })(),
  // Forms 3 and 5 (holdings, no-securities flag, amendments, joint owners) and the recent open-market totals.
  holdings: (() => {
    const names = [
      'form3-0002164059-26-000002',
      'form3-0001773751-26-000248',
      'form3A-0001209191-22-023889',
      'form5-0001193125-26-055644',
      'form5A-0001045810-25-000070',
    ];
    const docs = names.map((n) =>
      core.parseForm4(JSON.parse(readFileSync(join(root, `fixtures/sec/${n}.json`), 'utf8')).body),
    );
    const lines = docs.flatMap((d) =>
      d.transactions.map((t) => ({
        table: t.table,
        date: t.date,
        code: t.code,
        shares: t.shares,
        valueUsd: t.valueUsd,
        isAmendment: d.isAmendment,
      })),
    );
    return { docs, totals: core.summarizeRecentOpenMarket(lines, '2023-01-01') };
  })(),
  financials: (() => {
    const cf = JSON.parse(
      readFileSync(join(root, 'fixtures/sec/companyfacts-NVDA-trimmed.json'), 'utf8'),
    );
    const parsed = core.parseCompanyFacts(cf.body);
    return core.summarizeFinancials(parsed.facts, '2026-12-31');
  })(),
  // Winter and summer release times, an after-close, a before-open and a pending release: the session logic reads
  // New York wall-clock time through Intl, which is the part most likely to differ between Node and Deno.
  earnings: (() => {
    const cf = JSON.parse(
      readFileSync(join(root, 'fixtures/sec/companyfacts-NVDA-trimmed.json'), 'utf8'),
    );
    const quarters = core.summarizeFinancials(
      core.parseCompanyFacts(cf.body).facts,
      '2026-12-31',
    ).quarters;
    const bar = (date, close) => ({
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
      vwap: close,
    });
    const eightK = (accession, acceptedAt) => ({
      accession,
      form: '8-K',
      filingDate: acceptedAt.slice(0, 10),
      acceptedAt,
      items: ['2.02', '9.01'],
    });
    return core.buildEarningsHistory({
      quarters,
      filings: [
        eightK('winter-after-close', '2026-01-27T21:10:00Z'),
        eightK('summer-before-open', '2026-08-19T11:00:00Z'),
        eightK('pending', '2026-11-17T21:20:51.000Z'),
      ],
      bars: [
        bar('2026-01-26', 50),
        bar('2026-01-27', 52),
        bar('2026-01-28', 40),
        bar('2026-08-18', 100),
        bar('2026-08-19', 110),
        bar('2026-11-16', 190),
        bar('2026-11-17', 200),
        bar('2026-11-18', 210),
      ],
      splits: [],
    });
  })(),
  // The year-over-year risk-factor comparison on the two real NVIDIA 10-Ks: sentence splitting uses a lookbehind and
  // Unicode letter classes, so Node and Deno must agree on every sentence and score.
  riskDiff: (() => {
    const f = JSON.parse(
      readFileSync(join(root, 'fixtures/massive/sections-NVDA-risk_factors.json'), 'utf8'),
    );
    const [newer, older] = f.body.results;
    const d = core.diffRiskFactors(older.text, newer.text);
    return {
      counts: [
        d.oldSentences,
        d.newSentences,
        d.unchanged,
        d.added.length,
        d.removed.length,
        d.changed.length,
      ],
      added: d.added.map((s) => s.text),
      removed: d.removed.map((s) => s.text),
      changed: d.changed.map((c) => [c.before.text, c.after.text, c.similarity]),
      firstWords: d.changed[0]?.words,
    };
  })(),
  // The regime label history and the recession filter on the real FRED downloads (ADR 0009).
  regime: (() => {
    const load = (id) =>
      JSON.parse(readFileSync(join(root, `fixtures/fred/fredgraph-${id}.json`), 'utf8'))
        .body.trim()
        .split('\n')
        .slice(1)
        .map((l) => l.split(','))
        .filter(([, v]) => v !== undefined && v !== '' && v !== '.')
        .map(([date, v]) => ({ date, value: Number(v) }));
    const s = {};
    for (const id of [
      'SP500',
      'VIXCLS',
      'VXVCLS',
      'T10Y3M',
      'BAMLH0A0HYM2',
      'ICSA',
      'NFCI',
      'SAHMREALTIME',
    ])
      s[id] = load(id);
    const days = core.regimeHistory(s.SP500, s.VIXCLS, s.VXVCLS);
    return {
      labels: days.map((d) => `${d.date} ${d.label} ${d.reason}`),
      filters: ['2021-06-30', '2023-06-30', '2024-08-10', '2026-11-24'].map((d) =>
        core.recessionFilter(s, d),
      ),
      stress: core.eventStudy(
        s.SP500,
        days.map((d) => d.label === 'stress'),
      ),
    };
  })(),
  // Universe breadth on the seeded synthetic market (ADR 0010), with its signals and a split adjustment.
  breadth: (() => {
    const f = JSON.parse(
      readFileSync(join(root, 'fixtures/breadth/synthetic-breadth.json'), 'utf8'),
    );
    const series = new Map(Object.entries(f.series));
    const eligible = new Set(f.eligible);
    const h = core.breadthHistory(f.dates, series, () => eligible, f.size);
    const adjusted = core.adjustForSplits(
      f.dates.slice(0, 4),
      new Map([['X', { close: [10, 10, 5, 5], volume: [1, 1, 2, 2] }]]),
      [{ ticker: 'X', executionDate: f.dates[2], splitFrom: 1, splitTo: 2 }],
    );
    return {
      universes: h.universes,
      days: h.days,
      signals: core.breadthSignals(h.days),
      adjusted: adjusted.get('X'),
    };
  })(),
  // Fear and Greed composite on the real FRED fixtures and the seeded synthetic market (ADR 0011), the capitulation
  // watch on the brief's example, and a staged plan on the synthetic SPY bars.
  fearGreed: (() => {
    const f = JSON.parse(
      readFileSync(join(root, 'fixtures/feargreed/synthetic-feargreed.json'), 'utf8'),
    );
    const fredCsv = (id) =>
      JSON.parse(readFileSync(join(root, `fixtures/fred/fredgraph-${id}.json`), 'utf8'))
        .body.trim()
        .split('\n')
        .slice(1)
        .map((l) => l.split(','))
        .filter(([, v]) => v !== '' && v !== '.')
        .map(([date, v]) => ({ date, value: Number(v) }));
    const pairs = (p) => p.map(([date, value]) => ({ date, value }));
    const days = core.fearGreedHistory({
      sp500: fredCsv('SP500'),
      vix: fredCsv('VIXCLS'),
      highYield: fredCsv('BAMLH0A0HYM2'),
      investmentGrade: fredCsv('BAMLC0A0CM'),
      breadth: f.breadth,
      spy: pairs(f.spy),
      ief: pairs(f.ief),
    });
    const spy = f.spy.map(([date, close]) => ({ date, low: close, close }));
    return {
      days: days.slice(-40),
      count: days.length,
      capitulation: core.capitulationDay({
        date: '2026-11-23',
        vix: 35.9,
        above50: 90,
        n50: 1000,
        composite: 6,
        recession: 'low',
      }),
      plan: core.stagedPlan(spy.at(-61).date, spy, new Map()),
    };
  })(),
  // Geopolitical topic counts on the real news sample (ADR 0012).
  topics: (() => {
    const f = JSON.parse(
      readFileSync(join(root, 'fixtures/massive/news-market-sample-2026-11-24.json'), 'utf8'),
    );
    const articles = core.parseNewsItems(f.body.results);
    const day = core.topicDay('2026-11-24', articles);
    return { day, summary: core.topicSummary([day], '2026-11-24') };
  })(),
  // Economic calendar on the real FRED release dates and an earnings estimate (ADR 0013).
  calendar: (() => {
    const f = JSON.parse(
      readFileSync(join(root, 'fixtures/fred/fred-release-dates-2026-11-25.json'), 'utf8'),
    );
    const dates = f.body.release_dates.map((d) => ({
      releaseId: d.release_id,
      releaseName: d.release_name,
      date: d.date,
    }));
    return {
      events: core.economicCalendar(dates, '2026-11-25', '2027-01-24'),
      estimate: core.estimateNextEarnings(['2025-11-19', '2026-02-25', '2026-11-17'], '2026-11-25'),
    };
  })(),
  // Watch dashboard numbers (ADR 0014) on synthetic bars and a small synthetic market.
  watch: (() => {
    const bars = Array.from({ length: 260 }, (_, i) => ({
      date: `d${i}`,
      open: 100 + Math.sin(i) * 3,
      high: 110,
      low: 90,
      close: 100 + Math.sin(i / 3) * 5,
      volume: 1000 + (i % 7) * 50,
      vwap: null,
    }));
    const series = new Map([
      ['A', { close: [10, 11], volume: [5, 5] }],
      ['B', { close: [10, 9], volume: [5, 5] }],
      ['XLK', { close: [200, 202], volume: [5, 5] }],
    ]);
    return {
      summary: core.tickerSummary(bars),
      movers: core.marketMovers(['d0', 'd1'], series, new Set(['A', 'B']), 1),
    };
  })(),
  // Brief templates (ADR 0015).
  brief: core.preMarketBrief({
    date: '2026-11-25',
    regime: { date: '2026-11-24', label: 'stress', recession: 'elevated' },
    fearGreed: { date: '2026-11-24', composite: 41.88, label: 'fear', available: 5 },
    capitulation: null,
    vix: { date: '2026-11-24', value: 26.62 },
    vix3m: { date: '2026-11-24', value: 25.5 },
    breadth: { date: '2026-11-24', pctAbove50: 38.25, pctAbove200: null },
    events: [{ date: '2026-11-25', timeEt: '08:30', name: 'GDP', impact: 'high' }],
    earnings: [],
    watchlist: [{ ticker: 'NVDA', date: '2026-11-24', change1d: 0.0412 }],
    topic: null,
    staleSources: [],
  }),
  // Statistics and the rule evaluator (ADR 0016).
  stats: (() => {
    const f = JSON.parse(readFileSync(join(root, 'fixtures/stats/reference.json'), 'utf8'));
    return {
      cdf: [-3, -1, 0, 1.5, 4].map((x) => core.normCdf(x)),
      inv: [0.001, 0.05, 0.5, 0.95].map((p) => core.normInv(p)),
      wilson: core.wilson(97, 212),
      trade: core.tradeStats(f.returns),
      dsr: core.deflatedSharpe(f.returns, 20, 0.0025),
      boot: core.bootstrap(f.returns, core.mean, { resamples: 500, seed: 9 }),
    };
  })(),
  rules: (() => {
    const bars = Array.from({ length: 120 }, (_, i) => {
      const c = 100 + Math.sin(i / 5) * 8 + i * 0.1;
      return {
        date: `d${i}`,
        open: c,
        high: c + 1,
        low: c - 1,
        close: c,
        volume: 1000 + i,
        vwap: null,
      };
    });
    const ev = new core.RuleEvaluator(bars);
    const rule = {
      all: [
        { left: { ind: 'close' }, op: 'crossesAbove', right: { ind: 'sma', period: 20 } },
        { left: { ind: 'rsi', period: 14 }, op: '<', right: 70 },
      ],
    };
    return {
      signals: ev.signals(rule),
      hash: core.ruleHash({ id: 'x-y', name: 'n', side: 'long', entry: rule, maxHoldBars: 5 }),
    };
  })(),
  rounding: [81.615, 1.005, 2.675, -2.675, 0.5, 188.4, 1e21].map((n) => core.toFixedHalfUp(n, 2)),
  cost: core.costOfUsage('claude-sonnet-5-5', {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 40000,
    cacheWriteTokens: 8000,
  }),
};
console.log(JSON.stringify(out));
