import type { Page } from '@playwright/test';

// A locally forged session. The app decodes the token's aal claim to decide
// what to show; the database enforces the real check (see supabase/tests).
function b64url(o: object) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

export async function seedSession(page: Page, aal: 'aal1' | 'aal2') {
  // Three days: a test may freeze the browser clock hours ahead, and the token must still look valid.
  const exp = Math.floor(Date.now() / 1000) + 3 * 86400;
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
