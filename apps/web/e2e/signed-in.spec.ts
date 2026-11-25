import { expect, test } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

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
  await page.route('**/rest/v1/market_holidays**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/system_alerts**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          created_at: '2026-11-24T20:46:00Z',
          event: 'stale',
          source: 'nasdaq_halts',
          headline: 'Nasdaq trade halts stale, silent for 40 min, regular session',
          paused_rules: ['group:halts'],
        },
      ]),
    }),
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'FRED (St. Louis Fed)' })).toBeVisible();
  // An alert shows its event in words, what happened and which rules it paused.
  await expect(page.getByRole('cell', { name: 'STALE', exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /Nasdaq trade halts stale, silent for 40 min/ }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'group:halts' })).toBeVisible();
  // No heartbeat run on record: the page says stale feeds are not being watched.
  await expect(page.getByText('Heartbeat has not run yet')).toBeVisible();
  // A source that has never reported says so in words, not by an empty cell.
  await expect(page.getByRole('cell', { name: 'No data received yet' })).toBeVisible();
  await expect(page.getByText('No jobs have run yet')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
  await expect(page.getByText(/ET/).first()).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/status.png` });

  await page.getByRole('link', { name: 'Regime' }).click();
  await expect(page.getByRole('heading', { name: 'Regime' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Regime' })).toHaveAttribute('aria-current', 'page');
});

// The heartbeat line on the status page: ran recently, ran late, or never ran.
for (const [name, minutesAgo, expected] of [
  ['recently', 10, /Heartbeat last ran 10m \d+s ago\.$/],
  ['too long ago', 300, /Heartbeat last ran .* ago\. Stale feeds may be going unreported\./],
] as const) {
  test(`the status page reports a heartbeat that ran ${name}`, async ({ page }) => {
    await seedSession(page, 'aal2');
    const startedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const empty = (r: { fulfill: (o: object) => Promise<void> }) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    await page.route('**/rest/v1/source_status**', empty);
    await page.route('**/rest/v1/market_holidays**', empty);
    await page.route('**/rest/v1/system_alerts**', empty);
    await page.route('**/rest/v1/job_runs**', (r) =>
      r.request().url().includes('job=eq.health-check')
        ? r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ started_at: startedAt }]),
          })
        : empty(r),
    );
    await page.goto('/status');
    await expect(page.getByText(expected)).toBeVisible();
    await expect(page.getByText('No system alerts yet')).toBeVisible();
  });
}

test('the status page shows alert latency by kind and lets the owner save a weekly export', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const OWNER = '00000000-0000-4000-8000-00000000000a';
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  // Halt alerts: 1, 2, 3, 4 and 10 seconds: median 3 s; 90th percentile 4 + 0.6 x 6 = 7.6 s, shown as 8s.
  await page.route('**/rest/v1/alerts**', (r) =>
    r.fulfill(
      json([1000, 2000, 3000, 4000, 10000].map((latency_ms) => ({ kind: 'halt', latency_ms }))),
    ),
  );
  const listed: string[] = [];
  await page.route('**/storage/v1/object/list/exports', (r) => {
    const prefix = (r.request().postDataJSON() as { prefix: string }).prefix;
    listed.push(prefix);
    return r.fulfill(
      json(
        prefix === OWNER
          ? [{ name: '2026-11-29' }]
          : [{ name: 'manifest.json' }, { name: 'trades.json' }],
      ),
    );
  });
  await page.route('**/storage/v1/object/exports/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":1}]' }),
  );
  await page.goto('/status');
  const row = page.getByRole('row', { name: /^halt/ });
  await expect(row).toContainText('5');
  await expect(row).toContainText('3s');
  await expect(row).toContainText('8s');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '2026-11-29: trades.json' }).click();
  expect((await download).suggestedFilename()).toBe('marsad-2026-11-29-trades.json');
  expect(listed).toEqual([OWNER, `${OWNER}/2026-11-29`]);
});

test('preferences: the Shariah aid is off until switched on; limits are saved as fractions', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  let saved: unknown = null;
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/user_settings**', (r) => {
    if (r.request().method() === 'POST') {
      saved = r.request().postDataJSON();
      return r.fulfill({ status: 201, body: '' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/status');
  const form = page.getByRole('form', { name: 'Preferences' });
  const toggle = form.getByLabel('Show the Shariah screening aid on company pages');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await form.getByLabel('Divide debt and cash by').selectOption('assets');
  await form.getByLabel('Debt limit (%)').fill('30');
  await form.getByRole('button', { name: 'Save preferences' }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      shariah_screen: true,
      shariah_basis: 'assets',
      shariah_debt_max: 0.3,
      shariah_cash_max: 0.33,
    });
  await form.getByLabel('Cash limit (%)').fill('120');
  await form.getByRole('button', { name: 'Save preferences' }).click();
  await expect(form).toContainText('Limits must be above 0% and below 100%.');
});
