import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { openSection, seedSession, scanAfterEach } from './helpers';

scanAfterEach();

/** 260 weekday bars ending on `last`, rising 0.5 a day so every average and the trend are defined. */
function bars(last: string) {
  const out: Record<string, unknown>[] = [];
  const d = new Date(`${last}T00:00:00Z`);
  while (out.length < 260) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      // k counts back from the last bar, so the last close is 300 and the one before it 299.5.
      const k = out.length;
      const close = 300 - k * 0.5;
      out.unshift({
        date: d.toISOString().slice(0, 10),
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1_000_000 + k,
        vwap: close,
      });
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const filings = [
  {
    accession: '0001045810-26-000090',
    form: '8-K',
    filing_date: '2026-11-23',
    accepted_at: '2026-11-23T13:57:54Z',
    primary_document: 'nvda-20261122.htm',
    items: ['5.02', '9.01'],
  },
  {
    accession: '0001696841-26-000016',
    form: '4',
    filing_date: '2026-11-23',
    accepted_at: '2026-11-23T21:54:28Z',
    primary_document: 'xslF345X06/wk-form4_1795470863.xml',
    items: [],
  },
];

function json(route: Route, body: unknown) {
  const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const payload = wantsObject && Array.isArray(body) ? (body[0] ?? null) : body;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

async function mock(page: Page, lastBar: string, withFilings = true) {
  await seedSession(page, 'aal2');
  // 20:00 ET on Tuesday 2026-11-24: that day's session has finished, so its bar is expected.
  await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
  await page.route('**/rest/v1/daily_bars**', (r) => json(r, bars(lastBar)));
  await page.route('**/rest/v1/instruments**', (r) =>
    json(r, [{ cik: '0001045810', name: 'NVIDIA CORP' }]),
  );
  await page.route('**/rest/v1/filings**', (r) => json(r, withFilings ? filings : []));
  await page.route('**/rest/v1/splits**', (r) => json(r, []));
  await page.route('**/rest/v1/market_holidays**', (r) => json(r, []));
  // The data panels load on their own. Empty by default; tests that care register their own rows after this.
  for (const table of [
    'financial_facts',
    'insider_filings',
    'insider_transactions',
    'news_articles',
    'short_interest',
    'short_volume',
    'dividends',
  ])
    await page.route(`**/rest/v1/${table}**`, (r) => json(r, []));
}

test('the company page shows the summary, a drawn chart, labelled filings and honest placeholders', async ({
  page,
}) => {
  await mock(page, '2026-11-24');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/study/NVDA');

  await expect(page.getByRole('heading', { name: /NVDA/ })).toBeVisible();
  await expect(page.getByText('NVIDIA CORP')).toBeVisible();

  // Summary: last close $300.00, up 0.17% (a 299.50 prior close), trend and provenance in words.
  await expect(page.getByText('$300.00').first()).toBeVisible();
  await expect(page.getByText('▲ +0.17%')).toBeVisible();
  await expect(page.getByText('Above the 50- and 200-day averages')).toBeVisible();
  await expect(
    page.getByText(/Source: Massive daily bars, end-of-day, split-adjusted/),
  ).toBeVisible();
  await expect(page.getByText('Current: the latest completed session is stored')).toBeVisible();

  // The chart really draws (canvas elements exist and have size).
  const canvas = page
    .getByRole('figure', { name: /Daily candlestick chart for NVDA, last bar 2026-11-24/ })
    .locator('canvas')
    .first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(300);
  // Pointing at the chart shows the day and close under the crosshair.
  const box = await canvas.boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(page.getByTestId('chart-readout')).toHaveText(
    /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d+\.\d{2}$/,
  );

  // v2 chart card: the indicator toggles, RSI 14 as a value chip (a steady rise has no losses, so 100.0), the range.
  const indicators = page.getByRole('group', { name: 'Indicators' });
  await expect(indicators.getByRole('button', { name: 'SMA 50' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(indicators.getByRole('button', { name: 'RSI 14: 100.0' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Chart range' }).getByRole('button', { name: '1Y' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // 52-week range in the legend: closes rise 0.5 a day for 252 sessions, highs 2 above and lows 2 below the close.
  await expect(page.getByText(/52-week range \$172\.50 to \$302\.00/)).toBeVisible();

  // 08:57 ET pre-market on the 23rd, so the 8-K marker sits on the 23rd's bar. It is the newest marker, so its
  // detail line shows under the chart until another is picked; F is an 8-K that is not results.
  await expect(
    page.getByText('F · 23 Nov 2026 · 8-K: Executive or director change (High)'),
  ).toBeVisible();
  await page.locator('summary', { hasText: 'All chart markers (1)' }).click();
  await expect(
    page.getByText('2026-11-23: 8-K: Executive or director change (High)'),
  ).toBeVisible();

  // Snapshot: no XBRL facts stored here, so the figures say not reported rather than guess.
  const snapshot = page.getByRole('region', { name: 'Snapshot' });
  await expect(snapshot.getByText('Market value', { exact: true })).toBeVisible();
  await expect(snapshot.getByText('Not reported').first()).toBeVisible();
  // News and filings sit side by side as their own cards.
  await expect(page.getByRole('heading', { name: 'Latest company news' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Filings and announcements' })).toBeVisible();

  // Anything the free plan cannot give says so, and says what it would take (Overview, open first).
  await expect(page.getByText('Requires a higher Massive plan.').first()).toBeVisible();
  await expect(
    page.getByText('Earnings against estimates, surprise and implied move'),
  ).toBeVisible();

  // The 8-K is labelled in plain words with its materiality; the Form 4 shows its reporting lag (v2: the
  // Filings and announcements card, on the page).
  await expect(page.getByText('Item 5.02: Executive or director change')).toBeVisible();
  await expect(page.getByText('Item 9.01: Attached documents and exhibits')).toBeVisible();
  await expect(page.getByText('High', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(/Filed within two business days after the trade/).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /View on SEC/ }).first()).toHaveAttribute(
    'href',
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/nvda-20261122.htm',
  );
  // Quarterly risk factors are built now (ADR 0036): the other half of the risk factor diff toggle.
  await openSection(page, 'Risk factor diff');
  await page.getByRole('button', { name: 'Quarter on quarter (10-Q)' }).click();
  await expect(
    page.getByRole('heading', { name: 'Risk factors, quarter over quarter (10-Q)' }),
  ).toBeVisible();
  await openSection(page, 'Holders and insiders');
  await expect(page.getByRole('heading', { name: 'Institutional holders (13F)' })).toBeVisible();
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/study.png`, fullPage: true });
});

test('silence never looks like calm: a bar older than the last finished session is labelled stale', async ({
  page,
}) => {
  await mock(page, '2026-11-23');
  await page.goto('/study/NVDA');
  await expect(
    page.getByText('STALE: latest bar is 2026-11-23, expected 2026-11-24'),
  ).toBeVisible();
});

test('a ticker with no stored bars says so instead of showing an empty chart', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.goto('/study/RKLB');
  await expect(page.getByText(/No daily bars stored for this ticker yet/)).toBeVisible();
  await expect(page.getByText(/No company record yet/)).toBeVisible();
  await expect(page.getByText('No filings stored for this company.')).toBeVisible();
});

test('the Study list opens a company and rejects a bad ticker', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.goto('/study');
  await expect(page.getByRole('link', { name: 'NVDA' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SPY' })).toBeVisible();
  await page.getByLabel('Search a ticker or company').fill('nvda; drop');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toContainText('is not a valid ticker');
  await page.getByLabel('Search a ticker or company').fill('rklb');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/study\/RKLB$/);
});

test('search finds a company by name: one match opens it, several are listed to choose from', async ({
  page,
}) => {
  await mock(page, '2026-11-24');
  await page.goto('/study/NVDA');
  // The header search (v2) asks for the ticker or a name match in one query, and never passes the raw text through.
  await page.route('**/rest/v1/instruments**', (r) => {
    const url = decodeURIComponent(r.request().url()).replaceAll('+', ' ');
    if (url.includes('ilike."*semi*"'))
      return json(r, [
        { ticker: 'AMD', name: 'ADVANCED MICRO DEVICES INC' },
        { ticker: 'MU', name: 'MICRON TECHNOLOGY INC' },
      ]);
    if (url.includes('ilike."*Rocket Lab*"'))
      return json(r, [{ ticker: 'RKLB', name: 'ROCKET LAB CORP' }]);
    return json(r, [{ cik: '0001045810', name: 'NVIDIA CORP' }]);
  });
  const search = page.getByRole('searchbox', { name: 'Search ticker or company' });
  await search.fill('semi');
  await search.press('Enter');
  const matches = page.getByRole('navigation', { name: 'Matching companies' });
  await expect(matches.getByRole('link', { name: /AMD/ })).toBeVisible();
  await expect(matches.getByRole('link', { name: /MU/ })).toBeVisible();
  await search.fill('Rocket Lab');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/study\/RKLB$/);
});

test('the chart draws under the production Content Security Policy, with no violations', async ({
  page,
}) => {
  // The exact policy Netlify sends, read from the deployed headers file. `vite preview` does not apply it,
  // so without this a chart library that needs inline styles would pass every test and break in production.
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const policy = /Content-Security-Policy: (.+)/.exec(headers)?.[1];
  if (!policy) throw new Error('No Content-Security-Policy in public/_headers');
  const csp = policy.replaceAll('hwdwivilqdydmxhycapy.supabase.co', 'e2e-test-project.supabase.co');

  await mock(page, '2026-11-24');
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective}: ${e.blockedURI}`,
      ),
    );
  });
  await page.route(
    (url) => url.pathname.startsWith('/study'),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp },
      });
    },
  );
  await page.goto('/study/NVDA');
  const canvas = page
    .getByRole('figure', { name: /Daily candlestick chart/ })
    .locator('canvas')
    .first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(300);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('study: sections are accordions, the overview open first', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await mock(page, '2026-11-24');
    await page.goto('/study/NVDA');
    await expect(page.getByRole('heading', { level: 1, name: 'NVDA' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Thesis card' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Institutional holders (13F)' })).toHaveCount(0);
    await page.locator('summary', { hasText: 'Holders and insiders' }).click();
    await expect(page.getByRole('heading', { name: 'Institutional holders (13F)' })).toBeVisible();
    // The page never scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

test('with Tauric as the quote source, its latest price sits under the Massive close, by Marsad clock (ADR 0041)', async ({
  page,
}) => {
  await mock(page, '2026-11-24');
  await page.route('**/rest/v1/user_settings**', (r) => json(r, [{ quote_source: 'tauric' }]));
  await page.route('**/rest/v1/job_runs**', (r) => json(r, []));
  await page.route('**/rest/v1/price_quotes**', (r) =>
    json(r, [
      {
        ticker: 'NVDA',
        price: 300.4,
        change: 0.003,
        quote_kind: 'snapshot',
        price_time: '2026-11-24T21:00:00Z',
        session_date: '2026-11-24',
        fetched_at: '2026-11-24T21:05:00Z',
      },
    ]),
  );
  await page.goto('/study/NVDA');
  await expect(page.getByText('$300.00').first()).toBeVisible();
  // 20:00 ET, market closed: the quote is the last one of the session, and it is still not called live.
  await expect(page.getByTestId('latest-quote')).toHaveText(
    'Latest from Tauric $300.40 · Market closed, last value 16:00 ET',
  );
});

test('with Tauric chosen, a ticker it does not carry says so under the close (ADR 0041)', async ({
  page,
}) => {
  await mock(page, '2026-11-24');
  await page.route('**/rest/v1/user_settings**', (r) => json(r, [{ quote_source: 'tauric' }]));
  await page.route('**/rest/v1/price_quotes**', (r) => json(r, []));
  await page.route('**/rest/v1/job_runs**', (r) =>
    json(r, [{ details: { notCovered: ['NVDA'] } }]),
  );
  await page.goto('/study/NVDA');
  await expect(page.getByText('$300.00').first()).toBeVisible();
  await expect(page.getByTestId('latest-quote')).toHaveText('Tauric does not cover NVDA');
});
