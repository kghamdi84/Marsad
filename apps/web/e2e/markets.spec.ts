import { expect, test, type Page } from '@playwright/test';
import { economicCalendar } from '@marsad/core';
import releaseDates from '../../../fixtures/fred/fred-release-dates-2026-11-25.json' with { type: 'json' };
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// Markets (ADR 0048): a summary card first, then regime, movers, sectors or the calendar, one at a time.

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// The calendar from the real FRED release dates (recorded 2026-11-25) through the job's own core function.
const events = economicCalendar(
  (
    releaseDates.body as {
      release_dates: { release_id: number; release_name: string; date: string }[];
    }
  ).release_dates.map((d) => ({
    releaseId: d.release_id,
    releaseName: d.release_name,
    date: d.date,
  })),
  '2026-11-25',
  '2027-01-24',
);

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  // 12:00 UTC is 07:00 ET: GDP at 08:30 ET is still ahead.
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/econ_calendar_snapshots**', (r) =>
    r.fulfill(
      json([
        {
          fetched_at: '2026-11-25T23:40:00+00:00',
          version: 'calendar-1',
          range_from: '2026-11-25',
          range_to: '2027-01-24',
          events,
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/market_movers_daily**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-11-24',
          version: 'watch-1',
          n: 987,
          gainers: [{ ticker: 'UP1', close: 55, change: 0.12, dollarVolume: 820e6 }],
          losers: [{ ticker: 'DN1', close: 20, change: -0.08, dollarVolume: 300e6 }],
          sectors: [
            { ticker: 'XLK', sector: 'Technology', change: 0.021 },
            { ticker: 'XLE', sector: 'Energy', change: -0.013 },
            { ticker: 'XLU', sector: 'Utilities', change: null },
          ],
        },
      ]),
    ),
  );
}

test('markets: the summary first, each row from stored rows with its date, opening on the regime', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/markets');
  await expect(page.getByRole('heading', { level: 1, name: 'Markets' })).toBeVisible();
  // Opens on the regime, never on movers.
  await expect(
    page.getByRole('group', { name: 'Markets view' }).getByRole('button', { name: 'Regime' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const summary = page.getByRole('region', { name: 'Markets today' });
  // No stored regime rows: the row says so instead of guessing.
  await expect(summary.getByRole('button', { name: /^Regime/ })).toContainText('Data unavailable');
  // Sectors with a null change are left out; sign and arrow carry the direction.
  await expect(summary.getByRole('button', { name: /^Sectors/ })).toContainText(
    'Leading XLK ▲ +2.1%; lagging XLE ▼ −1.3%',
  );
  await expect(summary.getByRole('button', { name: /^Sectors/ })).toContainText(
    'close of Tue 24 Nov',
  );
  await expect(summary.getByRole('button', { name: /^Movers/ })).toContainText(
    'Top gainer UP1 ▲ +12.0%; top loser DN1 ▼ −8.0%',
  );
  await expect(summary.getByRole('button', { name: /^Movers/ })).toContainText(
    'Marsad universe (987 members), last completed session Tue 24 Nov',
  );
  await expect(summary.getByRole('button', { name: /^Calendar/ })).toContainText(
    /Next high impact: .+, Wed 25 Nov 08:30 ET/,
  );
  // A row opens its view and writes it into the URL.
  await summary.getByRole('button', { name: /^Calendar/ }).click();
  await expect(page).toHaveURL(/\/markets\?view=calendar$/);
  const agenda = page.getByRole('region', { name: 'Economic and earnings calendar' });
  // The Markets calendar looks 30 days ahead: CPI on 10 Dec, beyond Watch's 14 days, is listed here.
  await expect(
    agenda
      .getByRole('listitem')
      .filter({ has: page.getByText('CPI', { exact: true }) })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ex-dividend calendar' })).toBeVisible();
});

test('markets: sectors and movers views; Watch cards end in a See all link to them', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/markets?view=sectors');
  await expect(page.getByRole('region', { name: 'US sectors' })).toContainText('XLK');
  await page.goto('/');
  const market = page.getByRole('group', { name: 'Sectors, movers or gaps' });
  await expect(page.getByRole('link', { name: 'See all sectors on Markets' })).toHaveAttribute(
    'href',
    '/markets?view=sectors',
  );
  await market.getByRole('button', { name: 'Movers' }).click();
  // Watch keeps the Marsad universe movers; the whole market is on Markets.
  await expect(page.getByRole('region', { name: 'Movers in the Marsad universe' })).toContainText(
    'UP1',
  );
  await page.getByRole('link', { name: 'See all movers on Markets' }).click();
  await expect(page).toHaveURL(/\/markets\?view=movers$/);
  await expect(
    page.getByRole('group', { name: 'Markets view' }).getByRole('button', { name: 'Movers' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('regime: the old page redirects to the Markets regime view and keeps the hash', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/regime');
  await expect(page).toHaveURL(/\/markets\?view=regime$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Markets' })).toBeVisible();
  await page.goto('/regime#regime-risk');
  await expect(page).toHaveURL(/\/markets\?view=regime#regime-risk$/);
});
