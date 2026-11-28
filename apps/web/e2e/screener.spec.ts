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
 * The screener (core `screener-1`) over stored summary rows. Four tracked rows, figures set by hand:
 * - NVDA: volume 3.0 times its average, 95% of its 52-week range, above its 200-day average;
 * - KO: volume 2.5 times, 40% of the range, below the 200-day;
 * - AMD: volume 1.2 times, above the 200-day;
 * - NEW: no volume ratio and no 200-day average (too little history).
 */
const DATES = weekdays('2026-11-27', 300);
const series = (tk: string) => syntheticSeries(tk, DATES);
const spy = series('SPY');
const row = (tk: string, over: Partial<StoredRow>) => summaryRow(tk, series(tk), spy, over);
const ROWS = [
  row('NVDA', { volume_ratio_20: 3, range_position_52w: 0.95, above_sma_200: true }),
  row('KO', { volume_ratio_20: 2.5, range_position_52w: 0.4, above_sma_200: false }),
  row('AMD', { volume_ratio_20: 1.2, range_position_52w: 0.7, above_sma_200: true }),
  row('NEW', {
    volume_ratio_20: null,
    range_position_52w: null,
    above_sma_200: null,
    unavailable: { volume_ratio_20: 'fewer than 21 bars' },
  }),
];

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await routeBars(page, series);
  await routeSummary(page, ROWS);
}

test('screener: a preset filters, counts what is missing, and lives in the address', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/screener');
  await expect(page.getByRole('heading', { name: 'Screener', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Tracked tickers only: holdings, watchlists, sector funds'),
  ).toBeVisible();
  await expect(page.getByText('No filters: every row is shown.')).toBeVisible();
  const results = page.getByRole('region', { name: 'Screen results' });
  await expect(results.getByRole('row')).toHaveCount(5);

  await page
    .getByRole('group', { name: 'Presets' })
    .getByRole('button', { name: 'Volume at least 2 times its 20-day average' })
    .click();
  await expect(page).toHaveURL(/f=volume_ratio_20%3Agte%3A2/);
  await expect(page).toHaveURL(/s=volume_ratio_20%3Adesc/);
  // Sorted by the ratio, highest first; each row says why it matched.
  const body = results.locator('tbody tr');
  await expect(body).toHaveCount(2);
  await expect(body.nth(0)).toContainText('NVDA');
  await expect(body.nth(0)).toContainText('Volume against 20-day average at least 2.0× (3.0×)');
  await expect(body.nth(1)).toContainText('KO');
  await expect(
    page.getByText('2 of 4 match · 1 failed a condition · 1 left out for missing data'),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Left out for missing data, by figure' }),
  ).toContainText('Volume against 20-day average: 1');
  await expect(
    page.getByText('Formula screener-1 over ticker-summary-1 rows.', { exact: false }),
  ).toBeVisible();

  // The address alone rebuilds the screen: two conditions, the second a boolean.
  await page.goto('/screener?f=range_position_52w:gte:0.6,above_sma_200:eq:true&s=ticker:asc');
  await expect(body).toHaveCount(2);
  await expect(body.nth(0)).toContainText('AMD');
  await expect(body.nth(1)).toContainText('NVDA');
  await expect(page.getByLabel('Value, in percent')).toHaveValue('60');

  // A filter the screener cannot run is dropped and said so, never guessed.
  await page.goto('/screener?f=rsi_14:gte:abc');
  await expect(
    page.getByText('A filter in the link was ignored: rsi_14 gte needs a number.'),
  ).toBeVisible();

  // A row opens the quick look.
  await page.goto('/screener');
  await results.getByRole('button', { name: 'KO, quick look' }).click();
  await expect(page.getByRole('dialog', { name: 'KO' })).toBeVisible();
});

test('screener: editing a filter updates the results and the link', async ({ page }) => {
  await stub(page);
  await page.goto('/screener');
  await page.getByRole('button', { name: 'Add a filter' }).click();
  const field = page.getByRole('combobox', { name: 'Figure' });
  await field.selectOption('range_position_52w');
  await page.getByRole('combobox', { name: 'Condition' }).selectOption('gte');
  await page.getByLabel('Value, in percent').fill('90');
  await expect(page).toHaveURL(/f=range_position_52w%3Agte%3A0.9/);
  const body = page.getByRole('region', { name: 'Screen results' }).locator('tbody tr');
  await expect(body).toHaveCount(1);
  await expect(body.nth(0)).toContainText('NVDA');
  await expect(body.nth(0)).toContainText('95.0%');
  await page
    .getByRole('button', { name: 'Remove the Position in the 52-week range filter' })
    .click();
  await expect(body).toHaveCount(4);
});

test('screener: Markets links to it on desktop and iPad', async ({ page }) => {
  await stub(page);
  await page.goto('/markets');
  await page.getByRole('link', { name: 'Open the screener' }).click();
  await expect(page).toHaveURL(/\/screener$/);
});
