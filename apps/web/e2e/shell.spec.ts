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
  await expect(page.getByText('Open its link on this device')).toBeVisible();
  expect(body).toMatchObject({ email: 'owner@example.com', create_user: false });
  // PKCE: the request carries a code challenge, so a link only works in this browser.
  expect(body).toHaveProperty('code_challenge');
  expect(body).toMatchObject({ code_challenge_method: 's256' });
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

test('opening the emailed sign-in link exchanges it and asks for the second factor', async ({
  page,
}) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = {
    id: '00000000-0000-4000-8000-00000000000a',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.com',
    factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Marsad' }],
  };
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aal: 'aal1', exp })}.sig`;
  let exchange: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/otp**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/auth/v1/token?grant_type=pkce', async (r) => {
    exchange = r.request().postDataJSON() as Record<string, unknown>;
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: token,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        user,
      }),
    });
  });
  await page.route('**/auth/v1/user**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }),
  );
  await page.route('**/auth/v1/factors**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totp: user.factors }),
    }),
  );

  // Request the email in this browser (stores the PKCE verifier), then open the link.
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Code from the email')).toBeVisible();
  await page.goto('/?code=one-time-auth-code');

  await expect(page.getByRole('heading', { name: 'Two-factor check' })).toBeVisible();
  expect(exchange).toMatchObject({ auth_code: 'one-time-auth-code' });
  expect(exchange).toHaveProperty('code_verifier');
  expect(new URL(page.url()).searchParams.has('code')).toBe(false);
});
