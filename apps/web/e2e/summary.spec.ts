import { expect, test, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';
import {
  json,
  routeBars,
  routeSummary,
  summaryRow,
  syntheticSeries,
  weekdays,
  type StoredRow,
} from './summary-stubs';

scanAfterEach();

/**
 * Watch, the quick look and Portfolio read the nightly summary (ADR 0050) when its row is current and compute
 * from bars otherwise, saying which. The stored rows below carry figures the bars would not give (a 1-week return
 * of +12.34%, a Tauric results date), so a page that shows them read the row.
 */
const DATES = weekdays('2026-11-27', 300);
const series = (tk: string) => syntheticSeries(tk, DATES);
const spy = series('SPY');

async function stub(page: Page, rows: StoredRow[]) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/watchlist_items**', (r) =>
    r.fulfill(
      json([
        { ticker: 'NVDA', position: 0, sector_etf: null },
        { ticker: 'KO', position: 1, sector_etf: 'XLP' },
        { ticker: 'AMD', position: 2, sector_etf: null },
      ]),
    ),
  );
  await routeBars(page, series);
  await routeSummary(page, rows);
}

const nvda = () =>
  summaryRow('NVDA', series('NVDA'), spy, {
    return_1w: 0.1234,
    next_earnings_date: '2026-12-03',
    next_earnings_source: 'tauric',
    sector_etf: 'XLK',
    avg_dollar_volume_20: 4_560_000_000,
  });
// KO's row is a session behind its newest bar, so Watch computes KO from bars; AMD has no row at all.
const koStale = () =>
  summaryRow('KO', series('KO').slice(0, -1), spy, {
    next_earnings_date: '2027-02-10',
    next_earnings_source: 'marsad-estimate',
  });

test('summary: Watch rows read the nightly row and name the tickers computed from bars', async ({
  page,
}) => {
  await stub(page, [nvda(), koStale(), summaryRow('SPY', spy, spy)]);
  await page.goto('/');
  const card = page.locator('#watchlist-h').locator('xpath=ancestor::section[1]');
  await page
    .getByRole('group', { name: 'Change period' })
    .getByRole('button', { name: '5D' })
    .click();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'NVDA' }) });
  // The stored 1-week return, not the bars' own.
  await expect(row).toContainText('▲ +12.3%');
  // Days to the next results date, with its source: 28 Nov to 3 Dec is 5 days.
  await expect(row).toContainText('In 5 days');
  await expect(row).toContainText('03 Dec · Tauric date');
  await expect(card).toContainText('from the nightly summary, 27 Nov (written 11:25 UTC)');
  await expect(card).toContainText('Computed from bars, no current nightly summary row: KO, AMD.');
  // The sector fund: GICS from the summary unless the viewer chose one.
  await page.getByRole('button', { name: 'Show trader columns' }).click();
  await expect(row).toContainText('XLK, GICS');
  const ko = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'KO' }) });
  await expect(ko).toContainText('XLP, your choice');
  // A row behind the bars is not used, its results date included; KO has no estimate stored either.
  await expect(ko).toContainText('No date');
});

const holding = (id: number, ticker: string) => ({
  id,
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
});

test('summary: Portfolio columns and the quick look read the nightly row', async ({ page }) => {
  await stub(page, [nvda(), summaryRow('SPY', spy, spy)]);
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(json([holding(1, 'NVDA'), holding(2, 'AMD')])),
  );
  await page.goto('/portfolio?view=holdings');
  await page
    .getByRole('group', { name: 'Columns' })
    .getByRole('button', { name: 'Performance' })
    .click();
  const table = page.getByRole('region', { name: 'Holdings table, Performance columns' });
  await expect(table.getByRole('row').filter({ hasText: 'NVDA' })).toContainText('▲ +12.3%');
  await expect(
    page.getByText('From the nightly summary (ticker-summary-1), session 27 Nov.'),
  ).toBeVisible();
  await expect(
    page.getByText('Computed from bars, no current nightly summary row: AMD.'),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Columns' })
    .getByRole('button', { name: 'Earnings' })
    .click();
  const earnings = page.getByRole('region', { name: 'Holdings table, Earnings columns' });
  await expect(earnings.getByRole('row').filter({ hasText: 'NVDA' })).toContainText(
    'Tauric calendar',
  );

  await page.getByRole('button', { name: 'NVDA, quick look' }).first().click();
  const panel = page.getByRole('dialog', { name: 'NVDA' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('52-week range, by close');
  await expect(panel).toContainText('Dollar volume, 1 day');
  await expect(panel).toContainText('Dollar volume, 20-day average');
  await expect(panel).toContainText('$4.6B');
  await expect(panel).toContainText('From the nightly summary, 27 Nov (written 11:25 UTC).');
});
