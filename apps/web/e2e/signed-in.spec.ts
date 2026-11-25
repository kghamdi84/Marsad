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
