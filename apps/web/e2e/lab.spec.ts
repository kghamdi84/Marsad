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
          trials: 1,
          params: { tickers: ['SPY', 'QQQ'], costs, folds: 4, holdoutFraction: 0.2 },
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
  await expect(page.getByRole('heading', { name: 'Lab', exact: true })).toBeVisible();

  // Counts by stage: 8 not testable, 1 not run, 1 draft, 1 backtested; a count filters the list.
  const counts = page.getByRole('region', { name: 'Playbooks by stage' });
  await expect(counts.getByRole('button', { name: 'Not testable 8' })).toBeVisible();
  await expect(counts.getByRole('button', { name: 'Not run 1' })).toBeVisible();
  await expect(counts.getByRole('button', { name: 'Draft 1' })).toBeVisible();
  await expect(counts.getByRole('button', { name: 'Live 0' })).toBeVisible();
  const list = page.getByRole('list', { name: '11 playbooks' });
  await expect(list.getByRole('listitem')).toHaveCount(11);
  const backtested = counts.getByRole('button', { name: 'Backtested 1' });
  await backtested.click();
  await expect(backtested).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await backtested.click();
  await expect(list.getByRole('listitem')).toHaveCount(11);

  // The first playbook is open; its detail is the region named by its title.
  await expect(
    list.getByRole('button', { name: /Index core with a trend filter/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const trend = page.getByRole('region', { name: 'Index core with a trend filter' });
  const tile = (scope: typeof trend, label: string) =>
    scope.getByText(label, { exact: true }).locator('..');
  await expect(
    trend.getByText('Playbook 1. Evidence: Moderate. Horizon: Long term. Status: Backtested.'),
  ).toBeAttached();
  // The gate is the main visual: 34 out-of-sample trades against the 30 needed.
  await expect(trend.getByText('Gate passed', { exact: true })).toBeVisible();
  await expect(trend.getByText('34 out of sample, 30 needed')).toBeVisible();
  await expect(
    trend.getByText('Out-of-sample expectancy +1.23% per trade (90% interval +0.21% to +2.34%).'),
  ).toBeVisible();
  await expect(trend.getByText('Win rate 55.9%.')).toBeVisible();
  await expect(
    trend.getByText('Maximum drawdown -12.34%; Monte Carlo worst 5% -20.11%.'),
  ).toBeVisible();
  // Costs per side (commission 5, slippage 5, currency 0 basis points), walk-forward, holdout and trials, all
  // from the stored run.
  await expect(tile(trend, 'Costs per side')).toContainText('10 bps');
  await expect(tile(trend, 'Costs per side')).toContainText('5 fee, 5 slippage, 0 FX');
  await expect(tile(trend, 'Walk-forward')).toContainText('4 folds');
  await expect(tile(trend, 'Holdout')).toContainText('Last 20%');
  await expect(tile(trend, 'Trials counted')).toContainText('1');
  await expect(trend.getByText(/entry: close crossesAbove sma\(200\)/)).toBeVisible();
  // The stored curve is drawn, with its numbers in words for screen readers.
  await expect(trend.getByText('Equity curve, out of sample')).toBeVisible();
  await expect(
    trend.getByRole('img', {
      name: 'Equity curve of 4 out-of-sample trades from 2024-02-01 to 2026-10-30: growth of 1 ends at 1.18, lowest 0.90.',
    }),
  ).toBeVisible();

  await list.getByRole('button', { name: /trend template/ }).click();
  const breakout = page.getByRole('region', { name: /trend template/ });
  // Fewer than 30 trades: no percentage at all, only "insufficient history".
  await expect(breakout.getByText('Insufficient history', { exact: true })).toBeVisible();
  await expect(breakout.getByText('4 of 30 out of sample')).toBeVisible();
  await expect(breakout.getByText(/Win rate/)).toHaveCount(0);
  // A report stored before curves existed shows none (the design's rule), and says so.
  await expect(breakout.getByText('Equity curve, out of sample')).toHaveCount(0);
  await expect(
    breakout.getByText(/Equity curve appears when the backtest report has one/),
  ).toBeVisible();
  // A run stored without the split or the trial count says "Not recorded", never a guess.
  await expect(tile(breakout, 'Walk-forward')).toContainText('Not recorded');
  await expect(tile(breakout, 'Trials counted')).toContainText('Not recorded');

  await list.getByRole('button', { name: /Dual momentum rotation/ }).click();
  const dual = page.getByRole('region', { name: 'Dual momentum rotation' });
  await expect(dual.getByText(/Needs ranking across assets/)).toBeVisible();
  await expect(page.getByText('Copying congressional trades', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lab' })).toHaveAttribute('aria-current', 'page');
});
