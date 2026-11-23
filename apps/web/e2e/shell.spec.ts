import { expect, test } from '@playwright/test';

test('signed-out visitors see only the sign-in screen', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Sign in to Marsad' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('sending a code never asks Supabase to create a user', async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/otp**', async (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Code from the email')).toBeVisible();
  expect(body).toMatchObject({ email: 'owner@example.com', create_user: false });
});

test('a rejected code shows the error text', async ({ page }) => {
  await page.route('**/auth/v1/otp**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/auth/v1/verify**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 403,
        error_code: 'otp_expired',
        msg: 'Token has expired or is invalid',
      }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code from the email').fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
});
