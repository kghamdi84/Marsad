import { expect, test } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

test('lab: playbooks with evidence, stored runs with intervals or insufficient history, and what is left out', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/rules**', (r) =>
    r.fulfill(
      json([
        { id: 'index-trend-filter', version: 1, status: 'backtested' },
        { id: 'trend-template-breakout', version: 1, status: 'draft' },
      ]),
    ),
  );
  const costs = { commissionBps: 5, slippageBps: 5, fxBps: 0 };
  await page.route('**/rest/v1/backtest_runs**', (r) =>
    r.fulfill(
      json([
        {
          rule_id: 'index-trend-filter',
          version: 1,
          created_at: '2026-11-29T06:21:00+00:00',
          params: { tickers: ['SPY', 'QQQ'], costs },
          report: {
            trades: 52,
            gate: {
              ok: true,
              reason: 'positive out-of-sample expectancy with a 90% interval above zero',
            },
            outOfSample: {
              stats: { n: 34, winRate: 0.5588, maxDrawdown: -0.1234, sufficient: true },
              expectancy: { value: 0.0123, ci90: { low: 0.0021, high: 0.0234 } },
              benchmark: { ticker: 'SPY', ret: 0.154 },
              monteCarlo: { worst5: -0.2011 },
              // Growth of 1 by exit date (synthetic, not market data): dips to 0.9, ends at 1.18.
              equity: [
                { date: '2024-02-01', equity: 1.02 },
                { date: '2024-06-03', equity: 0.9 },
                { date: '2025-01-10', equity: 1.05 },
                { date: '2026-10-30', equity: 1.18 },
              ],
            },
          },
        },
        {
          rule_id: 'trend-template-breakout',
          version: 1,
          created_at: '2026-11-29T06:21:00+00:00',
          params: { tickers: ['NVDA'], costs },
          report: {
            trades: 9,
            gate: { ok: false, reason: 'only 4 out-of-sample trades; 30 are needed' },
            outOfSample: {
              stats: { n: 4, winRate: 0.5, maxDrawdown: -0.05, sufficient: false },
              expectancy: { value: 0.01, ci90: null },
              benchmark: null,
              monteCarlo: null,
            },
          },
        },
      ]),
    ),
  );
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Backtest lab' })).toBeVisible();
  const trend = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Index core with a trend filter' }) });
  await expect(
    trend.getByText('Playbook 1. Evidence: Moderate. Horizon: Long term. Status: Backtested.'),
  ).toBeVisible();
  await expect(
    trend.getByText('Out-of-sample expectancy +1.23% per trade (90% interval +0.21% to +2.34%).'),
  ).toBeVisible();
  await expect(trend.getByText('Win rate 55.9%.')).toBeVisible();
  await expect(
    trend.getByText('Maximum drawdown -12.34%; Monte Carlo worst 5% -20.11%.'),
  ).toBeVisible();
  await expect(
    trend.getByText('Costs per side: commission 5, slippage 5, currency 0 basis points.'),
  ).toBeVisible();
  // The stored curve is drawn, with its numbers in words for screen readers.
  await expect(trend.getByText('Equity curve, out of sample')).toBeVisible();
  await expect(
    trend.getByRole('img', {
      name: 'Equity curve of 4 out-of-sample trades from 2024-02-01 to 2026-10-30: growth of 1 ends at 1.18, lowest 0.90.',
    }),
  ).toBeVisible();

  const breakout = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: /trend template/ }) });
  // Fewer than 30 trades: no percentage at all, only "insufficient history".
  await expect(
    breakout.getByText(
      'Insufficient history: 4 out-of-sample trades, 30 needed for any percentage.',
    ),
  ).toBeVisible();
  await expect(breakout.getByText(/Win rate/)).toHaveCount(0);
  // A report stored before curves existed shows none (the design's rule).
  await expect(breakout.getByText('Equity curve, out of sample')).toHaveCount(0);

  const dual = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Dual momentum rotation' }) });
  await expect(dual.getByText(/Not testable yet: Needs ranking across assets/)).toBeVisible();
  await expect(page.getByText(/Copying congressional trades\./)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lab' })).toHaveAttribute('aria-current', 'page');
});
