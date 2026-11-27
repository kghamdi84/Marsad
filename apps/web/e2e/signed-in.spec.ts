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
  await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
  // A source that never reported is not healthy: the pill counts it out.
  await expect(page.getByText('0 of 1 sources healthy')).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('FRED (St. Louis Fed)').first()).toBeVisible();
  // An alert shows its event in words, what happened and which rules it paused (behind the switch).
  await page
    .getByRole('group', { name: 'Status details' })
    .getByRole('button', { name: 'System alerts' })
    .click();
  await expect(page.getByText('Stale', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Nasdaq trade halts stale, silent for 40 min/)).toBeVisible();
  await expect(page.getByText('Paused: group:halts')).toBeVisible();
  // No heartbeat run on record: the page says stale feeds are not being watched.
  await expect(page.getByText('Heartbeat has not run yet')).toBeVisible();
  // A source that has never reported says so in words, not by an empty cell.
  await expect(page.getByText(/No data received yet/).first()).toBeVisible();
  // The summary names the source that needs a look and the latest system alert.
  const now = page.getByRole('region', { name: 'Now', exact: true });
  await expect(now).toContainText('Needs a look: FRED (St. Louis Fed) unavailable');
  await expect(now).toContainText(/2 recent \u00B7 latest stale 24 Nov 15:46 ET/);
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
  await expect(page.getByText(/ET/).first()).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/status.png` });

  await page.getByRole('link', { name: 'Regime' }).click();
  await expect(page.getByRole('heading', { name: 'Regime' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Regime' })).toHaveAttribute('aria-current', 'page');
});

test('status: a summary first; healthy sources are one short row, stale ones show their note in full', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // Wednesday 25 Nov 2026, 11:00 ET: the regular session.
  await page.clock.setFixedTime(new Date('2026-11-25T16:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  // The loaded NYSE calendar runs past today, so the session (and each source's limit) can be judged.
  await page.route('**/rest/v1/market_holidays**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-12-25',
          exchange: 'NYSE',
          name: 'Christmas Day',
          status: 'closed',
          open_at: null,
          close_at: null,
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/source_status**', (r) =>
    r.fulfill(
      json([
        {
          source: 'nasdaq_halts',
          display_name: 'Nasdaq trade halts',
          // 5 minutes ago: live (limit 30 minutes).
          last_message_at: '2026-11-25T15:55:00Z',
          last_latency_ms: 1400,
          plan_tier: 'public',
          state: 'ok',
          note: 'RSS every 5 minutes',
        },
        {
          source: 'sec_edgar',
          display_name: 'SEC EDGAR',
          // 3 hours ago: stale in the regular session (limit 2 hours).
          last_message_at: '2026-11-25T13:00:00Z',
          last_latency_ms: 300,
          plan_tier: 'public',
          state: 'ok',
          note: 'Atom feed every 30 minutes',
        },
      ]),
    ),
  );
  await page.goto('/status');
  const now = page.getByRole('region', { name: 'Now', exact: true });
  await expect(now).toContainText('1 of 2 sources healthy');
  await expect(now).toContainText('Needs a look: SEC EDGAR stale');
  const look = page.getByRole('list', { name: 'Sources that need a look' });
  await expect(look).toContainText('SEC EDGAR');
  await expect(look.getByText('Stale', { exact: true })).toBeVisible();
  await expect(look).toContainText('Atom feed every 30 minutes');
  // The healthy source is one row; its tier, latency, both clocks and note are one tap away.
  const ok = page.getByRole('list', { name: 'Healthy sources' });
  await expect(ok.getByText('Live', { exact: true })).toBeVisible();
  await expect(ok.getByText('Latency: 1,400 ms')).toBeHidden();
  await ok.getByText('Nasdaq trade halts').click();
  await expect(ok.getByText('Latency: 1,400 ms')).toBeVisible();
  await expect(ok.getByText('Plan tier: public')).toBeVisible();
  await expect(ok.getByText('Last message: 25 Nov 10:55 ET · 18:55 Riyadh')).toBeVisible();
  await expect(ok.getByText('RSS every 5 minutes')).toBeVisible();
  // A summary row opens its detail in the switchable area, and the choice is remembered.
  const details = page.getByRole('group', { name: 'Status details' });
  await expect(details.getByRole('button', { name: 'Jobs' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await now.getByRole('button', { name: /^This month/ }).click();
  await expect(details.getByRole('button', { name: 'Costs' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Costs and caps' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Job runs, last 24 hours' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Costs and caps' })).toBeVisible();
  if (process.env.SHOT_DIR) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${process.env.SHOT_DIR}/status-dark.png`, fullPage: true });
    await page.evaluate(() =>
      localStorage.setItem(
        'marsad.display',
        JSON.stringify({ theme: 'light', lang: 'en', zone: 'Asia/Riyadh' }),
      ),
    );
    await page.reload();
    await expect(page.getByRole('region', { name: 'Costs and caps' })).toBeVisible();
    await page.screenshot({ path: `${process.env.SHOT_DIR}/status-light.png`, fullPage: true });
  }
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
    await expect(page.getByRole('region', { name: 'Now', exact: true })).toContainText(
      'None recorded',
    );
    await page
      .getByRole('group', { name: 'Status details' })
      .getByRole('button', { name: 'System alerts' })
      .click();
    await expect(page.getByText('No system alerts yet')).toBeVisible();
  });
}

test('the status page says in words whether Supabase Cron is starting the jobs (ADR 0008)', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  let sched: unknown[] = [];
  const empty = (r: { fulfill: (o: object) => Promise<void> }) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  await page.route('**/rest/v1/source_status**', empty);
  await page.route('**/rest/v1/market_holidays**', empty);
  await page.route('**/rest/v1/system_alerts**', empty);
  await page.route('**/rest/v1/job_runs**', (r) =>
    r.request().url().includes('job=eq.scheduler')
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sched) })
      : empty(r),
  );
  await page.goto('/status');
  await expect(page.getByText(/Scheduler: no check recorded/)).toBeVisible();

  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  sched = [
    {
      started_at: at,
      status: 'error',
      rows_written: 0,
      error: 'halts.yml: HTTP 403 {"message":"Resource not accessible by personal access token"}',
    },
  ];
  await page.reload();
  await expect(
    page.getByText(/Scheduler error, checked 5m \d+s ago: halts\.yml: HTTP 403/),
  ).toBeVisible();

  sched = [{ started_at: at, status: 'skipped', rows_written: 0, error: 'x' }];
  await page.reload();
  await expect(page.getByText(/not in Supabase Vault as github_actions_token/)).toBeVisible();

  sched = [{ started_at: at, status: 'ok', rows_written: 6, error: null }];
  await page.reload();
  await expect(page.getByText(/GitHub accepted 6 job starts in the last window/)).toBeVisible();
});

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
  await page
    .getByRole('group', { name: 'Status details' })
    .getByRole('button', { name: 'Latency' })
    .click();
  const row = page.getByRole('row', { name: /^halt/ });
  await expect(row).toContainText('5');
  await expect(row).toContainText('3s');
  await expect(row).toContainText('8s');
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Quote source and exports' })
    .click();
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
  // Setup forms sit under Settings (council batch 2).
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Shariah and AI caps' })
    .click();
  const form = page.getByRole('form', { name: 'Shariah screening aid' });
  const toggle = form.getByRole('switch', { name: 'Shariah screening aid' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await form.getByRole('radio', { name: 'Total assets' }).click();
  await form.getByLabel('Debt limit (%)').fill('30');
  // Sections are only hidden, so an unsaved edit survives a switch.
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Display and security' })
    .click();
  await expect(form).toBeHidden();
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Shariah and AI caps' })
    .click();
  await expect(form.getByLabel('Debt limit (%)')).toHaveValue('30');
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
  const now = page.getByRole('region', { name: 'Now', exact: true });
  await expect(now).toContainText('Plans $0.00 a month \u00B7 AI off (no caps set)');
  await page
    .getByRole('group', { name: 'Status details' })
    .getByRole('button', { name: 'Costs' })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Supabase' })).toContainText('$0.00');
  await expect(
    page.getByText('AI is off: set daily and monthly caps in Settings to turn it on'),
  ).toBeVisible();
  // 90 s rounds up to 2 minutes, 2 s to 1: at least 3 minutes over 2 runs.
  await expect(page.getByText('About 3 minutes', { exact: true })).toBeVisible();
  await expect(page.getByText(/^2 runs this month/)).toBeVisible();

  caps = [{ ai_daily_cap_usd: 100, ai_monthly_cap_usd: 5, shariah_screen: false }];
  await page.reload();
  // The switch is remembered: Costs again after the reload.
  await expect(now).toContainText('AI $4.50 so far');
  // USD 4.50 of a USD 5 monthly cap is 90%: a warning.
  await expect(page.getByText(/month \$4\.50 \u00B7 2 calls/)).toBeVisible();
  await expect(page.getByText('AI spend at 90% of a cap (daily')).toBeVisible();
  // The monthly bar shows the same 90% against its 80% warning tick.
  await expect(page.getByText('AI this month against the monthly cap')).toBeVisible();
  await expect(page.getByText('90% of the cap')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Shariah and AI caps' })
    .click();
  // A settings row without stored limits falls back to the defaults, never "NaN".
  const prefs = page.getByRole('form', { name: 'Shariah screening aid' });
  await expect(prefs.getByLabel('Debt limit (%)')).toHaveValue('33');
  await expect(prefs.getByLabel('Cash and interest-bearing limit (%)')).toHaveValue('33');
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
  // Setup forms sit under Settings (council batch 2).
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Quote source and exports' })
    .click();
  const card = page.getByRole('region', { name: 'Quote source' });
  const massive = card.getByRole('radio', { name: /Massive \(default\)/ });
  const tauric = card.getByRole('radio', { name: /Tauric/ });
  await expect(massive).toBeChecked();
  await expect(tauric).not.toBeChecked();
  await expect(card).toContainText('never "Live"');
  await tauric.check();
  await expect.poll(() => saved).toEqual({ quote_source: 'tauric' });
  await expect(card.getByRole('status')).toHaveText('Quote source set to Tauric.');
  if (process.env.SHOT_DIR) {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const [name, theme, key] of [
      ['settings-dark', 'dark', 'Display and security'],
      ['settings-light', 'light', 'Notifications'],
    ] as const) {
      await page.evaluate(
        (th) =>
          localStorage.setItem(
            'marsad.display',
            JSON.stringify({ theme: th, lang: 'en', zone: 'Asia/Riyadh' }),
          ),
        theme,
      );
      await page.reload();
      await page
        .getByRole('group', { name: 'Settings sections' })
        .getByRole('button', { name: key })
        .click();
      await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
    }
  }
});
