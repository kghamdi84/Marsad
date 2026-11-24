import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { seedSession } from './helpers';

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
    .getByRole('img', { name: /Daily candlestick chart for NVDA, last bar 2026-11-24/ })
    .locator('canvas')
    .first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(300);

  // The 8-K is labelled in plain words with its materiality; the Form 4 shows its reporting lag.
  await expect(page.getByText('Item 5.02: Executive or director change')).toBeVisible();
  await expect(page.getByText('Item 9.01: Attached documents and exhibits')).toBeVisible();
  await expect(page.getByText('High', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Filed within two business days after the trade/)).toBeVisible();
  await expect(page.getByRole('link', { name: /View on SEC/ }).first()).toHaveAttribute(
    'href',
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/nvda-20261122.htm',
  );
  // 08:57 ET pre-market on the 23rd, so the 8-K marker sits on the 23rd's bar.
  await expect(
    page.getByText('2026-11-23: 8-K: Executive or director change (High)'),
  ).toBeVisible();

  // Anything the free plan cannot give says so, and says what it would take.
  await expect(page.getByText('Requires a higher Massive plan.').first()).toBeVisible();
  await expect(
    page.getByText('Earnings against estimates, surprise and implied move'),
  ).toBeVisible();
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
  await page.getByLabel('Open any ticker').fill('nvda; drop');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toContainText('is not a valid ticker');
  await page.getByLabel('Open any ticker').fill('rklb');
  await page.getByRole('button', { name: 'Open' }).click();
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
    .getByRole('img', { name: /Daily candlestick chart/ })
    .locator('canvas')
    .first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(300);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});
