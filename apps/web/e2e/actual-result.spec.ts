import { expect, test, type Page } from '@playwright/test';
import { PORTFOLIO_RETURN_METHOD, portfolioReturn, toFixedHalfUp } from '@marsad/core';
import { scanAfterEach, seedSession } from './helpers';
import { json, routeBars, syntheticSeries, weekdays } from './summary-stubs';

scanAfterEach();

/**
 * Portfolio's "Your actual result" (core portfolio-return-1) from Journal trades and stored closes. Two trades:
 * KO bought and sold, NVDA bought and still open, and one short (not counted). The expected figures come from the
 * core function on the same stubbed rows (its own known-answer tests check the math); this spec checks the page
 * shows them with the period, the counts and the method.
 */
const DATES = weekdays('2026-11-27', 300);
const series = (tk: string) => syntheticSeries(tk, DATES);
const at = (i: number) => DATES[i] as string;
const trade = (
  id: number,
  ticker: string,
  side: 'long' | 'short',
  entry: number,
  exit: number | null,
) => {
  const bars = series(ticker);
  return {
    id,
    ticker,
    side,
    setup: 'Breakout',
    tags: [],
    alert_id: null,
    entry_date: at(entry),
    entry_price: bars[entry]?.close,
    shares: 10,
    stop: null,
    target: null,
    exit_date: exit === null ? null : at(exit),
    exit_price: exit === null ? null : bars[exit]?.close,
    checklist: {},
    checklist_version: 'checklist-3',
    followed: {},
    notes: '',
    screenshots: [],
  };
};
const TRADES = [
  trade(1, 'KO', 'long', 100, 180),
  trade(2, 'NVDA', 'long', 150, null),
  trade(3, 'AMD', 'short', 120, 130),
];

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/trades**', (r) => r.fulfill(json(TRADES)));
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json([
        {
          id: 1,
          ticker: 'NVDA',
          shares: 10,
          cost_basis: TRADES[1]?.entry_price,
          opened_on: TRADES[1]?.entry_date,
          stop: null,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: null,
          thesis_status: 'intact',
          horizon: 'swing',
        },
      ]),
    ),
  );
  await routeBars(page, series);
}

const pct = (v: number) => `${v >= 0 ? '▲ +' : '▼ −'}${toFixedHalfUp(Math.abs(v) * 100, 1)}%`;

test('actual result: time- and money-weighted beside SPY, with the period, counts and method', async ({
  page,
}) => {
  await stub(page);
  const r = portfolioReturn({
    trades: TRADES.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      side: t.side,
      entryDate: t.entry_date,
      entryPrice: t.entry_price as number,
      shares: t.shares,
      exitDate: t.exit_date,
      exitPrice: (t.exit_price ?? null) as number | null,
    })),
    closes: { KO: series('KO'), NVDA: series('NVDA'), AMD: series('AMD'), SPY: series('SPY') },
    spy: series('SPY'),
  });
  if (r.twr === null || r.moneyWeighted === null || !r.spy || !r.period)
    throw new Error('expected');
  await page.goto('/portfolio?view=performance');
  const card = page.getByRole('region', { name: 'Performance' });
  await expect(card.getByRole('heading', { name: 'Your actual result' })).toBeVisible();
  const line = (name: string) => card.locator('dl > div').filter({ hasText: name });
  await expect(line('Time-weighted return')).toContainText(pct(r.twr));
  await expect(line('Money-weighted return (XIRR), a year')).toContainText(pct(r.moneyWeighted));
  await expect(line('SPY with the same cash flows, time-weighted')).toContainText(pct(r.spy.twr));
  await expect(line('Trades counted')).toContainText('2 trades, 1 closed, 3 cash flows');
  await expect(line('Trades counted')).toContainText('Fees $0');
  await expect(line('Sessions with a missing close')).toContainText('0');
  await expect(card).toContainText(`${r.period.sessions} sessions`);
  await expect(card).toContainText('Not counted: AMD (short trades are not included).');
  for (const m of PORTFOLIO_RETURN_METHOD) await expect(card).toContainText(m);
  await expect(card).toContainText('Fees as stored');
  // The holdings chart keeps its label: today's weights, not the actual result.
  await expect(card).toContainText('Current holdings at today’s weights, not your actual result');
});

test('actual result: no trades says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.goto('/portfolio?view=performance');
  await expect(
    page.getByText('No Journal trades yet, so there is no actual result to show.'),
  ).toBeVisible();
});
