import { expect, test, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// ADR 0048: every view has a URL. `?view=` wins over the choice remembered on the device, and switching a view
// rewrites the URL in place (replace, not a new history entry), so alerts, briefs and friends can link to a view.

async function empty(page: Page) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** Remembers a view on the device before the page loads, to show the URL wins over it. */
async function remember(page: Page, key: string, value: string) {
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [key, value],
  );
}

test('study: ?view= opens that view over the remembered one, and a tap rewrites the URL in place', async ({
  page,
}) => {
  await empty(page);
  await remember(page, 'marsad.study.section', 'news');
  await page.goto('/study');
  await page.goto('/study/NVDA?view=analysts');
  await expect(page.getByRole('tab', { name: 'Analysts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Earnings', exact: true }).click();
  await expect(page).toHaveURL(/\/study\/NVDA\?view=earnings$/);
  // Replace, not push: Back leaves the company page instead of stepping through views.
  await page.goBack();
  await expect(page).toHaveURL(/\/study$/);
});

test('study: an unknown view falls back to the remembered one', async ({ page }) => {
  await empty(page);
  await remember(page, 'marsad.study.section', 'news');
  await page.goto('/study/NVDA?view=nonsense');
  await expect(page.getByRole('tab', { name: 'News', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('settings and status: ?view= picks the section, the switch writes it back', async ({
  page,
}) => {
  await empty(page);
  await page.goto('/settings?view=data');
  await expect(
    page
      .getByRole('group', { name: 'Settings sections' })
      .getByRole('button', { name: 'Quote source and exports' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Notifications' })
    .click();
  await expect(page).toHaveURL(/\/settings\?view=notifications$/);

  await page.goto('/status?view=costs');
  await expect(
    page.getByRole('group', { name: 'Status details' }).getByRole('button', { name: 'Costs' }),
  ).toHaveAttribute('aria-pressed', 'true');
});
