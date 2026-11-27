import { expect, test } from '@playwright/test';
import { economicCalendar, estimateNextEarnings } from '@marsad/core';
import releaseDates from '../../../fixtures/fred/fred-release-dates-2026-11-25.json' with { type: 'json' };
import upcoming from '../../../fixtures/massive/market-status-upcoming.json' with { type: 'json' };
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

// The calendar from the real FRED release dates (recorded 2026-11-25) through the job's own core function.
const dates = (
  releaseDates.body as {
    release_dates: { release_id: number; release_name: string; date: string }[];
  }
).release_dates.map((d) => ({
  releaseId: d.release_id,
  releaseName: d.release_name,
  date: d.date,
}));
const events = economicCalendar(dates, '2026-11-25', '2027-01-24');
const nvda = estimateNextEarnings(
  ['2025-11-19', '2026-02-25', '2026-05-27', '2026-08-26', '2026-11-17'],
  '2026-11-25',
);

test('watch: the economic calendar with ET and local times, a countdown, and estimated earnings', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // 12:00 UTC is 07:00 ET and 15:00 in Riyadh.
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/econ_calendar_snapshots**', (r) =>
    r.fulfill(
      json([
        {
          fetched_at: '2026-11-25T23:40:00+00:00',
          version: 'calendar-1',
          range_from: '2026-11-25',
          range_to: '2027-01-24',
          events,
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/earnings_estimate_snapshots**', (r) =>
    r.fulfill(
      json([
        {
          computed_at: '2026-11-25T23:40:00+00:00',
          version: 'calendar-1',
          estimates: [{ ...nvda, ticker: 'NVDA', cik: '0001045810' }],
        },
      ]),
    ),
  );
  await page.goto('/');
  const agenda = page.getByRole('region', { name: 'Economic and earnings calendar' });
  await expect(agenda.getByText('ET · Riyadh')).toBeVisible();
  await expect(agenda.getByRole('heading', { name: 'Today, Wed 25 Nov' })).toBeVisible();
  // GDP at 08:30 ET is 13:30 UTC, 16:30 in Riyadh, 1 h 30 min after 12:00 UTC.
  const gdp = agenda.getByRole('listitem').filter({ hasText: 'GDP' });
  await expect(gdp).toContainText('08:30 ET · 16:30 Riyadh · in 1 h 30 min');
  await expect(gdp).toContainText('High impact');
  await expect(gdp).toContainText('HIGH');
  await expect(gdp).toContainText('Source: FRED release');
  // The FOMC statement on 2026-12-09, 14:00 EST, is 19:00 UTC and 22:00 in Riyadh.
  await expect(
    agenda.getByRole('listitem').filter({ hasText: 'FOMC statement and projections' }),
  ).toContainText('14:00 ET · 22:00 Riyadh');
  // Only the next 14 days: CPI on 2026-12-10 is beyond them.
  await expect(agenda.getByRole('listitem').filter({ hasText: /^CPI/ })).toHaveCount(0);
  await expect(agenda.getByText(/FRED release calendar/)).toBeVisible();
  // Estimated earnings sit on their estimated day, with the window and how it was estimated.
  await expect(agenda.getByRole('heading', { name: 'Wed 24 Feb' })).toBeVisible();
  const nvdaEarnings = agenda.getByRole('listitem').filter({ hasText: 'NVDA earnings' });
  await expect(nvdaEarnings).toContainText('Estimated, 17 Feb to 03 Mar');
  await expect(nvdaEarnings).toContainText('Same quarter last year, 52 weeks on');
  await expect(nvdaEarnings).toContainText('EARN');
  await expect(nvdaEarnings).toContainText('Source: SEC 8-K dates');
  await expect(
    agenda.getByText('EARN: watchlist earnings, estimated', { exact: false }),
  ).toBeVisible();
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/watch.png`, fullPage: true });
});

test('watch: before the calendar job has run, the page says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/');
  await expect(page.getByText(/No calendar yet/)).toBeVisible();
  await expect(page.getByText(/No estimates yet/)).toBeVisible();
});

// Every ticker gets the same 22 synthetic bars (not market data): closes 100 to 121, the last opening at 123 on 3
// times the usual volume. By hand: 1 day +0.8% (121/120), 1 week +4.3% (121/116), 1 month +21.0% (121/100), gap
// +2.50% (123/120), volume 3.0x.
function syntheticBars() {
  return Array.from({ length: 22 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10),
    open: i === 21 ? 123 : 100 + i,
    high: 125,
    low: 99,
    close: 100 + i,
    volume: i === 21 ? 300 : 100,
    vwap: null,
  })).reverse();
}

test('watch: market strip, watchlist, sector heatmap, movers, gap scanner and news', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/daily_bars**', (r) => r.fulfill(json(syntheticBars())));
  await page.route('**/rest/v1/fred_observations**', (r) => {
    const id = new URL(r.request().url()).searchParams.get('series_id')?.replace(/^eq\./, '');
    const rows =
      id === 'VIXCLS'
        ? [
            { date: '2026-11-23', value: 22 },
            { date: '2026-11-20', value: 20 },
          ]
        : id === 'DGS10'
          ? [
              { date: '2026-11-23', value: 4.15 },
              { date: '2026-11-20', value: 4.1 },
            ]
          : [];
    return r.fulfill(json(rows));
  });
  await page.route('**/rest/v1/market_movers_daily**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-11-24',
          version: 'watch-1',
          n: 987,
          gainers: [{ ticker: 'UP1', close: 55, change: 0.12, dollarVolume: 820e6 }],
          losers: [{ ticker: 'DN1', close: 20, change: -0.08, dollarVolume: 300e6 }],
          sectors: [
            { ticker: 'XLK', sector: 'Technology', change: 0.021 },
            { ticker: 'XLE', sector: 'Energy', change: -0.013 },
            { ticker: 'XLU', sector: 'Utilities', change: null },
          ],
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    r.fulfill(
      json([
        {
          id: 'a1',
          published_at: '2026-11-24T21:30:00+00:00',
          publisher: 'Zacks',
          title: 'NVDA headline',
          url: 'https://example.com/a1',
          tickers: ['NVDA'],
        },
        {
          id: 'a2',
          published_at: '2026-11-24T20:00:00+00:00',
          publisher: 'Odd',
          title: 'Unsafe link headline',
          url: 'javascript:alert(1)',
          tickers: ['RKLB'],
        },
      ]),
    ),
  );
  await page.goto('/');

  const strip = page.getByRole('region', { name: 'Market strip' });
  await expect(strip.getByRole('listitem').filter({ hasText: 'SPY' })).toContainText('+0.8%');
  await expect(strip.getByRole('listitem').filter({ hasText: 'VIX' })).toContainText('+10.0%');
  await expect(strip.getByRole('listitem').filter({ hasText: '10-year yield' })).toContainText(
    '▲ +0.05 pts',
  );
  // Nine items, each with its own data date; a series that is not stored says so instead of a number.
  await expect(strip.getByRole('listitem')).toHaveCount(9);
  await expect(strip.getByRole('listitem').filter({ hasText: 'VIX' })).toContainText('23 Nov');
  await expect(strip.getByRole('listitem').filter({ hasText: 'WTI oil' })).toContainText(
    'No data stored',
  );

  const list = page.getByRole('region', { name: 'Watchlist' });
  await expect(list.getByText('Showing the starting tickers')).toBeVisible();
  const nvda = list.getByRole('row', { name: /^NVDA/ });
  await expect(nvda).toContainText('121.00');
  await expect(nvda).toContainText('+0.8%');
  await expect(nvda).toContainText('3.0x');
  // The period control switches the change column: 1 week, then 1 month.
  await list.getByRole('button', { name: '5D' }).click();
  await expect(nvda).toContainText('+4.3%');
  await list.getByRole('button', { name: '1M' }).click();
  await expect(nvda).toContainText('+21.0%');
  await expect(list.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
  await expect(nvda.getByRole('link', { name: 'NVDA' })).toHaveAttribute('href', '/study/NVDA');

  const sectors = page.getByRole('region', { name: 'US sectors' });
  await expect(sectors.getByText('3 SPDR ETFs · close of 24 Nov')).toBeVisible();
  await expect(sectors.getByRole('listitem').filter({ hasText: 'Technology' })).toContainText(
    '+2.10%',
  );
  await expect(sectors.getByRole('listitem').filter({ hasText: 'Energy' })).toContainText('−1.30%');
  await expect(sectors.getByRole('listitem').filter({ hasText: 'Utilities' })).toContainText(
    'No data',
  );

  const movers = page.getByRole('region', { name: 'Movers in the Marsad universe' });
  await expect(movers.getByText(/among 987 members/)).toBeVisible();
  await expect(movers.getByRole('row', { name: /UP1/ })).toContainText('+12.0%');
  await expect(movers.getByRole('row', { name: /DN1/ })).toContainText('−8.0%');

  const gaps = page.getByRole('region', { name: 'Gap scanner' });
  await expect(gaps.getByRole('row').first()).toContainText('+2.50%');

  const news = page.getByRole('region', { name: 'Latest news' });
  // Both stories score 2 (impact-1): Zacks is Tier 3 opinion (0) and Odd is Tier 4 (0), each naming a watchlist
  // ticker (2). The newer one is the highlight.
  await expect(news.getByRole('article')).toContainText('Highlight of the day');
  await expect(news.getByRole('article')).toContainText('NVDA headline');
  await expect(news.getByRole('article')).toContainText('Impact score 2 (impact-1).');
  await expect(news.getByText('Low', { exact: true })).toHaveCount(2);
  await expect(news.getByRole('link', { name: 'NVDA headline' })).toHaveAttribute(
    'href',
    'https://example.com/a1',
  );
  // A non-https vendor link is shown as text, never as a link.
  await expect(news.getByText('Unsafe link headline')).toBeVisible();
  // Each story carries its source tier in words.
  await expect(news.getByText(/^Tier \d/).first()).toBeVisible();
  await expect(news.getByRole('link', { name: 'Unsafe link headline' })).toHaveCount(0);
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/watch-dashboard.png`, fullPage: true });
});

test('watch: the latest brief with its sections and email state', async ({ page }) => {
  await seedSession(page, 'aal2');
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/briefs**', (r) =>
    r.fulfill(
      json([
        {
          kind: 'pre-market',
          for_date: '2026-11-25',
          title: 'Pre-market brief, Wed 2026-11-25',
          sections: [
            {
              heading: 'Market state',
              lines: ['Regime: Stress; recession filter elevated (as of 2026-11-24).'],
            },
            { heading: 'Today (ET)', lines: ['08:30 ET GDP (high impact).'] },
          ],
          delivery: { kind: 'pre-market', email: 'not-configured' },
          created_at: '2026-11-25T13:30:12+00:00',
        },
      ]),
    ),
  );
  await page.goto('/');
  // The cockpit header carries the brief line: 13:30 UTC is 08:30 ET and 16:30 in Riyadh.
  await expect(
    page
      .getByRole('region', { name: 'Morning decision cockpit' })
      .getByText('Pre-market brief · 08:30 ET · 16:30 Riyadh · Not emailed'),
  ).toBeVisible();
  const brief = page.getByRole('region', { name: 'Latest brief' });
  await expect(
    brief.getByRole('heading', { name: 'Latest brief: Pre-market brief · Wed 25 Nov' }),
  ).toBeVisible();
  await expect(brief.getByText('08:30 ET GDP (high impact).')).toBeVisible();
  await expect(brief.getByText(/Not emailed: no email channel set up yet/)).toBeVisible();
  await expect(brief.getByText(/by templates from stored data \(no AI\)/)).toBeVisible();
});

// Quote source (ADR 0041). The clock is Tuesday 2026-11-24 15:03 UTC (10:03 ET, regular session). NVDA's Tauric
// quote is 3 minutes old, RKLB's 33 minutes old (past the 90 s + 15 min allowance); MARA is not covered by Tauric.
test('watch: with Tauric chosen, its latest price sits next to the Massive close and is never called live', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-24T15:03:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/daily_bars**', (r) => r.fulfill(json(syntheticBars())));
  await page.route('**/rest/v1/user_settings**', (r) =>
    r.fulfill(json([{ quote_source: 'tauric' }])),
  );
  await page.route('**/rest/v1/market_holidays**', (r) => r.fulfill(json(upcoming.data)));
  const quote = (ticker: string, price: number, change: number, priceTime: string) => ({
    ticker,
    price,
    change,
    quote_kind: 'snapshot',
    price_time: priceTime,
    session_date: '2026-11-24',
    fetched_at: '2026-11-24T15:01:00Z',
  });
  await page.route('**/rest/v1/price_quotes**', (r) =>
    r.fulfill(
      json([
        quote('NVDA', 122.5, 0.0124, '2026-11-24T15:00:00Z'),
        quote('RKLB', 98.1, -0.0035, '2026-11-24T14:30:00Z'),
      ]),
    ),
  );
  await page.route('**/rest/v1/job_runs**', (r) =>
    r.fulfill(json([{ details: { notCovered: ['MARA', 'HIMS', 'RGTI', 'BBAI'] } }])),
  );
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Watchlist', exact: true });
  await expect(list.getByRole('columnheader', { name: 'Latest (Tauric)' })).toBeVisible();
  const nvda = list.getByRole('row', { name: /^NVDA/ });
  await expect(nvda).toContainText('122.50');
  await expect(nvda).toContainText('+1.24%');
  await expect(nvda).toContainText('Delay not confirmed, 3m 0s old');
  await expect(nvda).toContainText('121.00'); // the Massive close stays
  await expect(list.getByRole('row', { name: /^RKLB/ })).toContainText('Stale, 33m 0s old');
  // MARA: Tauric said "not registered" in the newest run (live 2026-11-26); SOFI simply has no quote yet.
  await expect(list.getByRole('row', { name: /^MARA/ })).toContainText('Not covered by Tauric');
  await expect(list.getByRole('row', { name: /^SOFI/ })).toContainText('No Tauric quote yet');
  await expect(list).not.toContainText(/\bLive\b/);
  await expect(list.getByText(/^Latest prices: Tauric, delay not confirmed/)).toBeVisible();
});

test('watch: with Massive chosen (the default) there is no Tauric column', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/daily_bars**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(syntheticBars()),
    }),
  );
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Watchlist', exact: true });
  await expect(list.getByRole('row', { name: /^NVDA/ })).toContainText('121.00');
  await expect(list.getByRole('columnheader', { name: 'Latest (Tauric)' })).toHaveCount(0);
});

// Marsad v2 cockpit and impact ranking. The clock is Friday 2026-11-27 15:43 UTC (10:43 ET), an early-close day.
// Every ticker has the synthetic bars above (last close 121.00 on Mon 16 Nov, +0.83% on the day). Holdings: NVDA
// with a stop at 100 (inside its plan) and TSLA with a stop at 125 (121.00 is at or below it).
for (const theme of ['dark', 'light'] as const)
  test(`watch: the morning cockpit, company names, Held tags and news ranked by impact (${theme})`, async ({
    page,
  }) => {
    await seedSession(page, 'aal2');
    // Daylight runs the same checks and the same accessibility scan.
    await page.addInitScript((th) => {
      localStorage.setItem(
        'marsad.display',
        JSON.stringify({ theme: th, lang: 'en', zone: 'Asia/Riyadh' }),
      );
    }, theme);
    await page.clock.setFixedTime(new Date('2026-11-27T15:43:00Z'));
    const json = (body: unknown) => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
    await page.route('**/rest/v1/daily_bars**', (r) => r.fulfill(json(syntheticBars())));
    const holding = (id: number, ticker: string, stop: number) => ({
      id,
      ticker,
      shares: 10,
      cost_basis: 110,
      opened_on: '2026-10-30',
      stop,
      targets: [200],
      trend_break: null,
      time_stop_sessions: null,
      sector_etf: null,
      thesis_status: 'intact',
    });
    await page.route('**/rest/v1/holdings**', (r) =>
      r.fulfill(json([holding(1, 'NVDA', 100), holding(2, 'TSLA', 125)])),
    );
    // Newest first, as the query orders them: two Bull calm days after a Stress day.
    await page.route('**/rest/v1/regime_daily**', (r) =>
      r.fulfill(
        json(
          [
            ['2026-11-26', 'bull-calm', 14.82],
            ['2026-11-25', 'bull-calm', 15.1],
            ['2026-11-24', 'stress', 31],
          ].map(([date, label, vix]) => ({
            date,
            label,
            rule_version: 'regime-1',
            inputs: { vix },
          })),
        ),
      ),
    );
    // 580 of 1,000 members above their 50-day average: 58%.
    await page.route('**/rest/v1/breadth_daily**', (r) =>
      r.fulfill(json([{ date: '2026-11-26', version: 'breadth-1', above50: 580, n50: 1000 }])),
    );
    await page.route('**/rest/v1/market_holidays**', (r) =>
      r.fulfill(
        json([
          {
            date: '2026-11-27',
            exchange: 'NYSE',
            name: 'Thanksgiving',
            status: 'early-close',
            open_at: '2026-11-27T14:30:00Z',
            close_at: '2026-11-27T18:00:00Z',
          },
        ]),
      ),
    );
    await page.route('**/rest/v1/instruments**', (r) =>
      r.fulfill(
        json([
          { ticker: 'NVDA', cik: '0001045810', name: 'NVIDIA Corporation' },
          { ticker: 'TSLA', cik: '0001318605', name: 'Tesla, Inc.' },
        ]),
      ),
    );
    // Accepted after the 16 Nov close: a Tier 1 filing since the last close.
    await page.route('**/rest/v1/filings**', (r) =>
      r.fulfill(
        json([
          {
            accession: '0001318605-26-000123',
            cik: '0001318605',
            form: '8-K',
            filing_date: '2026-11-26',
            accepted_at: '2026-11-26T22:05:00+00:00',
            primary_document: 'tsla-8k.htm',
            items: ['5.02'],
          },
        ]),
      ),
    );
    await page.route('**/rest/v1/news_articles**', (r) =>
      r.fulfill(
        json([
          {
            id: 'r1',
            published_at: '2026-11-26T13:12:00+00:00',
            publisher: 'Reuters',
            title: 'NVIDIA supplier lifts guidance on data-center demand',
            url: 'https://example.com/r1',
            tickers: ['NVDA'],
          },
        ]),
      ),
    );
    await page.goto('/');

    await expect(page.getByText('Massive · end of day · close of Mon 16 Nov')).toBeVisible();
    const cockpit = page.getByRole('region', { name: 'Morning decision cockpit' });
    const regime = cockpit.getByRole('link', { name: /^Regime/ });
    await expect(regime).toHaveAttribute('href', '/regime');
    await expect(regime).toContainText('Bull calm');
    await expect(regime).toContainText('2 sessions · regime-1 · 26 Nov');
    await expect(regime).toContainText('VIX 14.82 · breadth 58% above 50-day');
    const movers = cockpit.getByRole('link', { name: /^Last session movers/ });
    await expect(movers).toContainText('NVDA ▲ +0.83%');
    await expect(movers).toContainText('Close of Mon 16 Nov');
    await expect(movers).toHaveAttribute('href', '/study/NVDA');
    // 18:00 UTC is 13:00 ET and 21:00 in Riyadh.
    const today = cockpit.getByRole('link', { name: /^Today/ });
    await expect(today).toContainText('Early close 13:00 ET');
    await expect(today).toContainText('21:00 Riyadh');
    await expect(today).toContainText('1 Tier 1 filing: TSLA 8-K 5.02');
    const exits = cockpit.getByRole('link', { name: /^Exit rules/ });
    await expect(exits).toContainText('TSLA closed under its stop');
    await expect(exits).toContainText('1 other holding inside plan');
    await expect(exits).toHaveAttribute('href', '/journal');

    const list = page.getByRole('region', { name: 'Watchlist', exact: true });
    const nvda = list.getByRole('row', { name: /^NVDA/ });
    await expect(nvda).toContainText('NVIDIA Corporation');
    await expect(nvda).toContainText('Held');
    await expect(list.getByRole('row', { name: /^RKLB/ })).not.toContainText('Held');
    // A row opens Study.
    await nvda.getByRole('cell').nth(3).click();
    await expect(page).toHaveURL(/\/study\/NVDA$/);
    await page.goBack();

    // impact-1 by hand: the TSLA 8-K is Tier 1 (3) + item 5.02, high (3) + a holding (3) = 9, high. The Reuters
    // story is Tier 2 (2) + a holding (3) = 5, medium.
    const news = page.getByRole('region', { name: 'Latest news' });
    const hl = news.getByRole('article');
    await expect(hl).toContainText('Highlight of the day');
    await expect(hl).toContainText('High impact');
    await expect(
      hl.getByRole('link', { name: 'TSLA files 8-K, item 5.02: Executive or director change' }),
    ).toHaveAttribute(
      'href',
      'https://www.sec.gov/Archives/edgar/data/1318605/000131860526000123/tsla-8k.htm',
    );
    await expect(hl).toContainText('SEC EDGAR');
    await expect(hl).toContainText('Tier 1');
    await expect(hl).toContainText('Touches your holdings: TSLA.');
    await expect(hl).toContainText('Impact score 9 (impact-1).');
    const reuters = news.getByRole('listitem').filter({ hasText: 'NVIDIA supplier' });
    await expect(reuters).toContainText('Medium');
    await expect(reuters).toContainText('Reuters');
    await expect(reuters).toContainText('Tier 2');
    // 13:12 UTC is 08:12 ET and 16:12 in Riyadh.
    await expect(reuters).toContainText('26 Nov 08:12 ET · 16:12 Riyadh');
    await expect(news).not.toContainText(/\bLive\b/);
    if (process.env.SHOT_DIR)
      await page.screenshot({
        path: `${process.env.SHOT_DIR}/watch-v2-${theme}.png`,
        fullPage: true,
      });
  });
