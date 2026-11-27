import { expect, test, type Page } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// 260 synthetic sessions (not market data): closes rise 0.1% a day from 20.00, volume 1,000,000 a day.
const day = (i: number) =>
  new Date(Date.UTC(2025, 10, 3) + i * 86_400_000).toISOString().slice(0, 10);
const bars = Array.from({ length: 260 }, (_, i) => {
  const close = Number((20 * 1.001 ** i).toFixed(4));
  return {
    date: day(i),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000_000,
    vwap: null,
  };
});

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json([
        {
          id: 1,
          ticker: 'RKLB',
          shares: 100,
          cost_basis: 20,
          opened_on: '2026-10-01',
          stop: 22,
          targets: [27],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: null,
          thesis_status: 'intact',
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const url = new URL(r.request().url());
    const asc = url.searchParams.get('order')?.includes('asc') ?? false;
    return r.fulfill(json(asc ? bars : [...bars].reverse()));
  });
}

test('quick look: a ticker opens a side panel with its facts, why it is here and a link to the full study', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/journal');
  await page.getByRole('button', { name: 'RKLB, quick look' }).first().click();
  const panel = page.getByRole('dialog', { name: 'RKLB' });
  await expect(panel).toBeVisible();
  // The last synthetic close: 20 x 1.001^259.
  await expect(panel).toContainText(`$${(20 * 1.001 ** 259).toFixed(2)}`);
  await expect(panel).toContainText('▲ +0.10%');
  await expect(panel).toContainText('Volume vs 20-day');
  await expect(panel).toContainText('1.0x');
  await expect(panel).toContainText('No estimate stored');
  await expect(panel).toContainText('You hold 100 shares; stop 22.00, targets 27.00.');
  await expect(panel.getByRole('link', { name: 'Open full study' })).toHaveAttribute(
    'href',
    '/study/RKLB',
  );
  // The list underneath stays where it is; Escape closes the panel.
  await expect(page.getByRole('region', { name: 'Holdings and exit conditions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('quick look: a ticker opens a sheet', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await stub(page);
    await page.goto('/journal');
    await page.getByRole('button', { name: 'RKLB, quick look' }).first().tap();
    const sheet = page.getByRole('dialog', { name: 'RKLB' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('You hold 100 shares; stop 22.00, targets 27.00.');
    await expect(sheet.getByRole('link', { name: 'Open full study' })).toBeVisible();
  });
});
