import { expect, test } from '@playwright/test';
import { economicCalendar, estimateNextEarnings } from '@marsad/core';
import releaseDates from '../../../fixtures/fred/fred-release-dates-2026-11-25.json' with { type: 'json' };
import { seedSession } from './helpers';

// The calendar from the real FRED release dates (recorded 2026-11-25) through the job's own core function.
const dates = (
  releaseDates.body as {
    release_dates: { release_id: number; release_name: string; date: string }[];
  }
).release_dates.map((d) => ({
  releaseId: d.release_id,
  releaseName: d.release_name,
  date: d.date,
}));
const events = economicCalendar(dates, '2026-11-25', '2027-01-24');
const nvda = estimateNextEarnings(
  ['2025-11-19', '2026-02-25', '2026-05-27', '2026-08-26', '2026-11-17'],
  '2026-11-25',
);

test('watch: the economic calendar with ET and local times, a countdown, and estimated earnings', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // 12:00 UTC is 07:00 ET and 15:00 in Riyadh.
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
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
  await page.route('**/rest/v1/earnings_estimate_snapshots**', (r) =>
    r.fulfill(
      json([
        {
          computed_at: '2026-11-25T23:40:00+00:00',
          version: 'calendar-1',
          estimates: [{ ...nvda, ticker: 'NVDA', cik: '0001045810' }],
        },
      ]),
    ),
  );
  await page.goto('/');
  const econ = page.getByRole('region', { name: 'Economic calendar' });
  await expect(econ.getByRole('heading', { name: 'Today, 2026-11-25' })).toBeVisible();
  // GDP at 08:30 ET is 13:30 UTC, 16:30 in Riyadh, 1 h 30 min after 12:00 UTC.
  const gdp = econ.getByRole('row', { name: /GDP/ });
  await expect(gdp).toContainText('08:30 ET (16:30 local)');
  await expect(gdp).toContainText('in 1 h 30 min');
  await expect(gdp).toContainText('High impact');
  // The FOMC statement on 2026-12-09, 14:00 EST, is 19:00 UTC and 22:00 in Riyadh.
  await expect(econ.getByRole('row', { name: /FOMC statement and projections/ })).toContainText(
    '14:00 ET (22:00 local)',
  );
  // Only the next 14 days: CPI on 2026-12-10 is beyond them.
  await expect(econ.getByRole('row', { name: /^CPI|CPI/ })).toHaveCount(0);
  await expect(econ.getByText(/FRED release calendar/)).toBeVisible();

  const earn = page.getByRole('region', { name: 'Watchlist earnings (estimated)' });
  const row = earn.getByRole('row', { name: /NVDA/ });
  await expect(row).toContainText('2027-02-24');
  await expect(row).toContainText('2027-02-17 to 2027-03-03');
  await expect(row).toContainText('Same quarter last year, 52 weeks on');
  await expect(earn.getByText(/Not a confirmed date/)).toBeVisible();
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/watch.png`, fullPage: true });
});

test('watch: before the calendar job has run, the page says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/');
  await expect(page.getByText(/No calendar yet/)).toBeVisible();
  await expect(page.getByText(/No estimates yet/)).toBeVisible();
});
