import { expect, test } from '@playwright/test';
import { scanAfterEach } from './helpers';

scanAfterEach();

test('signed-out visitors see only the sign-in screen', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('requesting a sign-in link never asks Supabase to create a user', async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/otp**', async (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Email me a link', exact: true }).click();
  await expect(page.getByLabel('Link or code')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your email', level: 1 })).toBeVisible();
  expect(body).toMatchObject({ email: 'owner@example.com', create_user: false });
  // Implicit flow: no code challenge, so the link works in whichever browser opens it.
  expect(body).toMatchObject({ code_challenge: null });
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
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Email me a link', exact: true }).click();
  await page.getByLabel('Link or code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
});

const linkUser = {
  id: '00000000-0000-4000-8000-00000000000a',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.com',
  factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Marsad' }],
};

function aal1Token() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return {
    exp,
    token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: linkUser.id, role: 'authenticated', aal: 'aal1', exp })}.sig`,
  };
}

async function mockUserAndFactors(page: import('@playwright/test').Page) {
  await page.route('**/auth/v1/user**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(linkUser) }),
  );
  await page.route('**/auth/v1/factors**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totp: linkUser.factors }),
    }),
  );
}

test('opening the emailed link in any browser signs in (password mode: no second factor, ADR 0039)', async ({
  page,
}) => {
  const { token, exp } = aal1Token();
  await mockUserAndFactors(page);
  // A fresh browser that never asked for the email (as when the mail app opens Safari).
  await page.goto(
    `/#access_token=${token}&expires_at=${exp}&expires_in=3600&refresh_token=r&token_type=bearer&type=magiclink`,
  );
  await expect(page.getByRole('navigation').first()).toBeVisible();
  // The tokens are removed from the address bar.
  expect(new URL(page.url()).hash).toBe('');
});

test('pasting the copied sign-in link verifies its token here', async ({ page }) => {
  const { token, exp } = aal1Token();
  let verifyBody: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/otp**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/auth/v1/verify**', async (r) => {
    verifyBody = r.request().postDataJSON() as Record<string, unknown>;
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: token,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        user: linkUser,
      }),
    });
  });
  await mockUserAndFactors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Email me a link', exact: true }).click();
  await page
    .getByLabel('Link or code')
    .fill(
      'https://e2e-test-project.supabase.co/auth/v1/verify?token=abc123hash&type=magiclink&redirect_to=https://marsad-k84.netlify.app/',
    );
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  expect(verifyBody).toMatchObject({ token_hash: 'abc123hash', type: 'magiclink' });
});

test('pasting something else says so without calling Supabase', async ({ page }) => {
  let verifyCalls = 0;
  await page.route('**/auth/v1/otp**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/auth/v1/verify**', (r) => {
    verifyCalls += 1;
    return r.fulfill({ status: 500, body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Email me a link', exact: true }).click();
  await page.getByLabel('Link or code').fill('https://example.com/not-the-link');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('Paste the whole link or the 6-digit code.');
  expect(verifyCalls).toBe(0);
});

test('a failed link shows its reason on the sign-in screen', async ({ page }) => {
  await page.goto(
    '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );
  await expect(page.getByRole('alert')).toContainText('Email link is invalid or has expired');
  await expect(page.getByRole('alert')).toContainText('Request a new one');
});

test('signing in with email and password posts the password grant and opens the app', async ({
  page,
}) => {
  const { token, exp } = aal1Token();
  let grant: string | null = null;
  let body: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/token**', async (r) => {
    grant = new URL(r.request().url()).searchParams.get('grant_type');
    body = r.request().postDataJSON() as Record<string, unknown>;
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: token,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        user: linkUser,
      }),
    });
  });
  await mockUserAndFactors(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  expect(grant).toBe('password');
  expect(body).toMatchObject({ email: 'owner@example.com', password: 'correct horse battery' });
});

test('a wrong password says how to set a new one', async ({ page }) => {
  await page.route('**/auth/v1/token**', (r) =>
    r.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 400,
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Set password workflow');
});

test('a friend creates an account with email and password and lands in the app (ADR 0040)', async ({
  page,
}) => {
  const { token, exp } = aal1Token();
  let body: Record<string, unknown> | null = null;
  await page.route('**/auth/v1/signup**', async (r) => {
    body = r.request().postDataJSON() as Record<string, unknown>;
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: token,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: exp,
        user: { ...linkUser, factors: [] },
      }),
    });
  });
  await mockUserAndFactors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill('friend@example.com');
  await page.getByLabel('Password, at least 10 characters').fill('short');
  await page.getByLabel('Password again').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('Use at least 10 characters.');
  expect(body).toBeNull();
  await page.getByLabel('Password, at least 10 characters').fill('a long password');
  await page.getByLabel('Password again').fill('a long passwrd');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('The two passwords differ.');
  await page.getByLabel('Password again').fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  expect(body).toMatchObject({ email: 'friend@example.com', password: 'a long password' });
});

test('creating an account with an email that exists says to sign in instead', async ({ page }) => {
  await page.route('**/auth/v1/signup**', (r) =>
    r.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 422,
        error_code: 'user_already_exists',
        msg: 'User already registered',
      }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password, at least 10 characters').fill('a long password');
  await page.getByLabel('Password again').fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
});

test('the sign-in copy and errors match the design (Sign in, Create an account, link steps)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('New here? Friends of the owner can join as members.')).toBeVisible();
  await expect(
    page.getByText('Not investment advice. Prices are end of day unless marked Live.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter your email.');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter your password.');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create an account', level: 1 })).toBeVisible();
  await expect(
    page.getByText(
      'Members see Watch, Study and Regime. Alerts, briefs and the journal stay with the owner.',
    ),
  ).toBeVisible();
  await page.getByLabel('Password, at least 10 characters').fill('abcdef');
  await expect(page.getByRole('img', { name: '6 of 10 characters' })).toBeVisible();
  await page.getByRole('button', { name: 'I already have an account' }).click();
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await expect(page.getByRole('heading', { name: 'Get a sign-in link', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Only existing accounts get a link. New accounts need a password.').first(),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Use my password' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
});

test('a sign-in service that does not answer shows the Unavailable banner', async ({ page }) => {
  await page.route('**/auth/v1/token**', (r) => r.abort('failed'));
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unavailable');
  await expect(page.getByRole('alert')).toContainText('Sign-in service is not responding.');
});
