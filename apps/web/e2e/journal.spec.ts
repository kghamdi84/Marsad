import { expect, test } from '@playwright/test';
import { seedSession } from './helpers';

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test('journal: the sizer gives shares and the Sahm ticket, copy only after the checklist', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.goto('/journal');
  await page.getByLabel('Ticker').fill('rklb');
  await page.getByLabel('Account size (USD)').fill('50000');
  await page.getByLabel('Risk per trade (%)').fill('0.5');
  await page.getByLabel('Limit price').fill('24.15');
  await page.getByLabel('Stop', { exact: true }).fill('22.15');
  await page.getByLabel('Targets (separate with spaces)').fill('28.15 30.15');
  // USD 250 at risk over a 2.00 stop distance: 125 shares, USD 3,018.75 (6.0% of the account); 2.0R and 3.0R.
  await expect(
    page.getByText(
      '125 shares; risk USD 250.00 if the stop fills; position USD 3018.75 (6.0% of the account).',
    ),
  ).toBeVisible();
  await expect(page.getByText('Reward to risk: 2.0R, 3.0R.')).toBeVisible();
  await expect(page.getByTestId('sahm-ticket')).toHaveText(
    'BUY 125 RKLB LIMIT 24.15, STOP 22.15, GTC',
  );
  const copy = page.getByRole('button', { name: 'Copy Sahm order ticket' });
  await expect(copy).toBeDisabled();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await expect(copy).toBeEnabled();
});

test('journal: holdings show the result and triggered exits; a CSV with mistakes names them', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  let inserted: unknown = null;
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (r) => {
    if (r.request().method() === 'POST') {
      inserted = r.request().postDataJSON();
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    return r.fulfill(
      json([
        {
          id: 1,
          ticker: 'RKLB',
          shares: 100,
          cost_basis: 24,
          opened_on: '2026-10-01',
          stop: 22,
          targets: [27],
          trend_break: 'sma3',
          time_stop_sessions: null,
        },
        {
          id: 2,
          ticker: 'SOFI',
          shares: 40,
          cost_basis: 18.5,
          opened_on: '2026-09-15',
          stop: null,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
        },
      ]),
    );
  });
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const t = new URL(r.request().url()).searchParams.get('ticker')?.replace(/^eq\./, '');
    const closes = t === 'RKLB' ? [24, 25, 24, 21.5] : [18, 19];
    return r.fulfill(
      json(
        closes
          .map((close, i) => ({
            date: `2026-10-0${i + 2}`,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1,
            vwap: null,
          }))
          .reverse(),
      ),
    );
  });
  await page.goto('/journal');
  const rklb = page.getByRole('row', { name: /^RKLB/ });
  // 21.50 against a 24.00 cost: -10.4% (USD -250.00); the stop and the trend break both triggered.
  await expect(rklb).toContainText('-10.4% (USD -250.00)');
  await expect(rklb).toContainText('Triggered: Closed at 21.50, at or below the stop 22.00.');
  await expect(rklb).toContainText('below the 3-day SMA');
  await expect(page.getByRole('row', { name: /^SOFI/ })).toContainText(
    'No exit conditions set: add a stop and a target.',
  );

  await page
    .getByLabel('Add from CSV')
    .fill('ticker,shares,cost_basis,opened_on\nNVDA,10,180,2026-11-01\nbad,0,x,2026/1/1');
  await page.getByRole('button', { name: 'Add these holdings' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Line 3: check shares, cost_basis, opened_on (YYYY-MM-DD).',
  );
  expect(inserted).toBeNull(); // nothing is added while any line has a mistake
  await page
    .getByLabel('Add from CSV')
    .fill('ticker,shares,cost_basis,opened_on,stop\nNVDA,10,180,2026-11-01,170');
  await page.getByRole('button', { name: 'Add these holdings' }).click();
  await expect
    .poll(() => inserted)
    .toEqual([
      {
        ticker: 'NVDA',
        shares: 10,
        cost_basis: 180,
        opened_on: '2026-11-01',
        stop: 170,
        targets: [],
        trend_break: null,
        time_stop_sessions: null,
      },
    ]);
});
