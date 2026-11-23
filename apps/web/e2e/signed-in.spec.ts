import { expect, test, type Page } from '@playwright/test';

// A locally forged session. The app decodes the token's aal claim to decide
// what to show; the database enforces the real check (see supabase/tests).
function b64url(o: object) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

async function seedSession(page: Page, aal: 'aal1' | 'aal2') {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: '00000000-0000-4000-8000-00000000000a',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.com',
    factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Marsad' }],
  };
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: user.id,
    role: 'authenticated',
    aal,
    amr: [{ method: 'otp', timestamp: exp - 3600 }],
    exp,
  })}.sig`;
  const session = {
    access_token: token,
    refresh_token: 'r',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript((s) => {
    localStorage.setItem('sb-e2e-test-project-auth-token', s);
  }, JSON.stringify(session));
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
}

test('an aal1 session is sent to the two-factor check', async ({ page }) => {
  await seedSession(page, 'aal1');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Two-factor check' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('an aal2 session sees the shell and the status page', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/source_status**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          source: 'fred',
          display_name: 'FRED (St. Louis Fed)',
          last_message_at: null,
          last_latency_ms: null,
          plan_tier: 'unknown',
          state: 'unknown',
          note: 'Adapter arrives in Phase 1',
        },
      ]),
    }),
  );
  await page.route('**/rest/v1/job_runs**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'FRED (St. Louis Fed)' })).toBeVisible();
  await expect(page.getByText('No jobs have run yet')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
  await expect(page.getByText(/ET/).first()).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/status.png` });

  await page.getByRole('link', { name: 'Regime' }).click();
  await expect(page.getByRole('heading', { name: 'Regime' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Regime' })).toHaveAttribute('aria-current', 'page');
});
