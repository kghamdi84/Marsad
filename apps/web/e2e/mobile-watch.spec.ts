import { expect, test } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
// Playwright reads fixtures from a destructuring pattern; this hook needs none of them.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'One phone run is enough; the viewport is set here.');
});

// The same synthetic bars as watch.spec.ts (not market data): 1 day +0.8%, 1 week +4.3%, 1 month +21.0%,
// gap +2.50%, volume 3.0x.
function syntheticBars() {
  return Array.from({ length: 22 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10),
    open: i === 21 ? 123 : 100 + i,
    high: 125,
    low: 99,
    close: 100 + i,
    volume: i === 21 ? 300 : 100,
    vwap: null,
  })).reverse();
}

test('phone watch: list rows expand, movers and gaps share one card', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/daily_bars**', (r) => r.fulfill(json(syntheticBars())));
  await page.route('**/rest/v1/market_movers_daily**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-11-24',
          version: 'watch-1',
          n: 987,
          gainers: [{ ticker: 'UP1', close: 55, change: 0.12, dollarVolume: 820e6 }],
          losers: [{ ticker: 'DN1', close: 20, change: -0.08, dollarVolume: 300e6 }],
          sectors: [{ ticker: 'XLK', sector: 'Technology', change: 0.021 }],
        },
      ]),
    ),
  );
  await page.goto('/');

  // The page title sits in the top bar; the page keeps its heading for screen readers.
  await expect(page.getByRole('heading', { level: 1, name: 'Watch' })).toBeAttached();

  const list = page.getByRole('region', { name: 'Watchlist' });
  const row = list.getByRole('button', { name: /^NVDA/ });
  await expect(row).toContainText('121.00');
  await expect(row).toContainText('+0.8%');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const more = page.locator('#wl-more-NVDA');
  await expect(more).toContainText('+4.3%');
  await expect(more).toContainText('+21.0%');
  await expect(more).toContainText('3.0x');
  await expect(more.getByRole('link', { name: 'Study NVDA' })).toHaveAttribute(
    'href',
    '/study/NVDA',
  );

  const mg = page.getByRole('region', { name: 'Movers and gaps' });
  await expect(mg.getByRole('row', { name: /UP1/ })).toContainText('+12.0%');
  await mg.getByRole('button', { name: 'Down' }).click();
  await expect(mg.getByRole('row', { name: /DN1/ })).toContainText('−8.0%');
  await mg.getByRole('button', { name: 'Gaps' }).click();
  await expect(mg.getByRole('row').first()).toContainText('+2.50%');
  // The page never scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
