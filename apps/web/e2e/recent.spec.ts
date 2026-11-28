import { expect, test, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

async function empty(page: Page) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test('study: recently viewed lists the companies opened on this device, newest first, above the search', async ({
  page,
}) => {
  await empty(page);
  await page.goto('/study');
  // Nothing opened yet on this device: no card.
  await expect(page.getByRole('heading', { level: 1, name: 'Study' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently viewed' })).toHaveCount(0);
  for (const tk of ['NVDA', 'RKLB', 'NVDA', 'AAPL']) {
    await page.goto(`/study/${tk}`);
    await expect(page.getByRole('heading', { level: 1, name: tk })).toBeVisible();
  }
  await page.goto('/study');
  const recent = page.getByRole('region', { name: 'Recently viewed' });
  await expect(recent.getByRole('link')).toHaveText(['AAPL', 'NVDA', 'RKLB']);
  // It sits above the search.
  const cardTop = (await recent.boundingBox())?.y ?? 0;
  const searchTop = (await page.getByLabel('Search a ticker or company').boundingBox())?.y ?? 0;
  expect(cardTop).toBeLessThan(searchTop);
  await recent.getByRole('link', { name: 'RKLB' }).click();
  await expect(page).toHaveURL(/\/study\/RKLB$/);
});

test('study: blocked storage leaves the page working, with no recently viewed card', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const block = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k: string) {
      return k === 'marsad.study.recent' ? block() : real.call(this, k);
    };
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      return k === 'marsad.study.recent' ? block() : realSet.call(this, k, v);
    };
  });
  await empty(page);
  await page.goto('/study/NVDA');
  await expect(page.getByRole('heading', { level: 1, name: 'NVDA' })).toBeVisible();
  await page.goto('/study');
  await expect(page.getByRole('heading', { level: 1, name: 'Study' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently viewed' })).toHaveCount(0);
});

test('study: "Size a trade" opens the sizer with the ticker filled in', async ({ page }) => {
  await empty(page);
  await page.goto('/study/NVDA');
  await page.getByRole('link', { name: 'Size a trade in NVDA' }).click();
  await expect(page).toHaveURL(/\/journal\?view=sizer&ticker=NVDA$/);
  await expect(page.getByRole('tab', { name: 'Sizer and Sahm ticket' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Ticker', { exact: true })).toHaveValue('NVDA');
});
