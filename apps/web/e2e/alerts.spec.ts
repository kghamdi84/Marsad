import { expect, test } from '@playwright/test';
import { DEFAULT_ALERT_SETTINGS, haltAlerts, renderCard, runPipeline } from '@marsad/core';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

// A halt alert built by the job's own core functions (synthetic halt, not market data).
const NOW = new Date('2026-11-25T19:35:00Z');
const [first] = haltAlerts(
  {
    symbol: 'SOFI',
    haltedAt: '2026-11-25T19:32:05Z',
    reasonCode: 'T1',
    reasonMeaning: 'News pending',
    newsRelated: true,
    resumptionTradeAt: null,
    lastSeenAt: '2026-11-25T19:34:30Z',
  },
  { regime: 'stress' },
  NOW,
);
if (!first) throw new Error('no halt alert');
const input = first;
const decision = runPipeline(input, DEFAULT_ALERT_SETTINGS, { recent: [], pushesToday: 0 }, NOW);

test('alerts: a stored halt alert as a card with its decision, reasons, latency and feedback', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  let posted: unknown = null;
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/alerts**', (r) =>
    r.fulfill(
      json([
        {
          id: '11111111-1111-4111-8111-111111111111',
          created_at: NOW.toISOString(),
          kind: 'halt',
          priority: 'critical',
          ticker: 'SOFI',
          decision: decision.decision,
          reasons: decision.reasons,
          card: renderCard(input),
          latency_ms: 30_500,
          delivery: { push: 'not-configured (Web Push arrives with Phase 5 delivery)' },
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/alert_feedback**', (r) => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON();
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    return r.fulfill(json([]));
  });
  // A push notification opens /alerts#alert-<id>: that alert is shown (ADR 0031).
  await page.goto('/alerts#alert-11111111-1111-4111-8111-111111111111');
  const row = page.locator('#alert-11111111-1111-4111-8111-111111111111');
  await expect(row.getByText('SOFI halted: News pending')).toBeVisible();
  await expect(row.getByText('Pushed', { exact: true })).toBeVisible();
  await expect(row.getByText('Critical', { exact: true })).toBeVisible();
  const card = page.getByRole('region', { name: '[HALT, critical] SOFI' });
  await expect(
    card.getByText('Trading halted at 14:32 ET (22:32 local), reason T1 (News pending).'),
  ).toBeVisible();
  await expect(card.getByText('scalp n/a; swing n/a; long-term n/a.')).toBeVisible();
  await expect(card.getByText(/A halt freezes price discovery/)).toBeVisible();
  await expect(card.getByText(/End-to-end latency 30.5 s/)).toBeVisible();
  // The pipeline's reasons are shown as chips under "Why".
  await expect(card.getByText('critical: pushed (bypasses quiet hours and the cap)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sent (1)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await card.getByRole('button', { name: 'Useful' }).click();
  await expect
    .poll(() => posted)
    .toMatchObject({ alert_id: '11111111-1111-4111-8111-111111111111', verdict: 'useful' });
});

test('alerts: before any alert exists the page says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/alerts');
  await expect(page.getByText(/No alerts yet/)).toBeVisible();
});

test('alerts: the scorecard summarizes stored outcomes per rule, live and shadow, with honest sample sizes', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  // Three live exit-stop alerts: 1-session returns +4%, -2%, +1% (mean +1.00%, 2 of 3 wins), SPY in the same
  // direction +1%, 0%, -1% (mean excess +1.00%); one shadow alert still pending.
  const alerts = [1, 2, 3, 4].map((i) => ({
    id: `0000000${i}-0000-4000-8000-000000000000`,
    created_at: '2026-11-16T22:40:00Z',
    kind: 'exit',
    ticker: 'RKLB',
    rule_id: 'exit-stop',
    rule_status: i === 4 ? 'shadow' : 'live',
    input: {},
    priority: 'high',
    decision: 'digest',
    reasons: [],
    card: [],
    latency_ms: null,
    delivery: {},
  }));
  const done = (i: number, ret: number, bench: number) => ({
    alert_id: `0000000${i}-0000-4000-8000-000000000000`,
    horizon: '1d',
    status: 'done',
    note: null,
    ref_date: '2026-11-16',
    end_date: '2026-11-17',
    ret,
    bench_ret: bench,
    excess: ret - bench,
    mfe: Math.max(ret, 0) + 0.01,
    mae: Math.min(ret, 0) - 0.01,
    hit: null,
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/alerts**', (r) => r.fulfill(json(alerts)));
  await page.route('**/rest/v1/alert_outcomes**', (r) =>
    r.fulfill(
      json([
        done(1, 0.04, 0.01),
        done(2, -0.02, 0),
        done(3, 0.01, -0.01),
        {
          ...done(4, 0, 0),
          status: 'pending',
          ret: null,
          bench_ret: null,
          excess: null,
          mfe: null,
          mae: null,
          end_date: null,
        },
      ]),
    ),
  );
  await page.goto('/alerts');
  const card = page.getByRole('region', { name: 'Scorecard' });
  const row = card.getByRole('row', { name: /^exit-stop \(live\)/ });
  await expect(row).toContainText('66.7% (insufficient history)');
  await expect(row).toContainText('▲ +1.00%'); // mean return and mean excess
  await expect(card.getByRole('row', { name: /shadow/ })).toHaveCount(0); // pending outcomes are not scored
  await expect(card).toContainText('1 outcome is still waiting for its sessions.');
  await expect(card).toContainText(
    'Not enough scored alerts carry a quality score yet (30 needed).',
  );
});

test('catalyst scenarios: a written scenario is listed; saving needs a trigger and a plan', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  let posted: unknown = null;
  const stored = [
    {
      id: 7,
      name: 'NVDA CEO returns',
      tickers: ['NVDA'],
      keywords: ['ceo'],
      eight_k_items: ['5.02'],
      form4_codes: [],
      news_min_tier: 2,
      halts: false,
      move_pct: null,
      volume_ratio: null,
      plan_entry: 'Watch for a first range break that holds VWAP.',
      chase_guard_pct: 0.1,
      plan_invalidation: 'Below the pre-market low.',
      plan_size: 'half',
      expires_on: '2026-12-31',
      active: true,
    },
  ];
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/catalyst_scenarios**', (r) => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON();
      return r.fulfill({ status: 201, body: '' });
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stored),
    });
  });
  await page.goto('/alerts');
  const section = page.getByRole('region', { name: 'Catalyst scenarios' });
  const item = section.getByRole('listitem').filter({ hasText: 'NVDA CEO returns' });
  await expect(item).toContainText('Triggers: 8-K item 5.02; news at tier 2 or better.');
  await expect(item).toContainText('No entry beyond a 10.0% move.');
  await expect(item).toContainText('Active, expires 2026-12-31.');

  const form = section.getByRole('form', { name: 'Write a scenario' });
  await form.getByLabel('Name').fill('SOFI charter news');
  await form.getByLabel('Tickers (separate with commas)').fill('sofi');
  await form.getByLabel('Planned entry').fill('Only on a retest.');
  await form.getByLabel('Invalidation').fill('Close below the gap.');
  await form.getByLabel('Expires (YYYY-MM-DD)').fill('2027-01-31');
  await form.getByRole('button', { name: 'Save scenario' }).click();
  await expect(form.getByRole('alert')).toContainText('at least one trigger');
  expect(posted).toBeNull();
  await form.getByLabel('8-K items (commas, for example 5.02)').fill('8.01, 1.01');
  await form.getByRole('button', { name: 'Save scenario' }).click();
  await expect
    .poll(() => posted)
    .toMatchObject({
      name: 'SOFI charter news',
      tickers: ['SOFI'],
      eight_k_items: ['8.01', '1.01'],
      chase_guard_pct: 0.1,
      expires_on: '2027-01-31',
    });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('alerts: tapping an alert opens its full card in a sheet', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await seedSession(page, 'aal2');
    const json = (body: unknown) => ({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
    await page.route('**/rest/v1/alerts**', (r) =>
      r.fulfill(
        json([
          {
            id: '22222222-2222-4222-8222-222222222222',
            created_at: NOW.toISOString(),
            kind: 'halt',
            priority: 'critical',
            ticker: 'SOFI',
            decision: decision.decision,
            reasons: decision.reasons,
            card: renderCard(input),
            latency_ms: 30_500,
            delivery: { push: 'sent' },
          },
        ]),
      ),
    );
    await page.goto('/alerts');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('#alert-22222222-2222-4222-8222-222222222222').getByRole('button').click();
    const sheet = page.getByRole('dialog', { name: '[HALT, critical] SOFI' });
    await expect(sheet.getByText(/A halt freezes price discovery/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Useful' })).toBeVisible();
    // The page never scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
