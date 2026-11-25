import { expect, test } from '@playwright/test';
import { DEFAULT_ALERT_SETTINGS, haltAlerts, renderCard, runPipeline } from '@marsad/core';
import { seedSession } from './helpers';

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
  await page.goto('/alerts');
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: '[HALT, critical] SOFI' }) });
  await expect(card.getByText('SOFI halted: News pending')).toBeVisible();
  await expect(card.getByText('Pushed', { exact: true })).toBeVisible();
  await expect(
    card.getByText('Trading halted at 14:32 ET (22:32 local), reason T1 (News pending).'),
  ).toBeVisible();
  await expect(card.getByText('scalp n/a; swing n/a; long-term n/a.')).toBeVisible();
  await expect(card.getByText(/A halt freezes price discovery/)).toBeVisible();
  await expect(card.getByText(/End-to-end latency 30.5 s/)).toBeVisible();
  await card.getByText('Why').click();
  await expect(card.getByText('critical: pushed (bypasses quiet hours and the cap)')).toBeVisible();
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
