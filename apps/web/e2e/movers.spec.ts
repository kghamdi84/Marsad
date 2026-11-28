import { expect, test, type Page } from '@playwright/test';
import { moversSession, type TickerSeries } from '@marsad/core';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

// A hand-built market (not market data) run through the real movers-1 function, as the breadth job stores it.
// 60 weekday sessions up to Tue 2026-11-24: too few for the 52-week views (252 needed).
function weekdaysUpTo(last: string, n: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${last}T00:00:00Z`); out.length < n; t -= 86_400_000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) out.unshift(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const N = 60;
const dates = weekdaysUpTo('2026-11-24', N);
function ending(last: number, base = 100, volume = 1_000_000, lastVolume = volume): TickerSeries {
  const close: number[] = new Array<number>(N).fill(base);
  const vol: number[] = new Array<number>(N).fill(volume);
  close[N - 1] = last;
  vol[N - 1] = lastVolume;
  return { close, volume: vol };
}
const vol = ending(100.5, 100, 1_000_000, 4_000_000);
// 2 million shares a day for the first 39 sessions, 1 million for the 20 before the last: 4.0x the 20-session
// average and 2.5x the 50-session average ((30 x 2 + 20 x 1) / 50 = 1.6 million).
for (let k = 0; k < 39; k++) (vol.volume as number[])[k] = 2_000_000;
const series = new Map<string, TickerSeries>([
  ['UP1', ending(112.34)], // +12.34%
  ['AAA', ending(21, 20)], // +5%, USD 21 million traded
  ['DN1', ending(91.3)], // -8.70%
  ['JMP', ending(142)], // +42%: over the 25% guard
  ['SPL', ending(101)], // a 4-for-1 split takes effect on the session
  ['VOL', vol],
  ['SPY', ending(603, 600, 50_000_000)],
]);
const session = moversSession({
  dates,
  series,
  eligible: new Set(series.keys()),
  eligibleAsOf: '2026-10-02',
  splits: [{ ticker: 'SPL', executionDate: '2026-11-24', splitFrom: 1, splitTo: 4 }],
  i: N - 1,
});

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function stub(page: Page, opts: { owner: boolean }) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/market_movers_daily**', (r) =>
    r.fulfill(
      json([
        {
          date: '2026-11-24',
          version: 'watch-1',
          n: 987,
          gainers: [{ ticker: 'UP9', close: 55, change: 0.12, dollarVolume: 820e6 }],
          losers: [{ ticker: 'DN9', close: 20, change: -0.08, dollarVolume: 300e6 }],
          sectors: [],
          market_version: 'movers-1',
        },
      ]),
    ),
  );
  // Row-level security returns no rows to a member (ADR 0048).
  await page.route('**/rest/v1/market_movers_market**', (r) =>
    r.fulfill(
      json(
        opts.owner
          ? [
              {
                date: '2026-11-24',
                version: 'movers-1',
                session,
                computed_at: '2026-11-24T23:10:00Z',
              },
            ]
          : [],
      ),
    ),
  );
  await page.route('**/rest/v1/instruments**', (r) =>
    r.fulfill(json([{ ticker: 'UP1', cik: '0000000001', name: 'Up One Corp' }])),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    r.fulfill(
      json([
        {
          id: 'n1',
          published_at: '2026-11-24T15:30:00Z',
          publisher: 'Reuters',
          title: 'AAA raises its outlook',
          url: 'https://example.com/aaa',
          tickers: ['AAA'],
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/filings**', (r) =>
    r.fulfill(
      json([
        {
          accession: '0000000001-26-000001',
          cik: '0000000001',
          form: '8-K',
          filing_date: '2026-11-24',
          accepted_at: '2026-11-24T21:05:00Z',
          primary_document: 'up1.htm',
          items: ['8.01'],
        },
      ]),
    ),
  );
}

async function openMovers(page: Page) {
  await page.goto('/');
  await page
    .getByRole('group', { name: 'Sectors, movers or gaps' })
    .getByRole('button', { name: 'Movers' })
    .click();
}

const views = (page: Page) => page.getByRole('group', { name: 'Movers list' });

test('movers: whole market for the owner, with checks, filters, rules and the latest stored headline', async ({
  page,
}) => {
  await stub(page, { owner: true });
  await openMovers(page);
  const card = page.getByRole('region', { name: 'Whole-market movers' });
  await expect(
    card.getByText(
      'Last completed session (end of day): Tue 24 Nov 2026, from Massive grouped daily. Not live.',
    ),
  ).toBeVisible();
  await expect(card.getByText(/today/i)).toHaveCount(0);
  await expect(
    card.getByText('After hours: Not available: Marsad stores end-of-day prices only.'),
  ).toBeVisible();

  // Gainers: ranked rows, the corporate-action checks apart from them.
  const up1 = card.getByRole('row', { name: /UP1/ });
  await expect(up1).toContainText('+12.34%');
  await expect(up1).toContainText('▲');
  await expect(up1).toContainText('112.34');
  await expect(up1).toContainText('Up One Corp');
  await expect(up1).toContainText('USD 112.3 million');
  await expect(up1).toContainText('8-K (items 8.01) (SEC EDGAR, 24 Nov 16:05 ET (00:05 Riyadh))');
  await expect(card.getByRole('row', { name: /AAA/ })).toContainText(
    'AAA raises its outlook (Reuters, 24 Nov 10:30 ET (18:30 Riyadh))',
  );
  await expect(card.getByRole('row', { name: /VOL/ })).toContainText(
    'No stored news or filing for this ticker',
  );
  await expect(
    card
      .getByRole('columnheader', { name: 'Latest stored headline, not a verified cause' })
      .first(),
  ).toBeVisible();
  await expect(card.getByText('Top 4 of 4.')).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Check corporate action (2)' })).toBeVisible();
  const jmp = card.getByRole('row', { name: /JMP/ });
  await expect(jmp).toContainText('Check corporate action');
  await expect(jmp).toContainText('Moved more than 25% in one session');
  await expect(card.getByRole('row', { name: /SPL/ })).toContainText(
    'A split takes effect on this session. Split 4-for-1 on 24 Nov 2026',
  );

  await views(page).getByRole('button', { name: 'Losers' }).click();
  await expect(card.getByRole('row', { name: /DN1/ })).toContainText('−8.70%');
  await expect(card.getByRole('row', { name: /DN1/ })).toContainText('▼');

  await views(page).getByRole('button', { name: 'Active' }).click();
  await expect(card.getByRole('row').nth(1)).toContainText('SPY');

  // Unusual volume: the rule on screen, the 20-session ratio with the 50-session one beside it.
  await views(page).getByRole('button', { name: 'Unusual volume' }).click();
  await expect(
    card
      .getByText(
        'Rule: volume at least 3.0× its average of the previous 20 sessions, and at least USD 5 million traded. The 50-session ratio is shown beside it for context.',
      )
      .first(),
  ).toBeVisible();
  await expect(card.getByRole('row', { name: /VOL/ })).toContainText('4.0× (2.5×)');

  // 52-week views need 252 stored sessions.
  await views(page).getByRole('button', { name: '52-week high' }).click();
  await expect(
    card.getByText('Unavailable: 252 stored sessions are needed and 60 are stored.'),
  ).toBeVisible();
  await expect(card.getByText(/^By close: /).first()).toBeVisible();

  // The minimum dollar-volume filter (market cap is not stored for the whole market).
  await views(page).getByRole('button', { name: 'Gainers' }).click();
  await card.getByLabel('Minimum traded').selectOption({ label: 'USD 100 million' });
  await expect(card.getByRole('row', { name: /UP1/ })).toBeVisible();
  await expect(card.getByRole('row', { name: /AAA/ })).toHaveCount(0); // USD 21 million traded
  await expect(card.getByText('Top 3 of 3.')).toBeVisible(); // UP1, SPY and VOL

  await card.getByText('About this data').click();
  await expect(card.getByText(/does not store market capitalisation/)).toBeVisible();
  await expect(card.getByText(/new 52-week highs and lows by close/)).toBeVisible();
  await expect(card.getByText(/never send a push alert/)).toBeVisible();
  await expect(card.getByText(/Formula movers-1, computed 24 Nov 18:10 ET/)).toBeVisible();

  // The Marsad universe view stays one tap away.
  await page
    .getByRole('group', { name: 'Movers scope' })
    .getByRole('button', { name: 'Marsad universe' })
    .click();
  const universe = page.getByRole('region', { name: 'Movers in the Marsad universe' });
  await expect(universe.getByRole('row', { name: /UP9/ })).toContainText('+12.0%');
});

test('movers: a member sees the Marsad universe; the whole market is owner-only', async ({
  page,
}) => {
  await stub(page, { owner: false });
  await openMovers(page);
  const universe = page.getByRole('region', { name: 'Movers in the Marsad universe' });
  await expect(universe.getByRole('row', { name: /UP9/ })).toContainText('+12.0%');
  await page
    .getByRole('group', { name: 'Movers scope' })
    .getByRole('button', { name: 'Whole market' })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Whole-market movers' })
      .getByText(/Available to the owner only/),
  ).toBeVisible();
});

test('movers: On my list runs the same rules over the watchlist and holdings', async ({ page }) => {
  await stub(page, { owner: true });
  await page.route('**/rest/v1/watchlist_items**', (r) =>
    r.fulfill(json([{ ticker: 'NVDA', position: 0, sector_etf: null }])),
  );
  // 22 synthetic bars: closes 100 to 121, 1 million shares a day and 3 million on the last.
  await page.route('**/rest/v1/daily_bars**', (r) =>
    r.fulfill(
      json(
        Array.from({ length: 22 }, (_, i) => ({
          date: new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10),
          open: 100 + i,
          high: 125,
          low: 99,
          close: 100 + i,
          volume: i === 21 ? 3_000_000 : 1_000_000,
          vwap: null,
        })).reverse(),
      ),
    ),
  );
  await openMovers(page);
  const card = page.getByRole('region', { name: 'Whole-market movers' });
  await card.getByRole('button', { name: 'On my list' }).click();
  await expect(card.getByRole('button', { name: 'On my list' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    card.getByText(/from Massive daily bars for your watchlist and holdings/),
  ).toBeVisible();
  await expect(card.getByText(/Your watchlist and holdings \(1 ticker\)/)).toBeVisible();
  await expect(card.getByRole('row', { name: /NVDA/ })).toContainText('+0.83%'); // 121 / 120
  await views(page).getByRole('button', { name: 'Unusual volume' }).click();
  await expect(card.getByRole('row', { name: /NVDA/ })).toContainText('3.0×'); // 3 million against 1 million
});

test('movers on a phone: one column, no sideways scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One phone run is enough; the viewport is set here.');
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, { owner: true });
  await openMovers(page);
  const card = page.getByRole('region', { name: 'Whole-market movers' });
  const up1 = card.getByRole('listitem').filter({ hasText: 'UP1' });
  await expect(up1).toContainText('+12.34%');
  await expect(up1).toContainText('Latest stored headline, not a verified cause');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
