import { expect, test, type Page, type Route } from '@playwright/test';
import dividends from '../../../fixtures/massive/dividends-NVDA.json' with { type: 'json' };
import news from '../../../fixtures/massive/news-NVDA.json' with { type: 'json' };
import sections from '../../../fixtures/massive/sections-NVDA-risk_factors.json' with { type: 'json' };
import shortInterest from '../../../fixtures/massive/short-interest-NVDA.json' with { type: 'json' };
import shortVolume from '../../../fixtures/massive/short-volume-NVDA.json' with { type: 'json' };
import factsFixture from '../../../fixtures/sec/companyfacts-NVDA-trimmed.json' with { type: 'json' };
import { seedSession } from './helpers';

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
  await page.route('**/rest/v1/market_holidays**', empty);
  await page.route('**/rest/v1/splits**', empty);
  await page.route('**/rest/v1/daily_bars**', (r) => json(r, bars()));
  await page.route('**/rest/v1/instruments**', (r) =>
    json(r, [{ cik: '0001045810', name: 'NVIDIA CORP' }]),
  );
  await page.route('**/rest/v1/filings**', empty);
  await page.route('**/rest/v1/financial_facts**', (r) => json(r, factRows()));
  await page.route('**/rest/v1/insider_filings**', (r) =>
    json(r, [
      {
        accession: '0001696841-26-000016',
        status: 'ok',
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
  await expect(panel.getByText('37.9x')).toBeVisible();
  await expect(panel.getByText('Balance sheet at 2026-07-26')).toBeVisible();
  await expect(panel.getByText('$320.27B')).toBeVisible();
  // Point in time: the day before the Q2 10-Q was filed, that quarter is not there yet.
  await panel.getByLabel('Known as of').fill('2026-08-25');
  await expect(panel.getByText('Latest filing used: 2026-05-20')).toBeVisible();
  await expect(quarters.getByRole('row', { name: /^2026-07-26/ })).toHaveCount(0);
  await expect(quarters.getByRole('row', { name: /^2026-04-26/ })).toContainText('$81.62B');
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/panels.png`, fullPage: true });
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
  await expect(page.getByText('2026-11-18: 8-K: Earnings results released (High)')).toBeVisible();
  await expect(page.getByText('2026-08-20: 8-K: Earnings results released (High)')).toBeVisible();
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

test('risk factors: nothing is fetched until opened, then two real 10-Ks are compared by sentence', async ({
  page,
}) => {
  await setup(page);
  let fetched = 0;
  await page.route('**/rest/v1/annual_sections**', (r) => {
    fetched++;
    return json(r, sectionRows());
  });
  await page.goto('/study/NVDA');
  const panel = page.getByRole('region', { name: 'Risk factors, year over year (10-K)' });
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
  const panel = page.getByRole('region', { name: 'Insider transactions (Form 4)' });
  await expect(panel.getByText('Teter Timothy S.').first()).toBeVisible();
  await expect(panel.getByText('Officer, EVP, General Counsel and Sec').first()).toBeVisible();
  await expect(panel.getByText(/Open-market or private sale of securities/).first()).toBeVisible();
  await expect(panel.getByText('Plan box checked').first()).toBeVisible();
  await expect(panel.getByText(/Filed within two business days after the trade/)).toBeVisible();
  // 1,434 + 1,410 = 2,844 shares; 1,434 x 146.0298 + 1,410 x 157.4947 = $431,474.26 (computed separately in Python).
  await expect(panel.getByText(/sold 2,844 shares \(\$431,474\.26\)/)).toBeVisible();
  await expect(
    panel.getByText('1 insider filing could not be read and is not included.'),
  ).toBeVisible();
});

test('short data: both definitions, the lag, and the real rows', async ({ page }) => {
  await setup(page);
  await page.goto('/study/NVDA');
  const panel = page.getByRole('region', { name: 'Short interest and short volume' });
  await expect(
    panel.getByText(/Short interest: shares sold short and not yet covered/),
  ).toBeVisible();
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
  const panel = page.getByRole('region', { name: 'News' });
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
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Short interest and short volume could not be loaded' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Latest filing used: 2026-08-26')).toBeVisible();
  await expect(page.getByText('$300.00').first()).toBeVisible();
});
