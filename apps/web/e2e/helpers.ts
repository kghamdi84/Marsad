import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

/**
 * WCAG 2.2 A and AA violations axe finds on what the page shows. The sticky tab bar covers whatever sits at the
 * viewport's lower edge until it is scrolled; a viewport as tall as the page puts the bar after all content, so
 * target sizes are measured as a user scrolls to them.
 */
export async function axeViolations(page: Page): Promise<string[]> {
  // Sticky bars cover whatever scrolls under them; for the scan they sit in normal flow (users can scroll any
  // target out from under the bar, so its overlap at one scroll position is not a target-size defect).
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.sticky'))
      el.style.position = 'static';
  });
  const width = page.viewportSize()?.width ?? 1280;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height: Math.min(Math.max(height, 400), 12_000) });
  // Let pending requests finish and the resized layout settle before measuring targets.
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`,
  );
}

/** After each passing test in the file, the page must have no WCAG 2.2 A or AA violations (Phase 8 pass). */
export function scanAfterEach() {
  test.afterEach(async ({ page }, info) => {
    if (info.status !== 'passed') return;
    expect(await axeViolations(page)).toEqual([]);
  });
}

/** The Study company page shows one section at a time on iPad and desktop; this opens one by its tab name. */
export async function openSection(
  page: Page,
  name: 'Overview' | 'Financials' | 'Ownership' | 'Filings and risk' | 'News',
) {
  await page.getByRole('tab', { name }).click();
}
