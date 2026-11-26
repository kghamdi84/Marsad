import { expect, test } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

test('in password mode an aal1 session opens the app (ADR 0039)', async ({ page }) => {
  await seedSession(page, 'aal1');
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Two-factor check' })).toHaveCount(0);
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
        {
          // 03:00 UTC on the 26th is 22:00 ET on the 25th (06:00 in Riyadh on the 26th).
          id: 2,
          created_at: '2026-11-26T03:00:00Z',
          event: 'recovered',
          source: 'sec_edgar',
          headline: 'SEC EDGAR recovered, 1 rules resumed',
          paused_rules: ['group:filings'],
        },
      ]),
    }),
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('sources healthy');
  await expect(page.getByText('FRED (St. Louis Fed)').first()).toBeVisible();
  // An alert shows its event in words, what happened and which rules it paused.
  await expect(page.getByText('Stale', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Nasdaq trade halts stale, silent for 40 min/)).toBeVisible();
  await expect(page.getByText('Paused: group:halts')).toBeVisible();
  // No heartbeat run on record: the page says stale feeds are not being watched.
  await expect(page.getByText('Heartbeat has not run yet')).toBeVisible();
  // A source that has never reported says so in words, not by an empty cell.
  await expect(page.getByText(/No data received yet/).first()).toBeVisible();
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
  const toggle = form.getByRole('switch', { name: 'Shariah screening aid' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await form.getByRole('radio', { name: 'Total assets' }).click();
  await form.getByLabel('Debt limit (%)').fill('30');
  await form.getByRole('button', { name: 'Save preferences' }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      shariah_screen: true,
      shariah_basis: 'assets',
      shariah_debt_max: 0.3,
      shariah_cash_max: 0.33,
      ai_daily_cap_usd: null,
      ai_monthly_cap_usd: null,
    });
  await form.getByLabel('Cash and interest-bearing limit (%)').fill('120');
  await form.getByRole('button', { name: 'Save preferences' }).click();
  await expect(form).toContainText('Limits must be above 0% and below 100%.');
});

test('costs: every plan at USD 0, AI off until caps are set, then spend against the caps with a warning', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const month = new Date().toISOString().slice(0, 7);
  let caps: unknown[] = [];
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/user_settings**', (r) => r.fulfill(json(caps)));
  await page.route('**/rest/v1/ai_usage**', (r) =>
    r.fulfill(
      json([
        { created_at: `${month}-01T08:00:00Z`, model: 'claude-sonnet-5-5', usd: 4.2 },
        { created_at: `${month}-01T09:00:00Z`, model: 'claude-haiku-5-5', usd: 0.3 },
      ]),
    ),
  );
  await page.route('**/rest/v1/job_runs**', (r) =>
    r.fulfill(
      json([
        { started_at: `${month}-01T10:00:00Z`, latency_ms: 90_000, job: 'x', status: 'ok' },
        { started_at: `${month}-01T11:00:00Z`, latency_ms: 2_000, job: 'x', status: 'ok' },
      ]),
    ),
  );
  await page.goto('/status');
  await expect(page.getByRole('listitem').filter({ hasText: 'Supabase' })).toContainText('$0.00');
  await expect(
    page.getByText('AI is off: set daily and monthly caps in Preferences to turn it on'),
  ).toBeVisible();
  // 90 s rounds up to 2 minutes, 2 s to 1: at least 3 minutes over 2 runs.
  await expect(page.getByText('about 3 minutes \u00B7 2 runs this month')).toBeVisible();

  caps = [{ ai_daily_cap_usd: 100, ai_monthly_cap_usd: 5, shariah_screen: false }];
  await page.reload();
  // USD 4.50 of a USD 5 monthly cap is 90%: a warning.
  await expect(page.getByText(/month \$4\.50 \u00B7 2 calls/)).toBeVisible();
  await expect(page.getByText('AI spend at 90% of a cap (daily')).toBeVisible();
  // The monthly bar shows the same 90% against its 80% warning tick.
  await expect(page.getByText('AI this month against the monthly cap')).toBeVisible();
  await expect(page.getByText('90% of the cap')).toBeVisible();
});

test('job runs: a 24-hour strip per job, each run a tick, errors said in words', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/job_runs**', (r) =>
    r.fulfill(
      json([
        { id: 1, job: 'bars', started_at: '2026-11-26T02:00:00Z', status: 'ok', error: null },
        {
          id: 2,
          job: 'bars',
          started_at: '2026-11-26T08:00:00Z',
          status: 'error',
          error: 'HTTP 500',
        },
        { id: 3, job: 'fred', started_at: '2026-11-26T03:00:00Z', status: 'skipped', error: null },
      ]),
    ),
  );
  await page.goto('/status');
  await expect(
    page.getByRole('img', {
      name: 'bars: 2 runs in the last 24 hours, 1 with an error, 0 skipped.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', {
      name: 'fred: 1 run in the last 24 hours, 0 with an error, 1 skipped.',
    }),
  ).toBeVisible();
  await expect(page.getByText('bars 08:00 UTC: HTTP 500')).toBeVisible();
});

test('status: the quote source is one choice of two, Massive by default, saved as soon as it is picked', async ({
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
    // Like the database: after a save, the row reads back what was saved.
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(saved ? [saved] : []),
    });
  });
  await page.goto('/status');
  const card = page.getByRole('region', { name: 'Quote source' });
  const massive = card.getByRole('radio', { name: /Massive \(default\)/ });
  const tauric = card.getByRole('radio', { name: /Tauric/ });
  await expect(massive).toBeChecked();
  await expect(tauric).not.toBeChecked();
  await expect(card).toContainText('never "Live"');
  await tauric.check();
  await expect.poll(() => saved).toEqual({ quote_source: 'tauric' });
  await expect(card.getByRole('status')).toHaveText('Quote source set to Tauric.');
});
