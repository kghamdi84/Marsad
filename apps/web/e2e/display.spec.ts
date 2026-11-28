import { expect, test } from '@playwright/test';
import { axeViolations, seedSession, scanAfterEach } from './helpers';

scanAfterEach();

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test.beforeEach(async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
});

test('settings: Daylight theme and Arabic are applied to the whole page and kept on this device', async ({
  page,
}) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page
    .getByRole('group', { name: 'Theme' })
    .getByRole('button', { name: 'Daylight' })
    .click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  // The canvas follows the token: Daylight #FAFBFD.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(250, 251, 253)');
  expect(await axeViolations(page)).toEqual([]);

  await page
    .getByRole('group', { name: 'Language' })
    .getByRole('button', { name: 'العربية' })
    .click();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1, name: 'الإعدادات' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'الأقسام الرئيسية' })
      .getByRole('link', { name: 'المراقبة' }),
  ).toBeVisible();

  // Kept after a reload, before the first paint.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('dir', 'rtl');

  // The Watch page in Daylight and Arabic passes the same accessibility scan (run after the test).
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('settings: the second time zone changes the clock label in the header', async ({ page }) => {
  await page.goto('/settings');
  await page
    .getByRole('group', { name: 'Second time zone' })
    .getByRole('button', { name: 'London' })
    .click();
  await expect(page.getByRole('banner').getByText(/London/)).toBeVisible();
});

test('every page renders in Daylight and Arabic, right to left, with no accessibility violations', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'marsad.display',
      JSON.stringify({ theme: 'light', lang: 'ar', zone: 'Asia/Riyadh' }),
    );
  });
  for (const path of [
    '/',
    '/study',
    '/study/NVDA',
    '/regime',
    '/alerts',
    '/portfolio',
    '/journal',
    '/lab',
    '/status',
    '/settings',
  ]) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // No page scrolls sideways.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    expect(await axeViolations(page), path).toEqual([]);
  }
});
