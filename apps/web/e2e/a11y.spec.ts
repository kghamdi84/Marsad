import { expect, test } from '@playwright/test';
import { axeViolations, seedSession } from './helpers';

// Phase 8 accessibility pass: every page, signed out and signed in, checked with axe against WCAG 2.2 A and AA.
// Pages render their empty states here (the API answers with no rows); the data-filled states are covered by the
// page tests' role-based selectors, which fail when a control has no accessible name.
test('sign-in screen has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
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
])
  test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await seedSession(page, 'aal2');
    await page.route('**/rest/v1/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await axeViolations(page)).toEqual([]);
  });
