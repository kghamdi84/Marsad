import { expect, test, type Page } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

// An iPhone-sized screen (390 by 844 points): under the 760 px breakpoint the phone shell takes over.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
// Playwright reads fixtures from a destructuring pattern; this hook needs none of them.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'One phone run is enough; the viewport is set here.');
});

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** Thanksgiving is in the calendar; the halts feed last spoke at 14:00 UTC (its limit is 30 minutes). */
async function mock(page: Page, at: string) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date(at));
  let pulses = 0;
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/market_holidays**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-11-26',
          exchange: 'NYSE',
          name: 'Thanksgiving Day',
          status: 'closed',
          open_at: null,
          close_at: null,
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/source_status**', (r) => {
    pulses += 1;
    return r.fulfill(
      json([
        {
          source: 'nasdaq_halts',
          display_name: 'Nasdaq trade halts',
          last_message_at: '2026-11-24T14:00:00+00:00',
        },
      ]),
    );
  });
  return () => pulses;
}

test('phone: bottom tab bar, page title and the More sheet', async ({ page }) => {
  await mock(page, '2026-11-24T15:00:00Z');
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Main sections' });
  for (const name of ['Watch', 'Study', 'Portfolio', 'Markets', 'Alerts'])
    await expect(bar.getByRole('link', { name })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Watch' })).toHaveAttribute('aria-current', 'page');
  // Journal, Lab, Status and Settings live under More on a phone (ADR 0048).
  await expect(page.getByRole('link', { name: 'Lab', exact: true })).toHaveCount(0);

  await bar.getByRole('link', { name: 'Markets' }).click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect(bar.getByRole('link', { name: 'Markets' })).toHaveAttribute('aria-current', 'page');

  await bar.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await expect(more).toBeVisible();
  await expect(more.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();

  await bar.getByRole('button', { name: 'More' }).click();
  await more.getByRole('link', { name: 'Lab' }).click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(more).toBeHidden();
  await expect(bar.getByRole('button', { name: 'More' })).toBeVisible();
});

test('phone: the market chip and freshness say the session and the stale source in words', async ({
  page,
}) => {
  // Tuesday 10:00 ET: the regular session; the halts feed has been silent for an hour.
  await mock(page, '2026-11-24T15:00:00Z');
  await page.goto('/');
  const chip = page.getByRole('button', { name: /^Open\. 1 stale\./ }).first();
  await expect(chip).toBeVisible();
  await expect(page.getByRole('banner').getByText('1 stale')).toBeVisible();
  await chip.click();
  const sheet = page.getByRole('dialog', { name: 'Market and data' });
  await expect(sheet.getByText('Nasdaq trade halts')).toBeVisible();
  await expect(sheet.getByText('New York (ET)')).toBeVisible();
  await expect(sheet.getByText('10:00', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('phone: on a holiday the chip names it', async ({ page }) => {
  await mock(page, '2026-11-26T15:00:00Z');
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /^Closed, Thanksgiving Day\./ }).first(),
  ).toBeVisible();
});

test('phone: pulling down from the top refetches the page and says when', async ({ page }) => {
  const pulses = await mock(page, '2026-11-24T15:00:00Z');
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('1 stale')).toBeVisible();
  const before = pulses();
  await page.evaluate(() => {
    const fire = (type: string, y: number) => {
      const touch = new Touch({ identifier: 1, target: document.body, clientX: 150, clientY: y });
      document.body.dispatchEvent(
        new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
          bubbles: true,
        }),
      );
    };
    fire('touchstart', 120);
    fire('touchmove', 160);
    fire('touchmove', 240);
    fire('touchend', 240);
  });
  await expect(page.getByRole('status').filter({ hasText: /Updated 10:00 ET/ })).toBeVisible();
  expect(pulses()).toBeGreaterThan(before);
});
