import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

// Real Tauric answers for NVDA recorded on 2026-11-28 (fixtures/tauric), stored the way the research job stores
// them in company_research (ADR 0047): each payload minus `instrument`, the thesis flattened.
type Obj = Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/tauric/research-NVDA-2026-11-28.json', import.meta.url),
    'utf8',
  ),
) as { parts: Record<string, { body: Obj }> };
const strip = (o: Obj) => {
  const { instrument: _drop, ...rest } = o;
  void _drop;
  return rest;
};
const analyst = strip(fixture.parts['analyst']?.body ?? {});
const profile = strip(fixture.parts['profile']?.body ?? {});
const calendar = strip(fixture.parts['calendar']?.body ?? {});
const tb = fixture.parts['thesis']?.body ?? {};
const content = (tb['content'] ?? {}) as Obj;
const thesis = {
  narrative: content['narrative'],
  drivers: content['drivers'],
  risks: content['risks'],
  catalysts: content['catalysts'],
  open_questions: content['open_questions'],
  generated_at: tb['generated_at'],
  cutoff: (tb['evidence'] as Obj)['cutoff'],
  revision: tb['revision'],
};
const row = (over: Obj = {}) => ({
  ticker: 'NVDA',
  source: 'tauric',
  analyst,
  profile,
  thesis,
  calendar,
  analyst_refreshed_at: '2026-11-28T01:46:14.960560Z',
  profile_refreshed_at: '2026-11-28T01:46:14.960560Z',
  thesis_generated_at: '2026-11-27T08:34:51.081654Z',
  calendar_refreshed_at: '2026-11-28T01:46:14.960560Z',
  fetched_at: '2026-11-28T02:10:00Z',
  errors: {},
  ...over,
});

/** 260 weekday bars ending Friday 27 Nov 2026, rising 0.5 a session to a last close of 200. */
function bars(last = '2026-11-27', end = 200) {
  const out: Obj[] = [];
  const d = new Date(`${last}T00:00:00Z`);
  while (out.length < 260) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const close = end - out.length * 0.5;
      out.unshift({
        date: d.toISOString().slice(0, 10),
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000_000,
        vwap: close,
      });
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function json(route: Route, body: unknown) {
  const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const payload = wantsObject && Array.isArray(body) ? (body[0] ?? null) : body;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

// The FY2024 and FY2025 facts of piotroski.test.ts: 6 of 9 tests pass.
const A1 = { accession: '0000000000-25-000001', filed: '2025-02-15' };
const A2 = { accession: '0000000000-26-000001', filed: '2026-02-15' };
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  f: typeof A1,
  unit = 'USD',
) => ({
  taxonomy: 'us-gaap',
  concept,
  unit,
  period_start: start,
  period_end: end,
  value,
  accession: f.accession,
  form: '10-K',
  fiscal_year: null,
  fiscal_period: 'FY',
  filed: f.filed,
  frame: null,
});
const FACTS = [
  fact('Assets', null, '2023-12-31', 800, A1),
  fact('Assets', null, '2024-12-31', 1000, A1),
  fact('Assets', null, '2025-12-31', 1200, A2),
  fact('NetIncomeLoss', '2024-01-01', '2024-12-31', 60, A1),
  fact('NetIncomeLoss', '2025-01-01', '2025-12-31', 120, A2),
  fact('NetCashProvidedByUsedInOperatingActivities', '2024-01-01', '2024-12-31', 50, A1),
  fact('NetCashProvidedByUsedInOperatingActivities', '2025-01-01', '2025-12-31', 150, A2),
  fact('LongTermDebtNoncurrent', null, '2023-12-31', 300, A1),
  fact('LongTermDebtNoncurrent', null, '2024-12-31', 320, A1),
  fact('LongTermDebtNoncurrent', null, '2025-12-31', 300, A2),
  fact('AssetsCurrent', null, '2024-12-31', 400, A1),
  fact('LiabilitiesCurrent', null, '2024-12-31', 250, A1),
  fact('AssetsCurrent', null, '2025-12-31', 500, A2),
  fact('LiabilitiesCurrent', null, '2025-12-31', 250, A2),
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2024-01-01',
    '2024-12-31',
    100,
    A1,
    'shares',
  ),
  fact(
    'WeightedAverageNumberOfDilutedSharesOutstanding',
    '2025-01-01',
    '2025-12-31',
    105,
    A2,
    'shares',
  ),
  fact('Revenues', '2024-01-01', '2024-12-31', 900, A1),
  fact('Revenues', '2025-01-01', '2025-12-31', 1000, A2),
  fact('GrossProfit', '2024-01-01', '2024-12-31', 405, A1),
  fact('GrossProfit', '2025-01-01', '2025-12-31', 420, A2),
];

async function mock(page: Page, research: Obj[] = [row()]) {
  await seedSession(page, 'aal2');
  // Saturday 28 Nov 2026, 10:00 ET: Friday's session is the latest completed one.
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/daily_bars**', (r) =>
    json(r, r.request().url().includes('SPY') ? bars('2026-11-27', 600) : bars()),
  );
  await page.route('**/rest/v1/instruments**', (r) =>
    json(r, [{ cik: '0001045810', name: 'NVIDIA CORP' }]),
  );
  for (const table of [
    'filings',
    'splits',
    'market_holidays',
    'insider_filings',
    'insider_transactions',
    'short_interest',
    'short_volume',
    'annual_sections',
    'quarterly_sections',
    'regime_daily',
    'watchlist_items',
    'holdings',
    'strength_rank_daily',
    'halts',
    'alerts',
    'theses',
    'holders_13f_lists',
    'user_settings',
    'job_runs',
    'price_quotes',
  ])
    await page.route(`**/rest/v1/${table}**`, (r) => json(r, []));
  await page.route('**/rest/v1/financial_facts**', (r) => json(r, FACTS));
  await page.route('**/rest/v1/dividends**', (r) =>
    json(
      r,
      [
        {
          ex_dividend_date: '2026-12-04',
          record_date: '2026-12-04',
          pay_date: '2026-12-26',
          cash_amount: 0.01,
        },
        {
          ex_dividend_date: '2026-09-11',
          record_date: '2026-09-11',
          pay_date: '2026-10-02',
          cash_amount: 0.01,
        },
        {
          ex_dividend_date: '2026-06-11',
          record_date: '2026-06-11',
          pay_date: '2026-07-02',
          cash_amount: 0.01,
        },
        {
          ex_dividend_date: '2026-03-12',
          record_date: '2026-03-12',
          pay_date: '2026-04-02',
          cash_amount: 0.01,
        },
        {
          ex_dividend_date: '2025-12-04',
          record_date: '2025-12-04',
          pay_date: '2025-12-26',
          cash_amount: 0.01,
        },
      ].map((d) => ({
        ...d,
        declaration_date: null,
        currency: 'USD',
        frequency: 4,
        split_adjusted_cash_amount: d.cash_amount,
      })),
    ),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    json(r, [
      {
        id: 'a1',
        published_at: '2026-11-27T15:00:00Z',
        publisher: 'Reuters',
        title: 'Nvidia faces a Senate hearing',
        url: 'https://example.com/a1',
        tickers: ['NVDA', 'AMD'],
        sentiment: [{ ticker: 'NVDA', label: 'negative' }],
      },
      {
        id: 'a2',
        published_at: '2026-11-26T15:00:00Z',
        publisher: 'Reuters',
        title: 'Nvidia raises its outlook',
        url: 'https://example.com/a2',
        tickers: ['NVDA'],
        sentiment: [{ ticker: 'NVDA', label: 'positive' }],
      },
      {
        id: 'a3',
        published_at: '2026-11-18T15:00:00Z',
        publisher: 'The Motley Fool',
        title: 'Is Nvidia a buy?',
        url: 'https://example.com/a3',
        tickers: ['NVDA'],
        sentiment: [{ ticker: 'NVDA', label: 'neutral' }],
      },
    ]),
  );
  await page.route('**/rest/v1/analyst_history**', (r) =>
    json(r, [
      {
        as_of: '2026-11-28',
        recommendation: 'buy',
        strong_buy: 10,
        buy: 39,
        hold: 12,
        sell: 2,
        strong_sell: 0,
        number_of_analysts: 59,
        target_mean: '242.4278',
      },
      {
        as_of: '2026-10-30',
        recommendation: 'buy',
        strong_buy: 11,
        buy: 38,
        hold: 11,
        sell: 1,
        strong_sell: 0,
        number_of_analysts: 58,
        target_mean: '250.10',
      },
    ]),
  );
  await page.route('**/rest/v1/company_research**', (r) => {
    const url = decodeURIComponent(r.request().url());
    if (url.includes('sub_industry'))
      return json(r, [
        { ticker: 'AMD', profile: { ...profile, market_cap: 350_000_000_000, pe_ratio: 98.4 } },
      ]);
    return json(r, research);
  });
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

test('study: ten views, the overview with Tauric facts, the labelled AI thesis and the mean target line', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await expect(page.getByRole('tab')).toHaveText([
    'Overview',
    'Analysts',
    'Financials',
    'Earnings',
    'Technicals',
    'Dividends',
    'Ownership',
    'News',
    'Filings',
    'Shariah aid',
  ]);
  // The brief carries the mean target against Marsad's last close, never an "upside" headline.
  await expect(
    page.getByText(
      'Mean target vs last close: +21.2% (low $130.00, median $240.00, high $425.00; 59 analysts; refreshed 27 Nov 2026)',
    ),
  ).toBeVisible();
  await expect(page.getByText(/upside/i)).toHaveCount(0);
  // Key statistics from the Tauric profile with its refreshed date, and Marsad's own figures beside them.
  const stats = page.getByRole('region', { name: 'Key statistics' });
  await expect(stats.getByText('Tauric, refreshed 27 Nov 2026').first()).toBeVisible();
  await expect(stats.getByText('$3.63T').first()).toBeVisible();
  await expect(stats.getByText('Marsad, from SEC filings')).toBeVisible();
  await expect(stats.getByText(/^Marsad −?[\d.]+: \d+ daily returns against SPY/)).toBeVisible();
  // Stock against SPY: 5Y needs more sessions than are stored.
  const perf = page.getByRole('region', { name: 'NVDA against SPY' });
  await expect(perf.getByRole('button', { name: '5Y' })).toBeDisabled();
  await expect(perf.getByText(/5Y: needs 1261 sessions, 260 stored/)).toBeVisible();
  // Peers: among tickers Marsad tracks, one tap to the peer.
  const peers = page.getByRole('region', { name: 'Peers among tickers Marsad tracks' });
  await expect(peers.getByRole('link', { name: 'AMD' })).toBeVisible();
  // The AI thesis is labelled as Tauric's, not Marsad's view, with bears first.
  await expect(
    page.getByText(
      "Written by Tauric AI on 27 Nov 2026, evidence to 27 Nov 2026. Not Marsad's view, not advice.",
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bears say (negative factors)' })).toBeVisible();
});

test('analysts: consensus counts, targets from the last close, trend from snapshots, the estimate says why it is missing', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await tab(page, 'Analysts');
  const a = page.getByRole('region', { name: 'Analyst forecast' });
  await expect(a.getByText('Buy', { exact: true }).first()).toBeVisible();
  await expect(a.getByText('63 ratings from 59 analysts')).toBeVisible();
  await expect(a.getByRole('row', { name: /Average \$242\.43 \+21\.2%/ })).toBeVisible();
  await expect(a.getByRole('row', { name: /Low \$130\.00 −35\.0%/ })).toBeVisible();
  await expect(a.getByRole('img', { name: /dashed lines to the 12-month targets/ })).toBeVisible();
  await expect(a.getByText(/Per-analyst ratings.*Benzinga add-on/)).toBeVisible();
  const trend = page.getByRole('region', { name: 'Recommendation trend' });
  await expect(
    trend.getByText('History starts 30 Oct 2026. The last stored snapshot of each month.'),
  ).toBeVisible();
  await expect(trend.getByRole('img')).toBeVisible();
  const est = page.getByRole('region', { name: 'Next-quarter estimate' });
  await expect(
    est.getByText(/Data unavailable \(Tauric could not serve it at the last run\)/),
  ).toBeVisible();
});

test('analysts: a part that fails the core check shows no numbers, only the reason', async ({
  page,
}) => {
  await mock(page, [row({ analyst: { ...analyst, target_low_price: 500 } })]);
  await page.goto('/study/NVDA');
  await tab(page, 'Analysts');
  const a = page.getByRole('region', { name: 'Analyst forecast' });
  await expect(a.getByText(/Data unavailable \(failed Marsad's check:/)).toBeVisible();
  await expect(a.getByText('$242.43')).toHaveCount(0);
});

test('a ticker Tauric has no research for says so in every view that needs it', async ({
  page,
}) => {
  await mock(page, []);
  await page.goto('/study/NVDA');
  await expect(page.getByText(/No Tauric research stored for NVDA yet/)).toBeVisible();
  await tab(page, 'Analysts');
  await expect(
    page
      .getByRole('region', { name: 'Analyst forecast' })
      .getByText('Data unavailable (not stored yet)'),
  ).toBeVisible();
});

test('financials: Piotroski as n of 9 tests passed with every test shown', async ({ page }) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await tab(page, 'Financials');
  const f = page.getByRole('region', { name: 'Financial health: Piotroski F-score' });
  await expect(f.getByText('6 of 9 tests passed')).toBeVisible();
  await expect(f.getByText('Profitability: 4 of 4 passed (4 tests)')).toBeVisible();
  await expect(f.getByText('Diluted shares no higher')).toBeVisible();
  await expect(f.getByText('105 against 100')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Financial statements overview' })).toBeVisible();
});

test('technicals: one engine, n of m readings, levels with their note, no gauge', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await tab(page, 'Technicals');
  await expect(page.getByTestId('tech-summary')).toHaveText(/^\d+ of \d+ readings bullish$/);
  await expect(page.getByRole('rowheader', { name: /^RSI 14 Above 55 bullish/ })).toBeVisible();
  await expect(
    page.getByText(/they do not predict where it will turn\. Not advice\./),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Technical analysis' }).getByText(/\b(buy|sell)\b/i),
  ).toHaveCount(0);
});

test('news: the vendor labels, counts under 30 instead of a share, positive filter', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await tab(page, 'News');
  await expect(page.getByText('3 articles from 2 publishers in 12 weeks')).toBeVisible();
  await expect(
    page.getByText('1 positive, 0 neutral, 1 negative of 2 labelled (no percentage under 30)'),
  ).toBeVisible();
  const list = page.getByRole('region', { name: 'Articles with sentiment' });
  await list
    .getByRole('group', { name: 'Show articles' })
    .getByRole('button', { name: 'Positive' })
    .click();
  await expect(list.getByRole('link', { name: 'Nvidia raises its outlook' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Nvidia faces a Senate hearing' })).toHaveCount(0);
});

test('dividends: the calculator matches the TipRanks screen at 0% tax and defaults to 30% withholding', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await tab(page, 'Dividends');
  const calc = page.getByRole('region', { name: 'Dividend calculator' });
  // Prefilled from stored data, each with its source.
  await expect(calc.getByLabel('Share price ($)')).toHaveValue('200');
  await expect(calc.getByText("Marsad's last stored close, 27 Nov 2026")).toBeVisible();
  await expect(
    calc.getByText(/Marsad: 4 stored dividends in the 12 months to 27 Nov 2026/),
  ).toBeVisible();
  await calc.locator('summary', { hasText: 'Advanced' }).click();
  await expect(
    calc.getByLabel(
      'US withholding, 30% (no US and Saudi treaty), editable; check your Sahm statement',
    ),
  ).toHaveValue('30');
  await expect(calc.getByText(/IRS Publication 515/)).toBeVisible();
  // The known answer: 60 shares at 145, 5 years, quarterly, no tax, no growth.
  await calc.getByLabel('Share price ($)').fill('145');
  await calc.getByLabel('Shares').fill('60');
  await expect(calc.getByLabel('Investment ($)')).toHaveValue('8700');
  await calc.getByLabel('Holding period (years, 1 to 30)').fill('5');
  await calc.getByLabel('Expected yield (%)').fill('0.3488641044876089');
  await calc.getByLabel('Payouts a year').selectOption('4');
  await calc
    .getByLabel('US withholding, 30% (no US and Saudi treaty), editable; check your Sahm statement')
    .fill('0');
  const cash = calc.getByRole('region', { name: 'Cash payout' });
  await expect(cash.getByText('$2.53', { exact: true })).toBeVisible();
  await expect(cash.getByText('$30.35', { exact: true })).toBeVisible();
  await expect(cash.getByText('$8,700.00', { exact: true })).toBeVisible();
  await expect(cash.getByText('$151.76', { exact: true })).toBeVisible();
  await expect(cash.getByText('1.74%', { exact: true })).toBeVisible();
  await expect(cash.getByText('0.35%', { exact: true })).toBeVisible();
  const drip = calc.getByRole('region', { name: 'DRIP (reinvested)' });
  await expect(drip.getByText('$2.57', { exact: true })).toBeVisible();
  await expect(drip.getByText('$30.82', { exact: true })).toBeVisible();
  await expect(drip.getByText('$8,853.02', { exact: true })).toBeVisible();
  await expect(drip.getByText('$153.02', { exact: true })).toBeVisible();
  await expect(drip.getByText('1.76%', { exact: true })).toBeVisible();
  await expect(calc.getByText(/A projection from your inputs, not a forecast\./)).toBeVisible();
  await calc.locator('summary', { hasText: 'Year by year' }).click();
  await expect(calc.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  if (process.env.SHOT_DIR) {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(
        (th) => localStorage.setItem('marsad.display', JSON.stringify({ theme: th, lang: 'en' })),
        theme,
      );
      for (const view of ['Overview', 'Analysts', 'Technicals', 'Dividends']) {
        await page.reload();
        await tab(page, view);
        await page.waitForLoadState('networkidle');
        await page.screenshot({
          path: `${process.env.SHOT_DIR}/${view}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
});

test('chart: weekly candles, levels with the note, analyst targets as an overlay', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/study/NVDA');
  await page
    .getByRole('group', { name: 'Candle size' })
    .getByRole('button', { name: 'Weekly' })
    .click();
  await expect(
    page.getByRole('figure', { name: /Weekly candlestick chart for NVDA/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Chart range' }).getByRole('button', { name: '5Y' }),
  ).toBeDisabled();
  await page
    .getByRole('group', { name: 'Chart overlays' })
    .getByRole('button', { name: 'Analyst targets' })
    .click();
  await page
    .getByRole('group', { name: 'Chart overlays' })
    .getByRole('button', { name: 'Support and resistance' })
    .click();
  await expect(page.getByText(/Levels from past daily prices to 27 Nov 2026/)).toBeVisible();
  await expect(page.getByText(/Marsad stores daily bars only/).first()).toBeVisible();
});

test.describe('in Daylight', () => {
  test('the research views pass the accessibility scan in the light theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'marsad.display',
        JSON.stringify({ theme: 'light', lang: 'en', zone: 'Asia/Riyadh' }),
      );
    });
    await mock(page);
    await page.goto('/study/NVDA');
    await tab(page, 'Dividends');
    await expect(page.getByRole('region', { name: 'Dividend calculator' })).toBeVisible();
  });
});
