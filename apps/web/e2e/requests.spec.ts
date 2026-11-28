import { expect, test, type Page } from '@playwright/test';
import { seedSession } from './helpers';
import {
  json,
  routeBars,
  routeSummary,
  summaryRow,
  syntheticSeries,
  weekdays,
  type StoredRow,
} from './summary-stubs';

/**
 * REST requests per page with a realistic book (ADR 0048 batch 4): eight watchlist names (two with a sector fund
 * chosen), three holdings, and a current nightly summary row for each. Every request to `/rest/v1/` is counted
 * until the network is idle. The bounds are the counts measured after the consumers moved onto
 * `ticker_daily_summary` (before: Watch 40 with 19 bar reads, Portfolio 15; after: 28 and 14).
 */
const WATCH = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'KO', 'PEP', 'JPM', 'XOM'];
const HELD = ['NVDA', 'KO', 'SOFI'];
const DATES = weekdays('2026-11-27', 300);
const series = (tk: string) => syntheticSeries(tk, DATES);

async function stub(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/watchlist_items**', (r) =>
    r.fulfill(
      json(
        WATCH.map((ticker, position) => ({
          ticker,
          position,
          sector_etf: ticker === 'NVDA' ? 'XLK' : ticker === 'KO' ? 'XLP' : null,
        })),
      ),
    ),
  );
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json(
        HELD.map((ticker, i) => ({
          id: i + 1,
          ticker,
          shares: 10,
          cost_basis: 50,
          opened_on: '2026-06-01',
          stop: 40,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: null,
          thesis_status: 'intact',
          horizon: 'swing',
        })),
      ),
    ),
  );
  await routeBars(page, series);
  const spy = series('SPY');
  const rows: StoredRow[] = [...new Set([...WATCH, ...HELD, 'SPY'])].map((tk) =>
    summaryRow(tk, series(tk), spy),
  );
  await routeSummary(page, rows);
  page.on('request', (rq) => {
    if (rq.url().includes('/rest/v1/'))
      seen.push(new URL(rq.url()).pathname.split('/').pop() ?? '');
  });
  return seen;
}

const count = (seen: string[]) =>
  seen.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

test('requests: Watch reads the summary once and the bars in batches', async ({ page }) => {
  const seen = await stub(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const c = count(seen);
  console.log(`Watch REST requests: ${seen.length}`, JSON.stringify(c));
  expect(c['ticker_daily_summary'] ?? 0).toBe(1);
  expect(seen.length).toBeLessThanOrEqual(28);
});

test('requests: Portfolio review', async ({ page }) => {
  const seen = await stub(page);
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const c = count(seen);
  console.log(`Portfolio REST requests: ${seen.length}`, JSON.stringify(c));
  expect(c['ticker_daily_summary'] ?? 0).toBe(1);
  expect(seen.length).toBeLessThanOrEqual(14);
});
