import { expect, test, type Locator, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// ADR 0048 navigation: every page on desktop and iPad with Settings as a gear; five phone tabs plus More.

async function empty(page: Page) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** Each link's accessible name, in order: its aria-label when it has one (the gear), else its text. */
const names = (links: Locator) =>
  links.evaluateAll((els) =>
    els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()),
  );

test('desktop and iPad: every page in order with Settings as a gear; number keys follow the order', async ({
  page,
}) => {
  await empty(page);
  await page.goto('/');
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main sections' });
  await expect(nav.getByRole('link')).toHaveCount(9);
  expect(await names(nav.getByRole('link'))).toEqual([
    'Watch',
    'Markets',
    'Study',
    'Portfolio',
    'Journal',
    'Alerts',
    'Lab',
    'Status',
    'Settings',
  ]);
  // The gear shows an icon only; its name is in the label.
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveText('');
  await nav.getByRole('link', { name: 'Portfolio' }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(nav.getByRole('link', { name: 'Portfolio' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const [key, path] of [
    ['2', /\/markets$/],
    ['3', /\/study$/],
    ['5', /\/journal$/],
    ['s', /\/status$/],
    ['9', /\/settings$/],
    ['4', /\/portfolio$/],
    ['1', /\/$/],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(path);
  }
});

test.describe('on a phone', () => {
  // Playwright reads fixtures from a destructuring pattern; this hook needs none of them.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
  });

  for (const width of [390, 320])
    test(`phone at ${width} points: five tabs and More, labels fit, targets at least 44 points`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await empty(page);
      await page.goto('/');
      const bar = page.getByRole('navigation', { name: 'Main sections' });
      await expect(bar.getByRole('link')).toHaveCount(5);
      expect(await names(bar.getByRole('link'))).toEqual([
        'Watch',
        'Study',
        'Portfolio',
        'Markets',
        'Alerts',
      ]);
      for (const el of [
        ...(await bar.getByRole('link').all()),
        bar.getByRole('button', { name: 'More' }),
      ]) {
        const box = await el.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        // The label fits its tab: nothing is clipped or spills into the next one.
        expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      }
      await bar.getByRole('link', { name: 'Portfolio' }).click();
      await expect(page).toHaveURL(/\/portfolio$/);
      await expect(page.getByRole('banner').getByText('Portfolio', { exact: true })).toBeVisible();

      await bar.getByRole('button', { name: 'More' }).click();
      const more = page.getByRole('dialog', { name: 'More' });
      await expect(more.getByRole('link')).toHaveCount(5);
      expect(await names(more.getByRole('link'))).toEqual([
        'Screener',
        'Journal',
        'Lab',
        'Status',
        'Settings',
      ]);
      await expect(more.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await more.getByRole('link', { name: 'Journal' }).click();
      await expect(page).toHaveURL(/\/journal$/);
      await expect(more).toBeHidden();
      // Journal sits under More, so More shows as the current section.
      await expect(bar.getByRole('button', { name: 'More' })).toHaveClass(/text-up/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });

  test('phone at 320 points in Arabic: the new names fit', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(() =>
      localStorage.setItem(
        'marsad.display',
        JSON.stringify({ theme: 'dark', lang: 'ar', zone: 'Asia/Riyadh' }),
      ),
    );
    await empty(page);
    await page.goto('/');
    const bar = page.getByRole('navigation', { name: 'الأقسام الرئيسية' });
    for (const name of ['المراقبة', 'الدراسة', 'المحفظة', 'الأسواق', 'التنبيهات']) {
      const link = bar.getByRole('link', { name });
      await expect(link).toBeVisible();
      expect(await link.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});
