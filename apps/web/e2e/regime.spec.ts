import { expect, test, type Page, type Route } from '@playwright/test';
import {
  baselineStudy,
  breadthHistory,
  breadthSignals,
  capitulationDay,
  capitulationHistory,
  eventStudy,
  fearGreedHistory,
  parseNewsItems,
  stagedPlan,
  topicDay,
  recessionFilter,
  regimeHistory,
  type BreadthInput,
  type MacroSeries,
  type Obs,
  type RecessionLevel,
} from '@marsad/core';
import synthetic from '../../../fixtures/breadth/synthetic-breadth.json' with { type: 'json' };
import fgSynthetic from '../../../fixtures/feargreed/synthetic-feargreed.json' with { type: 'json' };
import gprFixture from '../../../fixtures/gpr-daily-recent.json' with { type: 'json' };
import hy from '../../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json' with { type: 'json' };
import ig from '../../../fixtures/fred/fredgraph-BAMLC0A0CM.json' with { type: 'json' };
import dgs10 from '../../../fixtures/fred/fredgraph-DGS10.json' with { type: 'json' };
import epu from '../../../fixtures/fred/fredgraph-USEPUINDXD.json' with { type: 'json' };
import icsa from '../../../fixtures/fred/fredgraph-ICSA.json' with { type: 'json' };
import nfci from '../../../fixtures/fred/fredgraph-NFCI.json' with { type: 'json' };
import sahm from '../../../fixtures/fred/fredgraph-SAHMREALTIME.json' with { type: 'json' };
import sp from '../../../fixtures/fred/fredgraph-SP500.json' with { type: 'json' };
import t10y2y from '../../../fixtures/fred/fredgraph-T10Y2Y.json' with { type: 'json' };
import t10y3m from '../../../fixtures/fred/fredgraph-T10Y3M.json' with { type: 'json' };
import vix from '../../../fixtures/fred/fredgraph-VIXCLS.json' with { type: 'json' };
import vix3m from '../../../fixtures/fred/fredgraph-VXVCLS.json' with { type: 'json' };
import oil from '../../../fixtures/fred/fredgraph-DCOILWTICO.json' with { type: 'json' };
import dollar from '../../../fixtures/fred/fredgraph-DTWEXBGS.json' with { type: 'json' };
import newsSample from '../../../fixtures/massive/news-market-sample-2026-11-24.json' with { type: 'json' };
import { seedSession, scanAfterEach, openInfo } from './helpers';

scanAfterEach();

// Every row below is computed from the real FRED downloads in fixtures/ by the same core functions the regime job
// uses, then served in the shape of the database tables. Nothing is invented.

function csv(text: string): Obs[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .filter(([, v]) => v !== undefined && v !== '' && v !== '.')
    .map(([d, v]) => ({ date: d as string, value: Number(v) }));
}

const fred: Record<string, Obs[]> = {
  SP500: csv(sp.body),
  VIXCLS: csv(vix.body),
  VXVCLS: csv(vix3m.body),
  T10Y3M: csv(t10y3m.body),
  T10Y2Y: csv(t10y2y.body),
  DGS10: csv(dgs10.body),
  BAMLH0A0HYM2: csv(hy.body),
  BAMLC0A0CM: csv(ig.body),
  ICSA: csv(icsa.body),
  NFCI: csv(nfci.body),
  SAHMREALTIME: csv(sahm.body),
  USEPUINDXD: csv(epu.body),
  DCOILWTICO: csv(oil.body),
  DTWEXBGS: csv(dollar.body),
};

function regimeRows() {
  const days = regimeHistory(fred['SP500'] ?? [], fred['VIXCLS'] ?? [], fred['VXVCLS'] ?? []);
  return days.slice(-252).map((d) => {
    const f = recessionFilter(fred as MacroSeries, d.date);
    return {
      date: d.date,
      rule_version: d.ruleVersion,
      label: d.label,
      reason: d.reason,
      inputs: d.inputs,
      recession_version: f.ruleVersion,
      recession_level: f.level,
      recession: { available: f.available, triggered: f.triggered, signals: f.signals },
    };
  });
}

function statRows() {
  const spx = fred['SP500'] ?? [];
  const days = regimeHistory(spx, fred['VIXCLS'] ?? [], fred['VXVCLS'] ?? []);
  const out: Record<string, unknown>[] = [];
  const push = (condition: string, stats: ReturnType<typeof baselineStudy>, episodes: string[]) =>
    stats.forEach((s) =>
      out.push({
        rule_version: 'regime-1',
        condition,
        horizon: s.horizon,
        n: s.n,
        sufficient: s.sufficient,
        median: s.median,
        q1: s.q1,
        q3: s.q3,
        episodes,
        data_from: spx[0]?.date,
        data_to: spx.at(-1)?.date,
      }),
    );
  for (const label of ['stress', 'bear', 'recovery', 'bull-calm', 'bull-correction']) {
    const e = eventStudy(
      spx,
      days.map((d) => d.label === label),
    );
    push(label, e.byHorizon, e.episodes);
  }
  const vixBy = new Map((fred['VIXCLS'] ?? []).map((o) => [o.date, o.value]));
  const v30 = eventStudy(
    spx,
    spx.map((o) => (vixBy.get(o.date) ?? 0) >= 30),
  );
  push('vix-30', v30.byHorizon, v30.episodes);
  // Every day's recession level, as the regime job computes it (regimeRows serves only the last year).
  const levels = new Map(
    spx.map((o) => [o.date, recessionFilter(fred as MacroSeries, o.date).level]),
  );
  const proxy = eventStudy(
    spx,
    spx.map(
      (o) =>
        (vixBy.get(o.date) ?? 0) >= 30 &&
        ['low', 'elevated'].includes(levels.get(o.date) ?? 'unavailable'),
    ),
  );
  push('vix-30-recession-not-high', proxy.byHorizon, proxy.episodes);
  push('all-days', baselineStudy(spx), []);
  return out;
}

/** Breadth rows from the seeded synthetic market (not market data: real breadth needs the first backfill run). */
function breadthRows() {
  type Raw = { close: (number | null)[]; volume: (number | null)[] };
  const series = new Map(Object.entries(synthetic.series as Record<string, Raw>));
  const eligible = new Set(synthetic.eligible);
  const h = breadthHistory(synthetic.dates, series, () => eligible, synthetic.size);
  const sig = breadthSignals(h.days);
  return h.days.map((d, i) => ({
    date: d.date,
    version: d.version,
    members: d.members,
    with_change: d.withChange,
    advancers: d.advancers,
    decliners: d.decliners,
    unchanged: d.unchanged,
    up_volume: d.upVolume,
    down_volume: d.downVolume,
    above50: d.above50,
    n50: d.n50,
    above200: d.above200,
    n200: d.n200,
    new_highs: d.newHighs,
    new_lows: d.newLows,
    n252: d.n252,
    suspect: d.suspect,
    advance_avg10: sig[i]?.advanceAvg10 ?? null,
    zweig_thrust: sig[i]?.zweigThrust ?? false,
    volume_ratio: sig[i]?.volumeRatio ?? null,
    mcclellan_oscillator: sig[i]?.mcclellanOscillator ?? null,
    mcclellan_summation: sig[i]?.mcclellanSummation ?? null,
  }));
}

// The composite from the real FRED downloads plus the seeded synthetic breadth, SPY and IEF (the same inputs as
// the core known-answer test), computed by the job's own core function.
const pairs = (p: [string, number][]): Obs[] => p.map(([date, value]) => ({ date, value }));
function fearGreedDays() {
  return fearGreedHistory({
    sp500: fred['SP500'] ?? [],
    vix: fred['VIXCLS'] ?? [],
    highYield: fred['BAMLH0A0HYM2'] ?? [],
    investmentGrade: fred['BAMLC0A0CM'] ?? [],
    breadth: fgSynthetic.breadth as BreadthInput[],
    spy: pairs(fgSynthetic.spy as [string, number][]),
    ief: pairs(fgSynthetic.ief as [string, number][]),
  });
}
function fearGreedRows() {
  return fearGreedDays().map((d) => ({ ...d }));
}
function capitulationRows() {
  const days = fearGreedDays();
  const levels = new Map(
    regimeRows().map((r) => [r.date as string, r.recession_level as RecessionLevel]),
  );
  const b = fgSynthetic.breadth as (BreadthInput & { above50: number; n50: number })[];
  return capitulationHistory(
    days.map((d) => d.date),
    fred['VIXCLS'] ?? [],
    new Map(b.map((x) => [x.date, { above50: x.above50, n50: x.n50 }])),
    new Map(days.map((d) => [d.date, d.composite])),
    levels,
  );
}

// Topic days from the 23 real sample articles: the 28 baseline days carry the last 11 of them, the 7 recent days all
// 23. By hand: tariffs 1 a baseline day (7 a week) and 4 a recent day (28), so 4.0 times; central banks 0 then 2 a day.
function topicRows() {
  const articles = parseNewsItems(newsSample.body.results) ?? [];
  const rows = [];
  for (let i = 0; i < 35; i++) {
    const date = new Date(Date.UTC(2026, 9, 21 + i)).toISOString().slice(0, 10);
    rows.push(topicDay(date, i < 28 ? articles.slice(12) : articles));
  }
  return rows;
}

async function mock(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/rest/v1/regime_daily**', (r) => json(r, [...regimeRows()].reverse()));
  await page.route('**/rest/v1/regime_event_stats**', (r) => json(r, statRows()));
  await page.route('**/rest/v1/breadth_daily**', (r) => json(r, [...breadthRows()].reverse()));
  await page.route('**/rest/v1/news_topic_days**', (r) => json(r, [...topicRows()].reverse()));
  // GLD, ITA and IYT: the synthetic SPY closes stand in (not market data); the page only needs a series.
  await page.route('**/rest/v1/daily_bars**', (r) =>
    json(
      r,
      (fgSynthetic.spy as [string, number][])
        .slice(-260)
        .map(([date, close]) => ({ date, close }))
        .reverse(),
    ),
  );
  await page.route('**/rest/v1/fear_greed_daily**', (r) =>
    json(r, [...fearGreedRows()].reverse().slice(0, 30)),
  );
  await page.route('**/rest/v1/capitulation_daily**', (r) => {
    const onOnly = new URL(r.request().url()).searchParams.get('state') === 'eq.on';
    const rows = capitulationRows().filter((d) => !onOnly || d.state === 'on');
    return json(r, rows.reverse().slice(0, 1));
  });
  await page.route('**/rest/v1/fred_observations**', (r) => {
    const id = new URL(r.request().url()).searchParams.get('series_id')?.replace(/^eq\./, '') ?? '';
    const rows = (fred[id] ?? []).slice(-260).reverse();
    return json(r, rows);
  });
  await page.route('**/rest/v1/gpr_daily**', (r) =>
    json(
      r,
      (gprFixture.data as { date: string; GPRD: number }[])
        .map((d) => ({ date: d.date, gprd: d.GPRD }))
        .reverse(),
    ),
  );
}

/** The redesigned cards keep their full tables, rules and sources under "Show details". */
async function openDetails(page: import('@playwright/test').Page) {
  await expect(page.getByRole('region', { name: 'Market regime' })).toBeVisible();
  for (const d of await page.getByText('Show details', { exact: true }).all()) await d.click();
}

test('regime: the label with its reason and inputs, the recession filter, the event study and every panel with its source and date', async ({
  page,
}) => {
  await mock(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/regime');
  await openDetails(page);

  // The label on 2026-11-23: VIX 26.62 at or above VIX3M 25.50, with the S&P 500 below its 50-day average.
  const label = page.getByRole('region', { name: 'Market regime' });
  await expect(label.getByText('Stress', { exact: true })).toBeVisible();
  await expect(label.getByText(/VIX is at or above VIX3M \(backwardation\)/)).toBeVisible();
  await expect(label.getByText('As of the close on 2026-11-23. Rules regime-1.')).toBeVisible();
  await expect(label.getByText('26.62')).toBeVisible();
  await expect(label.getByText('25.50')).toBeVisible();
  await openInfo(page.getByRole('region', { name: 'Market regime' }));
  await expect(label.getByText(/FRED keeps 10 years|goes back 10 years/)).toBeVisible();

  // The recession filter on 2026-11-23: elevated, with only the curve triggered.
  const rec = page.getByRole('region', { name: 'Recession filter' });
  await expect(rec.getByText('Elevated', { exact: true })).toBeVisible();
  await expect(
    rec.getByText('1 of 5 available signals triggered (5 signals in total).'),
  ).toBeVisible();
  const curve = rec.getByRole('row', { name: /Yield curve/ });
  await expect(curve).toContainText('Triggered');
  await expect(curve).toContainText('inverted on 50 of the last 378 sessions');
  await expect(rec.getByRole('row', { name: /Sahm rule/ })).toContainText('Clear');
  await expect(rec.getByRole('row', { name: /Jobless claims/ })).toContainText('197,750');

  // The event study: 16 stress episodes with a 63-session return is not enough to show numbers.
  const study = page.getByRole('region', { name: 'What the S&P did next' });
  await expect(study.getByRole('row', { name: /^Stress/ })).toContainText(
    'Insufficient history: 16 episodes, 30 needed',
  );
  // The benchmark has 119 one-month windows: shown with its median and middle half.
  await expect(study.getByRole('row', { name: /All days/ })).toContainText('n 119');
  // Method and source text sits behind "About this data" (council batch 2).
  await openInfo(page);
  await expect(study.getByText(/Data 2016-11-25 to 2026-11-23/)).toBeVisible();
  await expect(study.getByRole('columnheader', { name: '6 months (126 sessions)' })).toBeVisible();
  await expect(study.getByRole('row', { name: /^VIX at or above 30 / })).toContainText(
    'Insufficient history',
  );

  // Breadth, labelled as Marsad's own universe (synthetic data here: the last synthetic day is 2026-04-08, with 6 of 12
  // above the 50-day and 8 of 12 above the 200-day, and one Zweig thrust in the series).
  const breadth = page.getByRole('region', { name: 'Marsad universe breadth' });
  await expect(breadth.getByText(/not official index breadth/)).toBeVisible();
  await expect(breadth.getByText('As of the close on 2026-04-08, 12 members.')).toBeVisible();
  const item = (label: string) =>
    breadth
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .last();
  await expect(item('Above their 50-day average')).toContainText('50.0%');
  await expect(item('Above their 200-day average')).toContainText('66.7%');
  await expect(breadth.getByText(/out of 12 with enough history/).first()).toBeVisible();
  await expect(breadth.getByText(/^Last fired \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();
  await expect(breadth.getByText(/Source: Massive grouped daily/)).toBeVisible();

  // Every panel names its source and gives the date of each value.
  const vol = page.getByRole('region', { name: 'Volatility and its term structure' });
  await expect(vol.getByRole('row', { name: /^VIX / })).toContainText('2026-11-23');
  await expect(vol.getByRole('row', { name: /^VIX / })).toContainText('96'); // 95.6, the 1-year percentile
  await expect(vol.getByText(/Source: FRED VIXCLS and VXVCLS/)).toBeVisible();
  const credit = page.getByRole('region', { name: 'Credit and the curve' });
  await expect(
    credit.getByRole('row', { name: /High-yield minus investment-grade/ }),
  ).toContainText('2.66');
  await expect(credit.getByText(/Source: FRED/)).toBeVisible();
  const unc = page.getByRole('region', { name: 'Geopolitical risk and policy uncertainty' });
  await expect(unc.getByRole('row', { name: /Geopolitical Risk/ })).toContainText('2026-11-23');
  // Only 20 GPR days are recorded in the fixture: the percentile says how few it rests on.
  await expect(unc.getByRole('row', { name: /Geopolitical Risk/ })).toContainText(
    'of 20 days only',
  );
  await expect(unc.getByText(/Caldara and Iacoviello/)).toBeVisible();
  // The composite on 2026-11-23: 41.88 from the independent implementation, so 42, fear, with 5 of 7 components.
  const fg = page.getByRole('region', { name: 'Fear and Greed composite' });
  await expect(fg.getByTestId('fear-greed-value')).toHaveText('42, Fear');
  await expect(fg.getByText(/5 of 7 components available/)).toBeVisible();
  await expect(fg.getByText(/As of the close on 2026-11-23\. Rules fear-greed-1\./)).toBeVisible();
  await expect(fg.getByRole('row', { name: /Put\/call ratio/ })).toContainText(
    'Not available: needs an options data plan.',
  );
  await expect(fg.getByRole('row', { name: /Stock price strength/ })).toContainText(
    'fewer than 252 sessions',
  );
  await expect(fg.getByRole('row', { name: /^Volatility/ })).toContainText('FRED VIXCLS');
  await expect(fg.getByText(/Bands: 0 to 24 extreme fear/)).toBeVisible();

  // The capitulation watch on 2026-11-23: VIX 26.62 is under 30, so it is off, with every condition shown.
  const cap = page.getByRole('region', { name: 'Capitulation watch' });
  await expect(cap.getByTestId('capitulation-state')).toHaveText('Off');
  await expect(cap.getByRole('row', { name: /VIX close/ })).toContainText('26.62');
  await expect(cap.getByRole('row', { name: /VIX close/ })).toContainText('No');
  await expect(cap.getByText('Not on in the stored history.', { exact: false })).toBeVisible();
  await expect(cap.getByText(/Bear case: in 2008/)).toBeVisible();
  await expect(
    cap.getByText(/3 months \(63 sessions\): Insufficient history: 9 episodes/),
  ).toBeVisible();
  await expect(cap.getByText(/quality-at-discount screen/)).toBeVisible();
  await expect(
    study.getByRole('row', { name: /VIX at or above 30, recession filter not high/ }),
  ).toContainText('Insufficient history: 9 episodes');
  // GPR and EPU as one context line under the label.
  await expect(
    label.getByText(
      /^Context: geopolitical risk \(GPR\) at the \d+(st|nd|rd|th) percentile of the past year; policy uncertainty \(EPU\) at the \d+(st|nd|rd|th)\.$/,
    ),
  ).toBeVisible();

  // The geopolitical panel: topic counts with their baseline, and the reacting assets with source and date.
  const geo = page.getByRole('region', { name: 'Geopolitical panel' });
  await expect(
    geo.getByText(
      /7 days to 2026-11-24 \(7 days stored\), against the 4 weeks before \(28 days stored\)/,
    ),
  ).toBeVisible();
  const tariffs = geo.getByRole('row', { name: /^Tariffs and trade/ });
  await expect(tariffs).toContainText('28');
  await expect(tariffs).toContainText('17.4%'); // 28 of 161 articles
  await expect(tariffs).toContainText('7.0');
  await expect(tariffs).toContainText('4.0 times');
  await expect(geo.getByRole('row', { name: /^Central banks/ })).toContainText('No baseline');
  await expect(geo.getByRole('row', { name: /^Conflict/ })).toContainText('0');
  // The newest tariff headline, linked.
  await expect(
    geo
      .getByRole('link', {
        name: '3 Stocks to Watch From the Transport Equipment & Leasing Industry',
      })
      .first(),
  ).toHaveAttribute('href', /^https:\/\//);
  await expect(geo.getByRole('row', { name: /WTI crude oil/ })).toContainText('2026-11-17');
  await expect(geo.getByRole('row', { name: /Broad US dollar index/ })).toContainText('2026-11-20');
  await expect(geo.getByRole('row', { name: /Defense \(ITA\)/ })).toContainText(
    /\d{4}-\d{2}-\d{2}/,
  );
  await expect(geo.getByText(/not wire services/)).toBeVisible();
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/regime.png`, fullPage: true });
});

test('regime: capitulation on, with its staged plan, exits and bear case', async ({ page }) => {
  await mock(page);
  // The brief's example reading, built by the core function, and a plan on the synthetic SPY bars (not market data)
  // whose trigger is 60 sessions before the last bar.
  const day = capitulationDay({
    date: '2026-11-23',
    vix: 35.9,
    above50: 90,
    n50: 1000,
    composite: 6,
    recession: 'low',
  });
  const spy = (fgSynthetic.spy as [string, number][]).map(([date, close]) => ({
    date,
    low: close,
    close,
  }));
  const trigger = spy.at(-61)?.date as string;
  const plan = stagedPlan(trigger, spy, new Map());
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/rest/v1/capitulation_daily**', (r) => json(r, [day]));
  await page.route('**/rest/v1/capitulation_plans**', (r) => json(r, [{ plan }]));
  await page.goto('/regime');
  await openDetails(page);
  const cap = page.getByRole('region', { name: 'Capitulation watch' });
  await expect(cap.getByTestId('capitulation-state')).toHaveText('On');
  await expect(cap.getByRole('row', { name: /Marsad universe above/ })).toContainText('9.0%');
  await expect(cap.getByRole('row', { name: /Fear and Greed composite/ })).toContainText('Yes');
  await expect(cap.getByText(`Last on: 2026-11-23.`)).toBeVisible();
  await expect(
    cap.getByRole('heading', {
      name: `Staged-entry plan for index ETFs (episode from ${trigger})`,
    }),
  ).toBeVisible();
  await expect(cap.getByText(/One third at the trigger close/)).toContainText(`Met on ${trigger}.`);
  await expect(cap.getByText(/place any order yourself in Sahm/)).toBeVisible();
  await expect(cap.getByText(/^Exit conditions:/)).toBeVisible();
  await expect(cap.getByText(/^Bear case: in 2008/)).toBeVisible();
});

test('regime: before the job has run, the page says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/regime');
  await expect(page.getByText('No regime has been computed yet.', { exact: false })).toBeVisible();
});

test('regime: the quality screen lists passing companies with its counts and caveats', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const body = (x: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(x),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(body([])));
  await page.route('**/rest/v1/quality_screen_runs**', (r) =>
    r.fulfill(
      body([
        {
          as_of: '2026-11-29',
          version: 'quality-1',
          fiscal_year: 2025,
          price_date: '2026-11-27',
          universe: 1000,
          no_cik: 41,
          eligible: 512,
          passed: 1,
          excluded: {
            'no-gross-profit': 160,
            'not-profitable': 220,
            'negative-equity': 30,
            'missing-data': 30,
            'no-price': 7,
          },
          insufficient: null,
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/quality_screen?**', (r) =>
    r.fulfill(
      body([
        {
          rank: 1,
          ticker: 'JNJ',
          name: 'JOHNSON & JOHNSON',
          passes: true,
          quality: 81.4,
          value: 66.2,
          metrics: {
            grossProfitability: 0.321,
            roa: 0.1346,
            earningsYield: 0.0585,
            bookToMarket: 0.178,
            leverage: 0.59,
            accruals: 0.0114,
          },
          notes: [],
        },
      ]),
    ),
  );
  await page.goto('/regime');
  const s = page.getByRole('region', { name: 'Quality at a discount' });
  await expect(
    s.getByText('Capitulation watch is off: shown for study, not as a signal.'),
  ).toBeVisible();
  await expect(
    s.getByText(
      'Screened 2026-11-29: fiscal 2025 figures from SEC filings, closes of 2026-11-27. 512 of 1000 companies had every input; 1 pass.',
    ),
  ).toBeVisible();
  await expect(
    s.getByText(/Left out: 41 without an SEC record, 160 reporting no gross profit/),
  ).toBeVisible();
  const row = s.getByRole('row', { name: /JNJ/ });
  // 0.321 is 32.1%; 0.1346 is 13.5% (half up); quality 81.4 shows as 81.
  await expect(row).toContainText('81');
  await expect(row).toContainText('66');
  await expect(row).toContainText('32.1%');
  await expect(row).toContainText('13.5%');
  await expect(row).toContainText('5.9%');
  await expect(row).toContainText('0.18');
  await expect(s.getByRole('link', { name: 'JNJ' })).toHaveAttribute('href', '/study/JNJ');
  await openInfo(page.getByRole('region', { name: 'Quality at a discount' }));
  await expect(s.getByText(/not a recommendation/)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('regime: four gauges in a swipe row open their full cards; context is collapsed', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await mock(page);
    await page.goto('/regime');
    const gauges = page.getByRole('region', { name: 'Gauges' });
    await expect(gauges.getByRole('button', { name: /^Recession filter/ })).toContainText(
      'Elevated',
    );
    const fgButton = gauges.getByRole('button', { name: /^Fear and Greed composite/ });
    await expect(fgButton).toContainText('42Fear');
    await fgButton.click();
    const sheet = page.getByRole('dialog', { name: 'Fear and Greed composite' });
    await expect(sheet.getByTestId('fear-greed-value')).toHaveText('42, Fear');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    // The event study stays on the page; the longer context waits behind a tap.
    await expect(page.getByRole('region', { name: 'What the S&P did next' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Geopolitical panel' })).toBeHidden();
    await page.locator('summary', { hasText: 'Geopolitical panel' }).click();
    await expect(page.getByRole('region', { name: 'Geopolitical panel' })).toBeVisible();
    // The page never scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
