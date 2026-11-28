import { expect, test, type Page, type Route } from '@playwright/test';
import dividends from '../../../fixtures/massive/dividends-NVDA.json' with { type: 'json' };
import news from '../../../fixtures/massive/news-NVDA.json' with { type: 'json' };
import sections from '../../../fixtures/massive/sections-NVDA-risk_factors.json' with { type: 'json' };
import business from '../../../fixtures/massive/sections-NVDA-business.json' with { type: 'json' };
import shortInterest from '../../../fixtures/massive/short-interest-NVDA.json' with { type: 'json' };
import shortVolume from '../../../fixtures/massive/short-volume-NVDA.json' with { type: 'json' };
import factsFixture from '../../../fixtures/sec/companyfacts-NVDA-trimmed.json' with { type: 'json' };
import { seedSession, scanAfterEach, openSection, openInfo } from './helpers';

scanAfterEach();

// Every row below is built from the responses recorded from the live services on 2026-11-24 (fixtures/), reshaped
// into the columns the database tables use. Nothing is invented except the price bars, which only need to end at 300.

type Json = Record<string, unknown>;

function json(route: Route, body: unknown) {
  const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const payload = wantsObject && Array.isArray(body) ? (body[0] ?? null) : body;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

function bars(): Json[] {
  const out: Json[] = [];
  const d = new Date('2026-11-24T00:00:00Z');
  while (out.length < 260) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const k = out.length;
      const close = 300 - k * 0.5;
      out.unshift({
        date: d.toISOString().slice(0, 10),
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1_000_000,
        vwap: close,
      });
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** The recorded company facts as `financial_facts` rows. */
function factRows(): Json[] {
  const rows: Json[] = [];
  for (const [taxonomy, concepts] of Object.entries(
    factsFixture.body.facts as Record<string, Record<string, { units: Record<string, Json[]> }>>,
  ))
    for (const [concept, c] of Object.entries(concepts))
      for (const [unit, list] of Object.entries(c.units))
        for (const r of list)
          rows.push({
            taxonomy,
            concept,
            unit,
            period_start: r['start'] ?? null,
            period_end: r['end'],
            value: r['val'],
            accession: r['accn'],
            form: r['form'],
            fiscal_year: r['fy'],
            fiscal_period: r['fp'],
            filed: r['filed'],
            frame: r['frame'] ?? null,
          });
  return rows;
}

async function setup(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
  const empty = (r: Route) => json(r, []);
  // The company brief's own inputs (company-brief-1) are empty unless a test registers rows.
  for (const table of [
    'annual_sections',
    'quarterly_sections',
    'regime_daily',
    'watchlist_items',
    'holdings',
    'strength_rank_daily',
    'halts',
    'alerts',
  ])
    await page.route(`**/rest/v1/${table}**`, empty);
  await page.route('**/rest/v1/market_holidays**', empty);
  await page.route('**/rest/v1/splits**', empty);
  await page.route('**/rest/v1/daily_bars**', (r) => json(r, bars()));
  await page.route('**/rest/v1/instruments**', (r) =>
    json(r, [{ ticker: 'NVDA', cik: '0001045810', name: 'NVIDIA CORP' }]),
  );
  await page.route('**/rest/v1/filings**', empty);
  await page.route('**/rest/v1/financial_facts**', (r) => json(r, factRows()));
  await page.route('**/rest/v1/insider_filings**', (r) =>
    json(r, [
      {
        accession: '0001696841-26-000016',
        status: 'ok',
        document_type: '4',
        owner_name: 'Teter Timothy S.',
        is_director: false,
        is_officer: true,
        officer_title: 'EVP, General Counsel and Sec',
        is_ten_percent_owner: false,
        plan_10b5: true,
        filed_at: '2026-11-19T21:54:28Z',
        period_of_report: '2026-11-19',
      },
      {
        accession: '0000000000-26-000001',
        status: 'error',
        owner_name: null,
        period_of_report: null,
      },
      // Forms 3, 3/A and 5/A: the owners, dates, flags and holdings are read from the real documents recorded on
      // 2026-11-24 (fixtures/sec). The filing dates are the real ones; the times of day are invented.
      {
        accession: '0002164059-26-000002',
        status: 'ok',
        document_type: '3',
        owner_name: 'Petit de Mange Edward',
        co_owners: [],
        is_director: false,
        is_officer: true,
        officer_title: 'VP of Recycling',
        is_ten_percent_owner: false,
        no_securities_owned: false,
        filed_at: '2026-11-12T20:00:00Z',
        period_of_report: '2026-11-04',
      },
      {
        accession: '0001773751-26-000248',
        status: 'ok',
        document_type: '3',
        owner_name: 'Huberman Andrew D',
        co_owners: [],
        is_director: true,
        is_officer: false,
        is_ten_percent_owner: false,
        no_securities_owned: true,
        filed_at: '2026-11-12T19:00:00Z',
        period_of_report: '2026-11-04',
      },
      {
        accession: '0001209191-22-023889',
        status: 'ok',
        document_type: '3/A',
        owner_name: 'GV 2019 GP, L.L.C.',
        co_owners: ['GV 2019 GP, L.P.', 'GV 2019, L.P.', 'Alphabet Inc.'],
        is_director: false,
        is_officer: false,
        is_ten_percent_owner: true,
        no_securities_owned: false,
        original_submission: '2021-10-04',
        filed_at: '2022-04-08T20:00:00Z',
        period_of_report: '2021-09-30',
      },
      {
        accession: '0001045810-25-000070',
        status: 'ok',
        document_type: '5/A',
        owner_name: 'Drell Persis',
        co_owners: [],
        is_director: true,
        is_officer: false,
        is_ten_percent_owner: false,
        plan_10b5: false,
        original_submission: '2025-03-12',
        filed_at: '2025-03-21T20:00:00Z',
        period_of_report: '2025-01-26',
      },
    ]),
  );
  await page.route('**/rest/v1/insider_holdings**', (r) =>
    json(r, [
      {
        accession: '0002164059-26-000002',
        line: 1,
        table_kind: 'non-derivative',
        security_title: 'Class A Common Stock',
        shares: 61985,
        ownership: 'D',
      },
      {
        accession: '0002164059-26-000002',
        line: 2,
        table_kind: 'derivative',
        security_title: 'Restricted Stock Units',
        underlying_title: 'Class A Common Stock',
        underlying_shares: 1938,
        ownership: 'D',
        footnotes: [
          'Each restricted stock unit ("RSU") represents a contingent right to receive one share of the Issuer\'s Class A Common Stock.',
        ],
      },
      {
        accession: '0002164059-26-000002',
        line: 5,
        table_kind: 'derivative',
        security_title: 'Stock Option',
        exercise_price: 3.18,
        expiration_date: '2033-12-22',
        underlying_title: 'Class A Common Stock',
        underlying_shares: 109116,
        ownership: 'D',
      },
      {
        accession: '0001209191-22-023889',
        line: 1,
        table_kind: 'non-derivative',
        security_title: 'Common Stock',
        shares: 4556532,
        ownership: 'I',
        nature_of_ownership: 'By GV 2019 L.P.',
      },
    ]),
  );
  await page.route('**/rest/v1/insider_transactions**', (r) =>
    json(r, [
      // The first and last of the 12 sales in the recorded filing, exactly as recorded (the full filing totals
      // 30,000 shares and $4,542,781.49; these two rows alone total 2,844 shares and $431,474.26).
      {
        accession: '0001696841-26-000016',
        line: 1,
        table_kind: 'non-derivative',
        trade_date: '2026-11-19',
        code: 'S',
        shares: 1434,
        price_per_share: 146.0298,
        acquired_disposed: 'D',
        shares_after: 2686226,
        value_usd: 1434 * 146.0298,
      },
      {
        accession: '0001696841-26-000016',
        line: 12,
        table_kind: 'non-derivative',
        trade_date: '2026-11-19',
        code: 'S',
        shares: 1410,
        price_per_share: 157.4947,
        acquired_disposed: 'D',
        shares_after: 2657660,
        value_usd: 1410 * 157.4947,
      },
      // The two sales the real amended Form 5 reports, made in 2023 and 2024 and filed in March 2025.
      {
        accession: '0001045810-25-000070',
        line: 1,
        table_kind: 'non-derivative',
        trade_date: '2023-12-13',
        code: 'S',
        shares: 65000,
        price_per_share: 48.2582,
        acquired_disposed: 'D',
        shares_after: 212740,
        value_usd: 65000 * 48.2582,
      },
      {
        accession: '0001045810-25-000070',
        line: 2,
        table_kind: 'non-derivative',
        trade_date: '2024-06-14',
        code: 'S',
        shares: 34000,
        price_per_share: 131.7047,
        acquired_disposed: 'D',
        shares_after: 178740,
        value_usd: 34000 * 131.7047,
      },
    ]),
  );
  await page.route('**/rest/v1/short_interest**', (r) =>
    json(
      r,
      [...(shortInterest.body.results as Json[])]
        .reverse()
        .slice(0, 8)
        .map((x) => ({
          settlement_date: x['settlement_date'],
          short_interest: x['short_interest'],
          avg_daily_volume: x['avg_daily_volume'],
          days_to_cover: x['days_to_cover'],
        })),
    ),
  );
  await page.route('**/rest/v1/short_volume**', (r) =>
    json(
      r,
      [...(shortVolume.body.results as Json[])]
        .reverse()
        .slice(0, 10)
        .map((x) => ({
          date: x['date'],
          total_volume: x['total_volume'],
          short_volume: x['short_volume'],
          short_volume_ratio: x['short_volume_ratio'],
        })),
    ),
  );
  await page.route('**/rest/v1/dividends**', (r) =>
    json(
      r,
      [...(dividends.body.results as Json[])].reverse().map((x) => ({
        ex_dividend_date: x['ex_dividend_date'],
        pay_date: x['pay_date'],
        declaration_date: x['declaration_date'],
        cash_amount: x['cash_amount'],
        currency: x['currency'],
      })),
    ),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    json(
      r,
      (news.body.results as (Json & { publisher: { name: string } })[]).map((x) => ({
        id: x['id'],
        published_at: x['published_utc'],
        publisher: x.publisher.name,
        title: x['title'],
        url: x['article_url'],
        tickers: x['tickers'],
        // Stored as the news job writes it: the vendor's label per ticker (company-brief-1 counts these).
        sentiment: ((x['insights'] ?? []) as Json[]).map((i) => ({
          ticker: i['ticker'],
          label: i['sentiment'],
          reasoning: i['sentiment_reasoning'] ?? null,
        })),
      })),
    ),
  );
}

test('financials: as filed, with derived quarters marked, and a date picker that hides what was not yet public', async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/study/NVDA');
  // Snapshot (v2), checked by hand from the recorded facts filed by 2026-11-24. Revenue over the four quarters to
  // 2026-07-26: 57.006 + 68.127 (derived: 215.938 - 147.811) + 81.615 + 96.221 = 302.969 billion. Net income over
  // the same quarters: 31.910 + 42.960 (120.067 - 77.107) + 58.321 + 59.688 = 192.879 billion, 63.66% of revenue.
  // Market value: the 300.00 close x 24.1 billion shares (cover page filed 2026-08-26) = 7.23 trillion. The four
  // quarters a year earlier are not all in the facts, so there is no change on a year earlier, only the period.
  // Squeezed: the snapshot tiles sit at the top of the Financials tab.
  await openSection(page, 'Financials');
  const snapshot = page.getByRole('region', { name: 'Snapshot' });
  await expect(snapshot).toContainText('$7.23T');
  await expect(snapshot).toContainText('24.10B shares × 300.00');
  await expect(snapshot).toContainText('$303.0B');
  await expect(snapshot).toContainText('Four quarters to 2026-07-26');
  await expect(snapshot).toContainText('63.7%');
  await expect(snapshot).not.toContainText('on a year earlier');
  const panel = page.getByRole('region', { name: 'Financials, as filed' });
  await expect(panel.getByText('Latest filing used: 2026-08-26')).toBeVisible();
  // The newest quarter (reported directly), its revenue and growth over the same quarter a year earlier.
  const quarters = panel.getByRole('table').first(); // the quarterly table; fiscal years are a second table
  const q2 = quarters.getByRole('row', { name: /^2026-07-26/ });
  await expect(q2).toContainText('$96.22B');
  await expect(q2).toContainText('+105.9%');
  await expect(q2).toContainText('75.0%'); // gross margin 72.142 / 96.221
  // The fourth quarter of the previous fiscal year is not reported by a 10-Q, so it is derived and says so.
  await expect(quarters.getByRole('row', { name: /^2026-01-25/ })).toContainText('derived');
  await expect(quarters.getByRole('row', { name: /^2026-01-25/ })).toContainText('$68.13B');
  // Trailing four quarters, and price to earnings: last close $300.00 over trailing EPS of $7.91.
  await expect(panel.getByText('$302.97B').first()).toBeVisible();
  await expect(panel.getByText('37.9\u00D7')).toBeVisible();
  await expect(panel.getByText('Balance sheet at 2026-07-26')).toBeVisible();
  await expect(panel.getByText('$320.27B')).toBeVisible();
  // Council batch 4: free cash flow needs capital spending, which this recorded file only has up to 2020, so it is
  // not reported rather than guessed; dilution uses the diluted share counts it does have.
  const investor = panel.getByRole('region', { name: 'Cash, value and dilution' });
  await expect(
    investor.getByText('Free cash flow, 12 months', { exact: true }).locator('..'),
  ).toContainText('Not reported');
  await expect(
    investor.getByText('Diluted shares, 1 year', { exact: true }).locator('..'),
  ).toContainText('%');
  await expect(investor.getByText('Market value', { exact: true }).locator('..')).toContainText(
    '$',
  );
  // Point in time: the day before the Q2 10-Q was filed, that quarter is not there yet.
  await panel.getByLabel('Known as of').fill('2026-08-25');
  await expect(panel.getByText('Latest filing used: 2026-05-20')).toBeVisible();
  await expect(quarters.getByRole('row', { name: /^2026-07-26/ })).toHaveCount(0);
  await expect(quarters.getByRole('row', { name: /^2026-04-26/ })).toContainText('$81.62B');
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/panels.png`, fullPage: true });
});

test('company brief: the recorded facts, news labels, insiders and short interest, each line with its date', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/regime_daily**', (r) =>
    json(r, [
      {
        date: '2026-11-24',
        label: 'bull-calm',
        rule_version: 'regime-1',
        recession_version: 'recession-1',
        recession_level: 'clear',
        recession: { triggered: 0, available: 3 },
      },
    ]),
  );
  await page.route('**/rest/v1/watchlist_items**', (r) => json(r, [{ sector_etf: 'XLK' }]));
  await page.route('**/rest/v1/strength_rank_daily**', (r) =>
    json(r, [{ date: '2026-11-24', percentile: 90, rank: 3, members: 21 }]),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/study/NVDA');
  const brief = page.getByRole('region', { name: 'Company brief' });
  // Company: the 300.00 close x 24.1 billion shares (cover page for 2026-08-21) = 7.23 trillion (snapshot-1).
  await expect(brief).toContainText('$7.23T');
  await expect(brief).toContainText(
    '24.10B shares × $300.00 (close of 24 Nov 2026, shares at 21 Aug 2026)',
  );
  // Performance: 302.969 billion over the four quarters to 2026-07-26 (summed in the financials test), with no
  // year-earlier figure in the recorded facts; 192.879 / 302.969 = 63.66% net margin.
  await expect(brief).toContainText('$303.0B to 26 Jul 2026 (no year-earlier figure)');
  await expect(brief).toContainText('63.7% over 4 quarters to 26 Jul 2026');
  // Capital spending is only recorded up to 2020, so free cash flow is not available rather than guessed.
  await expect(brief.getByText('Free cash flow', { exact: true }).locator('..')).toContainText(
    'Not available',
  );
  // Diluted shares 24.285 billion (quarter to 2026-07-26) against 24.532 billion (to 2025-07-27): -1.0068%.
  await expect(brief).toContainText(
    'Diluted shares −1.0% on a year earlier (quarter to 26 Jul 2026)',
  );
  await expect(brief).toContainText(
    '90 percentile, 3 of 21 universe stocks by 3-month return (24 Nov 2026)',
  );
  // Checks, each with its rule: cash 22.443 billion minus long-term debt 33.366 billion = net debt 10.923 billion.
  await expect(brief.getByText('Code-based checks, not advice')).toBeVisible();
  await expect(
    brief.getByText('Net margin 63.7% over 4 quarters to 26 Jul 2026. Rule: 15% or more.'),
  ).toBeVisible();
  await expect(
    brief.getByText(
      'Diluted shares down 1.0% on a year earlier (quarter to 26 Jul 2026). Rule: down 1% or more.',
    ),
  ).toBeVisible();
  await expect(
    brief.getByText(
      'Net debt $10.9B at 26 Jul 2026: long-term debt above cash and short-term investments.',
    ),
  ).toBeVisible();
  await expect(
    brief.getByText(
      'Strength rank 90 percentile of 21 universe stocks (24 Nov 2026). Rule: 80 or higher.',
    ),
  ).toBeVisible();
  // Two open-market sales on 2026-11-19: 1,434 x 146.0298 + 1,410 x 157.4947 = $431,474.26; the amended Form 5's
  // sales (2023 and 2024) are outside the 90 days.
  await expect(
    brief.getByText('Insiders sold $431,474.26 in 90 days to 24 Nov 2026 (2 sales), none bought.'),
  ).toBeVisible();
  await expect(brief).toContainText(
    'Net −$431,474.26: 0 open-market buys $0.00, 2 sales $431,474.26',
  );
  // Sentiment: the 30 recorded stories carry the vendor's labels for NVDA: 10 positive, 12 neutral, 8 negative.
  // 30 labelled stories is enough for percentages: 33%, 40%, 27%.
  await expect(brief).toContainText('10 positive · 12 neutral · 8 negative, of 30 stored stories');
  await expect(brief).toContainText(
    '33% positive, 40% neutral, 27% negative of the labelled stories.',
  );
  // Short interest settled 2026-10-30: 279,579,505 shares, 1.16% of 24.1 billion; 301,622,687 on 2026-10-15
  // before it, so -7.31%.
  await expect(brief).toContainText('279.6M shares');
  await expect(brief).toContainText(
    '1.2% of shares outstanding · −7.3% since 15 Oct 2026 · 2.8 days to cover · settled 30 Oct 2026',
  );
  // Context, never an outlook.
  await expect(brief).toContainText('Bull calm (close of 24 Nov 2026, rules regime-1)');
  await expect(brief).toContainText('0 of 3 on, level clear (24 Nov 2026)');
  await expect(brief.getByText('XLK against SPY')).toBeVisible();
  await expect(brief).toContainText('(to 24 Nov 2026, set on the watchlist)');
  await expect(brief).toContainText('Marsad does not forecast or predict prices.');
  // What's next: the declared December dividend.
  await expect(brief).toContainText('02 Dec 2026, $0.25 a share');
  await expect(brief).toContainText('No results filings stored');
  // Each block opens its detail in one tap.
  await brief.getByRole('button', { name: 'Open Financials' }).click();
  await expect(page.getByRole('tab', { name: 'Financials' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Snapshot' })).toContainText('$7.23T');
  // The brief lives in the overview (ADR 0048).
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await brief.getByRole('button', { name: 'Open News' }).click();
  await expect(page.getByRole('heading', { name: 'Latest company news' })).toBeVisible();
  if (process.env.SHOT_DIR) {
    await page.reload();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(brief).toContainText('$7.23T');
    await page.screenshot({ path: `${process.env.SHOT_DIR}/brief-dark.png`, fullPage: true });
    await page.evaluate(() =>
      localStorage.setItem('marsad.display', JSON.stringify({ theme: 'light', lang: 'en' })),
    );
    await page.reload();
    await expect(brief).toContainText('$7.23T');
    await page.screenshot({ path: `${process.env.SHOT_DIR}/brief-light.png`, fullPage: true });
  }
});

test('earnings: each release matched to its quarter, the move in the session that could trade, gaps said out loud', async ({
  page,
}) => {
  await setup(page);
  // The 2026-11-17 8-K is the real recorded filing (accession 0001045810-26-000088). The August one is invented
  // for this test: accepted 16:20 ET on Wed 2026-08-19, a week before the Q2 10-Q was filed on 2026-08-26.
  // The page's own filings list comes back empty (older than its newest-200 window); only the query that asks
  // for results 8-Ks (form = 8-K) returns them, so the chart markers below must come from that query too.
  await page.route('**/rest/v1/filings**', (r) =>
    json(
      r,
      !r.request().url().includes('form=eq.8-K')
        ? []
        : [
            {
              accession: '0001045810-26-000088',
              form: '8-K',
              filing_date: '2026-11-17',
              accepted_at: '2026-11-17T21:20:51Z',
              primary_document: 'nvda-20261117.htm',
              items: ['2.02', '9.01'],
            },
            {
              accession: '0001045810-26-000999',
              form: '8-K',
              filing_date: '2026-08-19',
              accepted_at: '2026-08-19T20:20:00Z',
              primary_document: 'x.htm',
              items: ['2.02', '9.01'],
            },
          ],
    ),
  );
  // The fixture bars rise 0.5 a day; make 2026-08-20 close at 239.40 so the August reaction is a clear drop.
  await page.route('**/rest/v1/daily_bars**', (r) =>
    json(
      r,
      bars().map((b) => (b['date'] === '2026-08-20' ? { ...b, close: 239.4 } : b)),
    ),
  );
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/study/NVDA');
  await openSection(page, 'Earnings');
  // The key tile estimates the next release from the same 8-K filings, with its range.
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/).first()).toBeVisible();
  const panel = page.getByRole('region', { name: 'Earnings history' });
  const table = panel.getByRole('table');
  // Newest first. A release with no 10-Q yet: the reaction is 2026-11-18 (after the close on the 17th),
  // from $297.50 to $298.00 = +0.168%.
  const pending = table.getByRole('row', { name: /Results not yet in a filed 10-Q or 10-K/ });
  await expect(pending).toContainText('2026-11-17, after the close');
  await expect(pending).toContainText('+0.2% (2026-11-17 close $297.50, 2026-11-18 close $298.00)');
  // Q2: reported $96.22B, then the August release: $265.50 to $239.40 = -9.83%.
  const q2 = table.getByRole('row', { name: /^2026-07-26/ });
  await expect(q2).toContainText('2026-08-19, after the close');
  await expect(q2).toContainText('$96.22B');
  await expect(q2).toContainText('-9.8% (2026-08-19 close $265.50, 2026-08-20 close $239.40)');
  // A quarter whose results 8-K is not stored says so rather than guessing from the 10-Q date.
  await expect(table.getByRole('row', { name: /^2026-04-26/ })).toContainText(
    'No results 8-K stored for this quarter',
  );
  // (9.83 + 0.168) / 2 = 5.0 over two reports, one up and one down, with the small-sample warning in words.
  await expect(
    panel.getByText('Average size of the move over 2 reports: 5.0% (1 up, 1 down).'),
  ).toBeVisible();
  await expect(panel.getByText(/too few reports to say how often/)).toBeVisible();
  await expect(panel.getByText(/requires a higher Massive plan \(Benzinga data\)/)).toBeVisible();
  // Both releases also mark the chart, on the session that reacted (the 17th and 19th were after the close).
  await page.locator('summary', { hasText: 'All chart markers' }).click();
  await expect(page.getByText('2026-11-18: 8-K: Earnings results released (High)')).toBeVisible();
  await expect(page.getByText('2026-08-20: 8-K: Earnings results released (High)')).toBeVisible();
  // v2: results 8-Ks are E markers, and the detail line carries the same next-session move as the table.
  await page
    .getByRole('button', { name: '2026-08-20: 8-K: Earnings results released (High)' })
    .click();
  await expect(
    page.getByText(
      'E · 20 Aug 2026 · 8-K: Earnings results released (High) · ▼ −9.8% next session',
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '2026-11-18: 8-K: Earnings results released (High)' })
    .click();
  await expect(
    page.getByText(
      'E · 18 Nov 2026 · 8-K: Earnings results released (High) · ▲ +0.2% next session',
    ),
  ).toBeVisible();
  if (process.env.SHOT_DIR)
    await panel.screenshot({ path: `${process.env.SHOT_DIR}/earnings.png` });
});

/** The recorded 10-K rows as `annual_sections` rows (the two real NVIDIA reports, fiscal 2026 and 2025). */
function sectionRows(): Json[] {
  return (sections.body.results as Json[]).map((x) => ({
    period_end: x['period_end'],
    filing_date: x['filing_date'],
    filing_url: x['filing_url'],
    text: x['text'],
  }));
}

test('13F holders: the period, the lag, the top filers and the CUSIPs counted', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/holders_13f_lists**', (r) =>
    json(r, [
      {
        period: '2026-06-30',
        filers: 2,
        total_shares: 1000,
        total_value_usd: 2500000000,
        cusips: [
          { cusip: '773121108', issuer: 'ROCKET LAB CORP', lines: 2 },
          { cusip: '773122106', issuer: 'ROCKET LAB USA INC', lines: 1 },
        ],
        left_out: { options: 3, amendments: 1, otherPeriod: 0, minorCusip: 2 },
      },
    ]),
  );
  await page.route('**/rest/v1/holders_13f?**', (r) =>
    json(r, [
      {
        rank: 1,
        filer_name: 'Fund One',
        shares: 800,
        share: 0.8,
        value_usd: 2000000000,
        filing_date: '2026-08-10',
      },
      {
        rank: 2,
        filer_name: 'Fund Two',
        shares: 200,
        share: 0.2,
        value_usd: 500000000,
        filing_date: '2026-08-12',
      },
    ]),
  );
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Institutional holders (13F)' });
  await panel.getByText('Show the holders').click();
  await expect(
    panel.getByText(
      'Positions as of 2026-06-30: 2 filers reported 1,000 shares worth $2.50 billion.',
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(/^Disclosure lag: positions on 2026-06-30, filed up to 45 days later/),
  ).toBeVisible();
  const first = panel.getByRole('row', { name: /Fund One/ });
  await expect(first).toContainText('800');
  await expect(first).toContainText('80.0%');
  await expect(first).toContainText('$2.00 billion');
  await expect(
    panel.getByText(
      /Counted under CUSIP 773121108 \(ROCKET LAB CORP\), 773122106 \(ROCKET LAB USA INC\)/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(
      /Left out: 3 option lines, 1 amended reports, 0 lines for an older quarter, 2 lines under a CUSIP/,
    ),
  ).toBeVisible();
});

test('quarterly risk factors: two real Rocket Lab 10-Qs, the newest as filed and the comparison', async ({
  page,
}) => {
  await setup(page);
  const rows = [
    {
      accession: '0001819994-26-000074',
      filing_date: '2026-11-09',
      filing_url:
        'https://www.sec.gov/Archives/edgar/data/1819994/000181999426000074/rklb-20260930.htm',
      text: 'Other than as set forth below, there have been no material changes from the risk factors previously disclosed. Our new launch vehicle may be delayed.',
      no_material_changes: false,
    },
    {
      accession: '0001819994-26-000062',
      filing_date: '2026-08-10',
      filing_url:
        'https://www.sec.gov/Archives/edgar/data/1819994/000181999426000062/rklb-20260630.htm',
      text: 'Other than as set forth below, there have been no material changes from the risk factors previously disclosed. The Iridium Transaction may not close.',
      no_material_changes: false,
    },
  ];
  // The company brief reads only the newest 10-Q's flag (no text); the text is read only when opened.
  let asked = 0;
  let flagReads = 0;
  await page.route('**/rest/v1/quarterly_sections**', (r) => {
    const select = new URL(r.request().url()).searchParams.get('select') ?? '';
    if (select.split(',').includes('text')) asked++;
    else flagReads++;
    return json(r, rows);
  });
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  // Year on year shows first; quarter on quarter is the other half of the toggle (v2).
  await page.getByRole('button', { name: 'Quarter on quarter (10-Q)' }).click();
  const panel = page.getByRole('region', { name: 'Risk factors, quarter over quarter (10-Q)' });
  expect(asked).toBe(0);
  expect(flagReads).toBe(1);
  // The brief (overview) flags the newest 10-Q's risk factor changes, with its date.
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Company brief' })
      .getByText(
        'The newest 10-Q (filed 09 Nov 2026) lists risk factors added or changed since the annual report.',
      ),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  await panel.getByText('Show the quarterly updates').click();
  await expect(panel.getByText('Newest 10-Q, filed 2026-11-09.')).toBeVisible();
  await expect(panel.getByText(/This quarter lists risk factors added or changed/)).toBeVisible();
  await expect(
    panel.getByRole('region', { name: 'Quarterly risk factors as filed' }),
  ).toContainText('Our new launch vehicle may be delayed.');
  await expect(
    panel.getByText('Compared with the 10-Q filed 2026-08-10 (newer: 2026-11-09).'),
  ).toBeVisible();
  // One sentence each side is new or gone; the shared first sentence is unchanged.
  await expect(panel.getByText('1 new, 1 removed, 0 edited, 1 unchanged sentences.')).toBeVisible();
});

test('business: the real 10-K Item 1 text loads only when opened, with its filing link', async ({
  page,
}) => {
  await setup(page);
  const asked: string[] = [];
  await page.route('**/rest/v1/annual_sections**', (r) => {
    asked.push(r.request().url());
    const x = business.body.results[0] as Json;
    return json(r, [
      {
        period_end: x['period_end'],
        filing_date: x['filing_date'],
        filing_url: x['filing_url'],
        text: x['text'],
      },
    ]);
  });
  await page.goto('/study/NVDA');
  // The company brief reads the section once for its first sentence, as filed, with the filing date; the panel
  // below reuses that read rather than asking again (company-brief-1).
  const brief = page.getByRole('region', { name: 'Company brief' });
  await expect(
    brief.getByText(
      'NVIDIA pioneered accelerated computing to help solve the most challenging computational problems.',
    ),
  ).toBeVisible();
  await expect(
    brief.getByText(
      'First sentence of the 10-K business section, as filed 25 Feb 2026 (year ended 25 Jan 2026).',
    ),
  ).toBeVisible();
  const panel = page.getByRole('region', { name: 'What the company does (10-K, Item 1)' });
  await openInfo(page.getByRole('region', { name: 'What the company does (10-K, Item 1)' }));
  await expect(panel.getByText(/not an independent view/)).toBeVisible();
  expect(asked).toHaveLength(1);
  await panel.getByText('Show the business description').click();
  await expect(panel.getByText('Year ended 2026-01-25, filed 2026-02-25.')).toBeVisible();
  await expect(panel.getByText(/NVIDIA pioneered accelerated computing/)).toBeVisible();
  await expect(panel.getByRole('link', { name: '10-K on SEC' })).toHaveAttribute(
    'href',
    'https://www.sec.gov/Archives/edgar/data/1045810/0001045810-26-000021.txt',
  );
  expect(asked[0]).toContain('section=eq.business');
  expect(asked).toHaveLength(1);
});

test('risk factors: nothing is fetched until opened, then two real 10-Ks are compared by sentence', async ({
  page,
}) => {
  await setup(page);
  let fetched = 0;
  await page.route('**/rest/v1/annual_sections**', (r) => {
    // The company brief reads the business section; only the risk factor reads count here.
    if (!r.request().url().includes('section=eq.risk_factors')) return json(r, []);
    fetched++;
    return json(r, sectionRows());
  });
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Risk factors, year over year (10-K)' });
  await openInfo(page.getByRole('region', { name: 'Risk factors, year over year (10-K)' }));
  await expect(panel.getByText(/by computer rules and not by a model/)).toBeVisible();
  await expect(panel.getByText('Latest filing used')).toHaveCount(0);
  expect(fetched).toBe(0); // two 110 KB reports are not loaded for everyone who opens the page
  await panel.getByText('Show the comparison').click();
  // Counts from an independent Python implementation of the same rules, run on the same two recorded reports.
  await expect(
    panel.getByText('71 new, 49 removed, 66 edited, 449 unchanged sentences.'),
  ).toBeVisible();
  await expect(
    panel.getByText(
      'Newer: year ended 2026-01-25, filed 2026-02-25. Older: year ended 2025-01-26, filed 2025-02-26.',
    ),
  ).toBeVisible();
  const newer = panel.getByRole('link', { name: 'Newer 10-K on SEC' });
  await expect(newer).toHaveAttribute(
    'href',
    'https://www.sec.gov/Archives/edgar/data/1045810/0001045810-26-000021.txt',
  );
  await expect(newer).toHaveAttribute('target', '_blank');
  await expect(newer).toHaveAttribute('rel', /noopener/);
  await expect(
    panel.getByText(/The list at the top of the section repeats each risk title/),
  ).toBeVisible();
  // New and removed wording, quoted exactly, under the heading it sat under.
  await expect(
    panel.getByText(
      'We have entered into an intellectual property license arrangement with Groq, Inc., or Groq, that required significant, nonrefundable payments.',
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(
      'NVIDIA DGX Cloud services may not be successful and will take time, resources, and investment.',
    ),
  ).toBeVisible();
  // An edited sentence shows the old and new word, marked by more than colour.
  const edited = panel.getByRole('heading', { name: 'Edited (66)' });
  await expect(edited).toBeVisible();
  await expect(panel.locator('del', { hasText: 'component' }).first()).toBeVisible();
  await expect(panel.locator('ins', { hasText: 'capacity' }).first()).toBeVisible();
  await expect(panel.getByText('Similarity 0.93').first()).toBeVisible();
  if (process.env.SHOT_DIR) await panel.screenshot({ path: `${process.env.SHOT_DIR}/risk.png` });
  // Long lists start short and open on request.
  await expect(panel.getByRole('button', { name: 'Show all 71' })).toBeVisible();
  await panel.getByRole('button', { name: 'Show all 71' }).click();
  await expect(panel.getByRole('button', { name: 'Show fewer' }).first()).toBeVisible();
  expect(fetched).toBe(1);
});

test('risk factors: says why there is nothing to compare', async ({ page }) => {
  await setup(page);
  const run = async (rows: Json[], expected: RegExp | string) => {
    await page.unroute('**/rest/v1/annual_sections**');
    await page.route('**/rest/v1/annual_sections**', (r) => json(r, rows));
    await page.goto('/study/NVDA');
    await page.getByRole('tab', { name: 'Filings', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Risk factors, year over year (10-K)' });
    await panel.getByText('Show the comparison').click();
    await expect(panel.getByText(expected)).toBeVisible();
  };
  await run([], 'No annual report text is stored for this company');
  await run(sectionRows().slice(0, 1), 'Only one annual report is stored');
  // The vendor's real history jumped from 2025 to 2017: not a fair comparison, so none is made.
  const [a, b] = sectionRows() as [Json, Json];
  await run(
    [a, { ...b, period_end: '2017-01-29' }],
    /years ending 2026-01-25 and 2017-01-29, which are not a year apart/,
  );
});

test('insiders: codes explained, the 10b5-1 box shown, totals computed, unreadable filings admitted', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Insider filings (Forms 3, 4 and 5)' });
  await expect(panel.getByText('Teter Timothy S.').first()).toBeVisible();
  await expect(panel.getByText('Officer, EVP, General Counsel and Sec').first()).toBeVisible();
  await expect(panel.getByText(/Open-market or private sale of securities/).first()).toBeVisible();
  await expect(panel.getByText('Plan box checked').first()).toBeVisible();
  await expect(panel.getByText(/Filed within two business days after the trade/)).toBeVisible();
  // 1,434 + 1,410 = 2,844 shares; 1,434 x 146.0298 + 1,410 x 157.4947 = $431,474.26 (computed separately in Python).
  // The two sales in the amended Form 5 (2023 and 2024) are outside the 90 days and are not added.
  await expect(panel.getByText(/sold 2,844 shares \(\$431,474\.26\)/)).toBeVisible();
  await expect(
    panel.getByText('1 insider filing could not be read and is not included.'),
  ).toBeVisible();
});

test('insiders: Forms 3 and 5 with their lags, an owns-nothing statement, a joint filing and a late amendment', async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Insider filings (Forms 3, 4 and 5)' });
  // All three lags are stated, and the difference between trade date and filed date is explained.
  await expect(
    panel.getByText('Form 3: Filed within 10 days after the person becomes an insider.'),
  ).toBeVisible();
  await expect(
    panel.getByText(
      'Form 5: Filed up to 45 days after the fiscal year ends, for trades not reported earlier.',
    ),
  ).toBeVisible();
  await expect(
    panel.getByText(/A Form 5 can report trades made long before it was filed/),
  ).toBeVisible();

  // The amended Form 5 reports sales from 2023 and 2024 that were filed on 2025-03-21: both dates are shown.
  const late = panel.getByRole('row', { name: /^2023-12-13/ });
  await expect(late).toContainText('2025-03-21');
  await expect(late).toContainText('Form 5/A');
  await expect(late).toContainText('amendment');
  await expect(late).toContainText('Drell Persis');

  // Form 3 (initial holdings): reported 8 days after the person became an insider on 2026-11-04.
  const holdings = panel.getByRole('heading', { name: 'Initial holdings (Form 3)' });
  await expect(holdings).toBeVisible();
  const oklo = panel.getByRole('listitem').filter({ hasText: 'Petit de Mange Edward' });
  await expect(oklo).toContainText('Officer, VP of Recycling');
  await expect(oklo).toContainText('Became an insider 2026-11-04, filed 2026-11-12, 8 days later');
  await expect(oklo.getByRole('row', { name: /Class A Common Stock/ }).first()).toContainText(
    '61,985 shares',
  );
  // A restricted stock unit gives no price (only a footnote) and no date: said so, not left blank or guessed.
  const rsu = oklo.getByRole('row', { name: /Restricted Stock Units/ });
  await expect(rsu).toContainText('converts into 1,938 Class A Common Stock');
  await expect(rsu).toContainText('Not stated, see the filing notes');
  await expect(rsu).toContainText('represents a contingent right to receive one share');
  const option = oklo.getByRole('row', { name: /Stock Option/ });
  await expect(option).toContainText('$3.18');
  await expect(option).toContainText('2033-12-22');
  await expect(option).toContainText('converts into 109,116 Class A Common Stock');

  // A Form 3 that says the person owns nothing is an explicit statement.
  await expect(panel.getByRole('listitem').filter({ hasText: 'Huberman Andrew D' })).toContainText(
    'The filing states that this person owns no securities.',
  );

  // A joint amended Form 3 names its other owners and the indirect holding.
  const joint = panel.getByRole('listitem').filter({ hasText: 'GV 2019 GP, L.L.C.' });
  await expect(joint).toContainText('and 3 other reporting owners');
  await expect(joint).toContainText('10% owner');
  await expect(joint).toContainText('Form 3/A: Amendment of a report submitted 2021-10-04');
  await expect(joint).toContainText('Indirect: By GV 2019 L.P.');
  await expect(joint).toContainText('4,556,532 shares');
  if (process.env.SHOT_DIR)
    await panel.screenshot({ path: `${process.env.SHOT_DIR}/insiders.png` });
});

test('short data: both definitions, the lag, and the real rows', async ({ page }) => {
  await setup(page);
  await page.goto('/study/NVDA');
  // The company brief's short interest line (overview) reads the same stored rows as the panel.
  await expect(page.getByText(/M shares$/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Short interest and short volume' });
  await expect(
    panel.getByText(/Short interest: shares sold short and not yet covered/),
  ).toBeVisible();
  await openInfo(page.getByRole('region', { name: 'Short interest and short volume' }));
  await expect(panel.getByText(/It is not short interest/)).toBeVisible();
  await expect(panel.getByRole('row', { name: /^2026-10-30/ })).toContainText('279,579,505');
  await expect(panel.getByRole('row', { name: /^2026-10-30/ })).toContainText('2.8');
  await expect(panel.getByRole('row', { name: /^2026-11-23/ })).toContainText('29.1%');
});

test('news: tiers and opinion labelled, one story once, links open the publisher in a new tab', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/study/NVDA');
  // Squeezed: the news is a tab of the company area, beside the filings, one tap away.
  await page.getByRole('tab', { name: 'News', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Latest company news' });
  // Reporting shows first; opinion and tier 3 or 4 sit behind a toggle (council batch 2).
  await expect(panel.getByRole('link', { name: 'Why Sandisk Stock Plunged Today' })).toHaveCount(0);
  await panel.getByRole('button', { name: /^Show opinion and tier 3 or 4/ }).click();
  // The newest four show first; the rest are one tap away.
  const more = panel.getByRole('button', { name: /^Show \d+ more$/ });
  if ((await more.count()) > 0) await more.click();
  const first = panel.getByRole('link', { name: 'Why Sandisk Stock Plunged Today' });
  await expect(first).toHaveAttribute('target', '_blank');
  await expect(first).toHaveAttribute('rel', /noopener/);
  await expect(panel.getByText('Tier 3').first()).toBeVisible();
  await expect(panel.getByText('Analysis or opinion').first()).toBeVisible();
  // The real wire item is tier 2 reporting, not opinion.
  await expect(panel.getByText('Tier 2').first()).toBeVisible();
  await expect(panel.getByText('Reporting').first()).toBeVisible();
});

test('dividends: the declared December dividend is listed as upcoming', async ({ page }) => {
  await setup(page);
  await page.goto('/study/NVDA');
  await openSection(page, 'Dividends');
  await expect(
    page.getByText('Ex-dividend 2026-12-02: $0.25, paid 2026-12-23 (upcoming)'),
  ).toBeVisible();
});

test('one failing panel shows its own error and leaves the rest of the page working', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/short_interest**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
  );
  await page.route('**/rest/v1/short_volume**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
  );
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Short interest and short volume could not be loaded' }),
  ).toBeVisible({ timeout: 15_000 });
  await openSection(page, 'Financials');
  await expect(page.getByText('Latest filing used: 2026-08-26')).toBeVisible();
  await expect(page.getByText('$300.00').first()).toBeVisible();
});

test('thesis card: a new version needs a real bear case, is saved append-only and sets the holding status', async ({
  page,
}) => {
  await setup(page);
  const saved: { table: string; method: string; body: unknown }[] = [];
  const v1 = {
    id: 1,
    ticker: 'NVDA',
    status: 'intact',
    bull: 'Data-center demand keeps compounding.',
    bear: 'Hyperscaler capex peaks and custom chips take share, compressing margins from a high base.',
    risks: ['Capex cycle', 'Export limits'],
    change_view: 'Two quarters of falling data-center revenue, or gross margin under 65%.',
    sources: ['https://www.sec.gov/'],
    created_at: '2026-11-20T10:00:00Z',
  };
  await page.route('**/rest/v1/theses**', (r) => {
    if (r.request().method() === 'GET') return json(r, [v1]);
    saved.push({ table: 'theses', method: r.request().method(), body: r.request().postDataJSON() });
    return r.fulfill({ status: 201, body: '' });
  });
  await page.route('**/rest/v1/holdings**', (r) => {
    // The company brief reads a holding's sector fund; only writes are recorded here.
    if (r.request().method() === 'GET') return json(r, []);
    saved.push({
      table: 'holdings',
      method: r.request().method(),
      body: r.request().postDataJSON(),
    });
    return r.fulfill({ status: 204, body: '' });
  });
  await page.goto('/study/NVDA');
  const card = page.getByRole('region', { name: 'Thesis card' });
  await expect(card).toContainText('Status: Intact.');
  await expect(card).toContainText('Hyperscaler capex peaks');
  await card.getByRole('button', { name: 'Write a new version' }).click();
  const form = card.getByRole('form', { name: 'Write a new version' });
  await form.getByLabel('Status').selectOption('weakening');
  await form.getByLabel('Bear case (required)').fill('Could go down.');
  await form.getByRole('button', { name: 'Save new version' }).click();
  await expect(form).toContainText('The bear case is required: at least 40 characters');
  expect(saved).toEqual([]);
  await form
    .getByLabel('Bear case (required)')
    .fill('Custom accelerators win the next cycle and pricing power fades into 2027.');
  await form.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[0]).toMatchObject({
    table: 'theses',
    method: 'POST',
    body: { ticker: 'NVDA', status: 'weakening', risks: ['Capex cycle', 'Export limits'] },
  });
  expect(saved[1]).toMatchObject({
    table: 'holdings',
    method: 'PATCH',
    body: { thesis_status: 'weakening' },
  });
});

/** A stored AI output row (ai_outputs) as the job writes it; the text and figures are made up for the test. */
function aiRow(kind: string, over: Json = {}): Json {
  return {
    id: 7,
    kind,
    ticker: 'NVDA',
    for_date: null,
    text: '',
    citations: [],
    verified: true,
    source: 'model',
    fallback_reason: null,
    model: 'claude-sonnet-5-5',
    served_model: 'claude-sonnet-5-5',
    prompt_id: kind,
    prompt_version: 1,
    created_at: '2026-11-25T00:52:00Z',
    ...over,
  };
}

const XBRL_URL =
  'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000101/0001045810-26-000101-index.htm';
const TENQ_URL =
  'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000101/nvda-20260726.htm';
const CITES = [
  {
    id: 'F3',
    kind: 'fact',
    label: 'Revenue, quarter ended 2026-07-26',
    url: XBRL_URL,
    source: 'SEC XBRL company facts, accession 0001045810-26-000101',
    asOf: '2026-08-27',
  },
  {
    id: 'D1',
    kind: 'document',
    label: '10-Q risk factors (Part II, Item 1A)',
    url: TENQ_URL,
    source: 'SEC 10-Q 0001045810-26-000101, Part II Item 1A',
    asOf: '2026-08-27',
  },
];

test('thesis card: the AI draft is labelled, cited, and only fills the form; saving stays a human edit', async ({
  page,
}) => {
  await setup(page);
  const saved: unknown[] = [];
  await page.route('**/rest/v1/theses**', (r) => {
    if (r.request().method() === 'GET') return json(r, []);
    saved.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, body: '' });
  });
  const draft =
    'Bull case: revenue was $46.74B in the quarter ended 2026-07-26 [F3]. Bear case: the 10-Q repeats the annual risk factors, so concentration in a few large customers remains a real threat to growth [D1]. Key risks: customer concentration [D1]. What would change the view: a new 10-Q that reports material changes to the risk factors [D1].';
  const asked: string[] = [];
  await page.route('**/rest/v1/ai_outputs**', (r) => {
    asked.push(r.request().url());
    return json(
      r,
      r.request().url().includes('kind=eq.thesis-draft')
        ? [aiRow('thesis-draft', { text: draft, citations: CITES })]
        : [],
    );
  });
  await page.goto('/study/NVDA');
  const card = page.getByRole('region', { name: 'Thesis card' });
  const ai = card.getByRole('region', { name: 'AI draft, check before saving' });
  await expect(ai).toContainText('Bear case: the 10-Q repeats the annual risk factors');
  await expect(ai).toContainText('As of 2026-11-25 · Claude Sonnet 5.5');
  await expect(ai).toContainText('It is not your thesis until you edit it and save it yourself.');
  await ai.getByText('Sources cited (2)').click();
  await expect(ai.getByRole('link', { name: 'Filing on SEC' }).nth(1)).toHaveAttribute(
    'href',
    TENQ_URL,
  );
  // Nothing is saved by showing the draft.
  expect(saved).toEqual([]);
  await ai.getByRole('button', { name: 'Start from this draft' }).click();
  const form = card.getByRole('form', { name: 'Write a new version' });
  // Citations are removed in the form; the cited filings become the sources.
  await expect(form.getByLabel('Bear case (required)')).toHaveValue(
    'the 10-Q repeats the annual risk factors, so concentration in a few large customers remains a real threat to growth.',
  );
  await expect(form.getByLabel('Key risks (one a line)')).toHaveValue('customer concentration');
  await expect(form.getByLabel('Sources (https links, one a line)')).toHaveValue(
    `${XBRL_URL}\n${TENQ_URL}`,
  );
  expect(saved).toEqual([]);
  await form
    .getByLabel('What would change my view (required)')
    .fill('A new 10-Q that reports material changes to the risk factors, or a revenue decline.');
  await form.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ ticker: 'NVDA', risks: ['customer concentration'] });
  expect(asked.some((u) => u.includes('ticker=eq.NVDA'))).toBe(true);
});

test('thesis card: a draft that fell back to the template is not offered, and says why', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/theses**', (r) => json(r, []));
  await page.route('**/rest/v1/ai_outputs**', (r) =>
    json(r, [
      aiRow('thesis-draft', {
        source: 'template',
        fallback_reason: 'cost-cap',
        served_model: null,
        text: 'Revenue, quarter ended 2026-07-26: $46.74B [F3].',
      }),
    ]),
  );
  await page.goto('/study/NVDA');
  const card = page.getByRole('region', { name: 'Thesis card' });
  await expect(card).toContainText(
    'No AI draft for the newest filings: the daily or monthly AI spending cap was reached.',
  );
  await expect(card.getByRole('button', { name: 'Start from this draft' })).toHaveCount(0);
});

test('filing summary: the verified AI summary with its label, model, date and linked sources (2.9)', async ({
  page,
}) => {
  await setup(page);
  const summary =
    'Revenue was $46.74B in the quarter ended 2026-07-26 [F3]. The 10-Q reports no material change to the risk factors [D1].';
  let rows: Json[] = [];
  await page.route('**/rest/v1/ai_outputs**', (r) =>
    json(r, r.request().url().includes('kind=eq.filing-summary') ? rows : []),
  );
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Filing summary' });
  // Before the first run: unavailable, said plainly.
  await expect(panel).toContainText(
    'No filing summary yet. Summaries are written each weekday night once the Anthropic key is added.',
  );
  rows = [aiRow('filing-summary', { text: summary, citations: CITES })];
  await page.reload();
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  await expect(panel).toContainText('AI summary (Claude), checked against the filing figures');
  await expect(panel).toContainText(summary);
  await expect(panel).toContainText(
    'As of 2026-11-25 · Claude Sonnet 5.5 Newest filing cited: 2026-08-27.',
  );
  await panel.getByText('Sources cited (2)').click();
  const sources = panel.getByRole('list', { name: 'Filing summary' });
  await expect(sources).toContainText('[F3] Revenue, quarter ended 2026-07-26');
  await expect(sources).toContainText(
    'SEC 10-Q 0001045810-26-000101, Part II Item 1A, filed 2026-08-27',
  );
  await expect(sources.getByRole('link', { name: 'Filing on SEC' })).toHaveCount(2);
  await expect(sources.getByRole('link', { name: 'Filing on SEC' }).first()).toHaveAttribute(
    'href',
    XBRL_URL,
  );
  await openInfo(panel);
  await expect(panel.getByText(/Code checked every figure against those filings/)).toBeVisible();
});

test('filing summary: when the model could not be used, the figures themselves with the reason', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/ai_outputs**', (r) =>
    json(r, [
      aiRow('filing-summary', {
        source: 'template',
        fallback_reason: 'verification-failed',
        served_model: null,
        attempts: 2,
        text: 'Revenue, quarter ended 2026-07-26: $46.74B [F3].\n10-Q (quarterly report) filed on: 2026-08-27 [D1].',
        citations: CITES,
      }),
    ]),
  );
  await page.goto('/study/NVDA');
  await page.getByRole('tab', { name: 'Filings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Figures from the filings' });
  await expect(panel).toContainText(
    'No AI summary for these filings: its figures did not match the filings, twice. The figures below come straight from the filings.',
  );
  await expect(panel.getByRole('listitem').first()).toHaveText(
    'Revenue, quarter ended 2026-07-26: $46.74B [F3].',
  );
  await expect(
    panel.getByText('AI summary (Claude), checked against the filing figures'),
  ).toHaveCount(0);
});

test('Shariah screening aid: off by default; when on, ratios from the filings with every caveat', async ({
  page,
}) => {
  await setup(page);
  let settings: Json | null = null;
  await page.route('**/rest/v1/user_settings**', (r) =>
    json(r, settings === null ? [] : [settings]),
  );
  await page.goto('/study/NVDA');
  await openSection(page, 'Shariah aid');
  await expect(page.getByText('The Shariah screening aid is off.')).toBeVisible();
  // The header says the aid is off rather than showing no status.
  await expect(page.getByText('Shariah aid off')).toBeVisible();

  settings = {
    shariah_screen: true,
    shariah_basis: 'market-cap',
    shariah_debt_max: 0.33,
    shariah_cash_max: 0.33,
  };
  await page.reload();
  await openSection(page, 'Shariah aid');
  const aid = page.getByRole('region', { name: 'Shariah screening aid' });
  // Market cap: last close 300.00 x 24.1 billion shares (cover page filed 2026-08-26) = USD 7.23 trillion.
  // Long-term debt 33.366 billion / 7,230 billion = 0.5%; cash 22.443 billion / 7,230 billion = 0.3%.
  await expect(aid).toContainText('Debt: 0.5% (limit below 33.0%): within the limit.');
  await expect(aid).toContainText('Cash: 0.3% (limit below 33.0%): within the limit.');
  await expect(aid).toContainText('Passes the financial ratios.');
  await expect(aid).toContainText('Sahm’s own Shariah label takes precedence.');
  await expect(aid).toContainText('Business activity is not screened');
  // The header carries the same verdict (v2), as a screening aid.
  await expect(page.locator('header').getByText('Shariah ratios within limits')).toBeVisible();

  // The Study list shows the same verdict as a chip, from the same helper.
  await page.route('**/rest/v1/daily_bars**', (r) =>
    json(
      r,
      bars().map((b) => ({ ...b, ticker: 'NVDA' })),
    ),
  );
  await page.goto('/study');
  // The starting-stocks list (the recently viewed card above it links NVDA too, without the aid).
  const nvda = page
    .getByRole('region', { name: 'Starting stocks' })
    .getByRole('link', { name: /^NVDA/ });
  await expect(nvda).toContainText('Within limits');
  await expect(nvda).toContainText('Shariah screening aid, not a ruling:');
});

test('chart markers: a halt on its session and an after-close alert on the next session', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/rest/v1/halts**', (r) =>
    json(r, [
      { halted_at: '2026-11-17T19:32:05+00:00', reason_code: 'T1', reason_meaning: 'News pending' },
    ]),
  );
  await page.route('**/rest/v1/alerts**', (r) =>
    json(r, [{ created_at: '2026-11-18T22:40:00+00:00', headline: 'NVDA test alert' }]),
  );
  await page.goto('/study/NVDA');
  await page.locator('summary', { hasText: 'All chart markers' }).click();
  // 19:32 UTC is 14:32 ET, during the session; 22:40 UTC is 17:40 ET, after the close.
  await expect(page.getByText('2026-11-17: Halt: T1 (News pending)')).toBeVisible();
  await expect(page.getByText('2026-11-19: Alert: NVDA test alert')).toBeVisible();
  // Choosing a marker puts its detail line under the chart, with its letter (v2: H halt, A Marsad alert).
  await page.getByRole('button', { name: '2026-11-17: Halt: T1 (News pending)' }).click();
  await expect(page.getByText('H · 17 Nov 2026 · Halt: T1 (News pending)')).toBeVisible();
  await page.getByRole('button', { name: '2026-11-19: Alert: NVDA test alert' }).click();
  await expect(page.getByText('A · 19 Nov 2026 · Alert: NVDA test alert')).toBeVisible();
});
