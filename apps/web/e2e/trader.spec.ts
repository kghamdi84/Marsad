import { expect, test, type Page } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// Synthetic sessions (not market data). NVDA: 69 flat sessions at 100 (range 99 to 101), then 104 (range 103 to
// 105): ATR 14 = 31 / 14 = 2.214 (2.1% of 104); SMA 50 = 100.08, so the stretch is 3.92 / 2.214 = +1.8 ATR.
// SPY is flat at 400, so NVDA's 63-session strength against it is 104 / 100 - 1 = +4.0%.
const day = (i: number) =>
  new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10);
const series = (n: number, close: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => {
    const c = close(i);
    return { date: day(i), open: c, high: c + 1, low: c - 1, close: c, volume: 1000, vwap: null };
  });
const BARS: Record<string, ReturnType<typeof series>> = {
  NVDA: series(70, (i) => (i === 69 ? 104 : 100)),
  SPY: series(70, () => 400),
};

async function stub(page: Page, posted: unknown[], deleted: string[]) {
  await seedSession(page, 'aal2');
  // 2026-10-09 12:00 UTC; the estimated NVDA earnings date below is 10 days later.
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/watchlist_items**', (r) => {
    const m = r.request().method();
    if (m === 'POST') {
      posted.push(r.request().postDataJSON());
      return r.fulfill({ status: 201, body: '' });
    }
    if (m === 'DELETE') {
      deleted.push(decodeURIComponent(r.request().url()));
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill(json([{ ticker: 'NVDA', position: 0 }]));
  });
  await page.route('**/rest/v1/watchlists**', (r) =>
    r.request().method() === 'POST' ? r.fulfill(json({ id: 7 }, 201)) : r.fulfill(json([])),
  );
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const url = new URL(r.request().url());
    const tk = url.searchParams.get('ticker')?.replace(/^eq\./, '') ?? '';
    const rows = BARS[tk] ?? [];
    const asc = url.searchParams.get('order')?.includes('asc') ?? false;
    return r.fulfill(json(asc ? rows : [...rows].reverse()));
  });
  await page.route('**/rest/v1/earnings_estimate_snapshots**', (r) =>
    r.fulfill(
      json([
        {
          computed_at: '2026-10-08T23:00:00Z',
          estimates: [
            {
              ticker: 'NVDA',
              cik: '0001045810',
              date: '2026-10-19',
              from: '2026-10-12',
              to: '2026-10-26',
              basis: 'same-quarter',
              lastRelease: '2025-10-20',
              overdue: false,
            },
          ],
        },
      ]),
    ),
  );
}

test('trader columns: ATR %, stretch, strength against SPY and days to earnings, off until switched on', async ({
  page,
}) => {
  await stub(page, [], []);
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Watchlist' });
  await expect(list.getByRole('columnheader', { name: 'ATR %' })).toHaveCount(0);
  await list.getByRole('button', { name: 'Trader columns' }).click();
  const nvda = list.getByRole('row', { name: /^NVDA/ });
  await expect(nvda).toContainText('2.1%');
  await expect(nvda).toContainText('+1.8 ATR');
  await expect(nvda).toContainText('+4.0%');
  await expect(nvda).toContainText('10 d');
});

test('watchlist: add and remove tickers; the list is saved in order', async ({ page }) => {
  const posted: unknown[] = [];
  const deleted: string[] = [];
  await stub(page, posted, deleted);
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Watchlist' });
  await list.getByRole('button', { name: 'Edit list' }).click();
  const editor = list.getByRole('region', { name: 'Edit the watchlist' });
  await editor.getByLabel('Add a ticker').fill('pltr');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect
    .poll(() => posted.at(-1))
    .toEqual([
      { watchlist_id: 7, ticker: 'NVDA', position: 0 },
      { watchlist_id: 7, ticker: 'PLTR', position: 1 },
    ]);
  await editor.getByRole('button', { name: 'Remove NVDA' }).click();
  await expect
    .poll(() => posted.at(-1))
    .toEqual([{ watchlist_id: 7, ticker: 'PLTR', position: 0 }]);
  expect(deleted.at(-1)).toContain('ticker=not.in.(PLTR)');
  await editor.getByLabel('Add a ticker').fill('not a ticker');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor.getByText('"not a ticker" is not a ticker symbol.')).toBeVisible();
});
