import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { haltAlerts, renderCard } from '@marsad/core';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

function json(route: Route, body: unknown) {
  const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const payload = wantsObject && Array.isArray(body) ? (body[0] ?? null) : body;
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

/** The ticker a PostgREST read filters on (`ticker=eq.RKLB`), or null. */
const tickerOf = (r: Route) =>
  new URL(r.request().url()).searchParams.get('ticker')?.replace(/^eq\./, '') ?? null;

// 260 synthetic sessions (not market data), one a calendar day from 3 Nov 2025 to Mon 20 Jul 2026: closes start at
// 20.00 and rise by a fixed rate a day (RKLB and every other ticker 0.1%, SPY 0.02%, the sector fund XLI 0.05%),
// rounded to 4 decimals; volume 1,000,000 a day. The last RKLB close is 20 x 1.001^259 = 25.9093.
const day = (i: number) =>
  new Date(Date.UTC(2025, 10, 3) + i * 86_400_000).toISOString().slice(0, 10);
const RATE: Record<string, number> = { SPY: 0.0002, XLI: 0.0005 };
const series = (rate: number) =>
  Array.from({ length: 260 }, (_, i) => {
    const close = Number((20 * (1 + rate) ** i).toFixed(4));
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

const HOLDINGS = [
  {
    id: 1,
    ticker: 'RKLB',
    shares: 100,
    cost_basis: 20,
    opened_on: '2026-03-02',
    stop: 22,
    targets: [27],
    trend_break: null,
    time_stop_sessions: null,
    sector_etf: 'XLI',
    thesis_status: 'intact',
    horizon: 'swing',
  },
  {
    id: 2,
    ticker: 'MSFT',
    shares: 10,
    cost_basis: 30,
    opened_on: '2026-03-02',
    stop: 20,
    targets: [],
    trend_break: null,
    time_stop_sessions: null,
    sector_etf: null,
    thesis_status: 'weakening',
    horizon: null,
  },
];

// Eight made-up calendar quarters (the snapshot-1 known-answer case): revenue 10, 11, ..., 17 billion and net
// income 2 billion each, so the last four sum to 62 billion against 46 a year earlier (+34.8%), margin 8 / 62 = 12.9%.
const QUARTERS: [string, string, string][] = [
  ['2024-01-01', '2024-03-31', '2024-05-06'],
  ['2024-04-01', '2024-06-30', '2024-08-05'],
  ['2024-07-01', '2024-09-30', '2024-11-04'],
  ['2024-10-01', '2024-12-31', '2025-02-10'],
  ['2025-01-01', '2025-03-31', '2025-05-05'],
  ['2025-04-01', '2025-06-30', '2025-08-04'],
  ['2025-07-01', '2025-09-30', '2025-11-03'],
  ['2025-10-01', '2025-12-31', '2026-02-09'],
];
const fact = (
  concept: string,
  start: string | null,
  end: string,
  value: number,
  filed: string,
  unit = 'USD',
  taxonomy = 'us-gaap',
) => ({
  taxonomy,
  concept,
  unit,
  period_start: start,
  period_end: end,
  value,
  accession: `0000000000-${filed.slice(2, 4)}-${filed.slice(5, 7)}${filed.slice(8, 10)}00`,
  form: '10-Q',
  fiscal_year: Number(end.slice(0, 4)),
  fiscal_period: 'Q',
  filed,
  frame: null,
});
const FACTS = [
  ...QUARTERS.map(([s, e, f], i) => fact('Revenues', s, e, (10 + i) * 1e9, f)),
  ...QUARTERS.map(([s, e, f]) => fact('NetIncomeLoss', s, e, 2e9, f)),
  // 1 billion shares on the cover page: short interest of 150 million is 15% of them.
  fact(
    'EntityCommonStockSharesOutstanding',
    null,
    '2026-01-31',
    1e9,
    '2026-02-09',
    'shares',
    'dei',
  ),
];

const filing = (form: string, date: string, items: string[] = []) => ({
  accession: `0001819994-26-${date.replace(/-/g, '')}`,
  form,
  filing_date: date,
  accepted_at: `${date}T21:00:00Z`,
  primary_document: `${form.toLowerCase()}-${date}.htm`,
  items,
});
// Results 8-Ks (item 2.02): the newest is Fri 24 Apr 2026 with none a year earlier, so the next estimate is the
// quarterly cadence, 91 days on: Fri 24 Jul 2026, 4 days after the last session (20 Jul).
const RESULTS = [
  filing('8-K', '2026-04-24', ['2.02', '9.01']),
  filing('8-K', '2026-01-29', ['2.02', '9.01']),
  filing('8-K', '2025-10-30', ['2.02', '9.01']),
];
const REPORTS = [filing('10-Q', '2026-05-08'), filing('8-K', '2026-04-24', ['2.02', '9.01'])];

const ALERT_ID = '22222222-2222-4222-8222-222222222222';
const HALT_AT = new Date('2026-07-20T18:05:00Z');
const [HALT] = haltAlerts(
  {
    symbol: 'SOFI',
    haltedAt: '2026-07-20T18:02:05Z',
    reasonCode: 'T1',
    reasonMeaning: 'News pending',
    newsRelated: true,
    resumptionTradeAt: null,
    lastSeenAt: '2026-07-20T18:04:30Z',
  },
  { regime: 'stress' },
  HALT_AT,
);
if (!HALT) throw new Error('no halt alert');

const story = (id: string, at: string, label: string) => ({
  id,
  published_at: at,
  sentiment: [{ ticker: 'RKLB', label }],
});

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  // 21:00 ET on Monday 20 Jul 2026: that session has finished, so its bar is the newest expected.
  await page.clock.setFixedTime(new Date('2026-07-21T01:00:00Z'));
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/rest/v1/holdings**', (r) => {
    const tk = tickerOf(r);
    return json(r, tk ? HOLDINGS.filter((h) => h.ticker === tk) : HOLDINGS);
  });
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const url = new URL(r.request().url());
    const asc = url.searchParams.get('order')?.includes('asc') ?? false;
    const bars = series(RATE[tickerOf(r) ?? ''] ?? 0.001);
    return json(r, asc ? bars : [...bars].reverse());
  });
  // Only RKLB has a company record (and so a CIK); every SEC read below is for it.
  await page.route('**/rest/v1/instruments**', (r) =>
    json(r, tickerOf(r) === 'RKLB' ? [{ cik: '0001819994', name: 'Rocket Lab Corp' }] : []),
  );
  await page.route('**/rest/v1/filings**', (r) => {
    const url = decodeURIComponent(r.request().url());
    return json(r, url.includes('items=cs.') ? RESULTS : REPORTS);
  });
  await page.route('**/rest/v1/financial_facts**', (r) => json(r, FACTS));
  await page.route('**/rest/v1/annual_sections**', (r) =>
    json(r, [
      {
        period_end: '2025-12-31',
        filing_date: '2026-02-27',
        filing_url:
          'https://www.sec.gov/Archives/edgar/data/1819994/000181999426000010/rklb-10k.htm',
        text: 'Item 1. Business\n\nOverview\n\nRocket Lab is a space company that builds launch vehicles and spacecraft for commercial and government customers. It was founded in 2006.\n\nOur strategy\n\nWe grow.',
      },
    ]),
  );
  await page.route('**/rest/v1/short_interest**', (r) =>
    json(
      r,
      tickerOf(r) === 'RKLB'
        ? [
            {
              settlement_date: '2026-06-30',
              short_interest: 150_000_000,
              avg_daily_volume: null,
              days_to_cover: 3.2,
            },
          ]
        : [],
    ),
  );
  await page.route('**/rest/v1/strength_rank_daily**', (r) =>
    json(
      r,
      tickerOf(r) === 'RKLB' ? [{ date: '2026-07-20', percentile: 85, rank: 12, members: 80 }] : [],
    ),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    json(
      r,
      decodeURIComponent(r.request().url()).includes('RKLB')
        ? [
            story('n1', '2026-07-17T14:00:00Z', 'positive'),
            story('n2', '2026-07-10T14:00:00Z', 'positive'),
            story('n3', '2026-07-02T14:00:00Z', 'neutral'),
          ]
        : [],
    ),
  );
  // One halt alert on SOFI, built by the job's own core functions (synthetic halt, not market data).
  await page.route('**/rest/v1/alerts**', (r) =>
    json(r, [
      {
        id: ALERT_ID,
        created_at: HALT_AT.toISOString(),
        kind: 'halt',
        priority: 'critical',
        ticker: 'SOFI',
        decision: 'push',
        reasons: [],
        card: renderCard(HALT),
        latency_ms: 30_500,
        delivery: {},
      },
    ]),
  );
}

const section = (scope: Locator, name: string) => scope.getByRole('region', { name, exact: true });

async function openRklb(page: Page) {
  await page.goto('/portfolio?view=holdings');
  await page.getByRole('button', { name: 'RKLB, quick look' }).first().click();
  const panel = page.getByRole('dialog', { name: 'RKLB' });
  await expect(panel).toBeVisible();
  return panel;
}

/** The held ticker's position rows, every figure checked by hand from the stubbed rows above. */
async function expectPosition(panel: Locator) {
  const pos = section(panel, 'Your position');
  await expect(pos).toBeVisible();
  await expect(pos).toContainText('100 at 20.00');
  // 100 x 25.9093 = 2,590.93 against 2,000.00 of cost: +590.93, and 25.9093 / 20 - 1 = +29.5%.
  await expect(pos).toContainText('$2,590.93 at the close of 20 Jul');
  await expect(pos).toContainText('▲ +$590.93 · ▲ +29.5%');
  // MSFT is the only other lot, 10 shares at the same close: 100 / 110 = 90.9% of the portfolio.
  await expect(pos).toContainText('90.9% of the portfolio');
  await expect(
    pos.getByRole('img', { name: 'Stop 22.00, now 25.91, targets 27.00.' }),
  ).toBeVisible();
  await expect(pos).toContainText('Intact');
  // 25.91 is above the 22.00 stop and below the 27.00 target, and no trend break or time stop is set.
  await expect(pos).toContainText('None triggered at the close of 20 Jul');
  await expect(pos).toContainText('Swing');
}

test('quick look: a held ticker shows the position, performance, a short brief and the full-study link last', async ({
  page,
}) => {
  await stub(page);
  const panel = await openRklb(page);
  // Header: the last synthetic close, its change and freshness word (council batch 2).
  await expect(panel).toContainText('$25.91');
  await expect(panel).toContainText('▲ +0.10%');
  await expect(panel.getByText('End of day · 20 Jul', { exact: true })).toBeVisible();

  await expectPosition(panel);

  const perf = section(panel, 'Performance');
  // 21, 63 and 252 sessions back: 1.001^n - 1 = +2.1%, +6.5%, +28.6%; SPY 1.0002^n - 1 = +0.4%, +1.3%, +5.2%;
  // XLI 1.0005^n - 1 = +1.1%, +3.2%, +13.4%.
  await expect(perf.getByRole('row', { name: /^RKLB/ })).toContainText('▲ +2.1%▲ +6.5%▲ +28.6%');
  await expect(perf.getByRole('row', { name: /^SPY/ })).toContainText('▲ +0.4%▲ +1.3%▲ +5.2%');
  await expect(perf.getByRole('row', { name: /^XLI/ })).toContainText('▲ +1.1%▲ +3.2%▲ +13.4%');
  await expect(perf).toContainText('Price return to the close of 20 Jul 2026, by session count');
  // At a new closing high; the 252-session low is 20 x 1.001^7 = 20.1606.
  await expect(perf).toContainText('0.0% from the high, range 20.16 to 25.91');
  await expect(perf).toContainText('ATR %');
  await expect(perf).toContainText('Beats 85% · 12 of 80 · 20 Jul');
  await expect(perf).toContainText('Volume vs 20-day');
  await expect(perf).toContainText('1.0×');
  await expect(perf).toContainText('$62.0B, ▲ +34.8% y/y (to 31 Dec 2025)');
  await expect(perf).toContainText('12.9% (4 quarters to 31 Dec 2025)');

  const brief = section(panel, 'Company brief');
  await expect(brief).toContainText(
    'Rocket Lab is a space company that builds launch vehicles and spacecraft for commercial and government customers.',
  );
  await expect(brief).toContainText(
    'First sentence of the 10-K business section, filed 27 Feb 2026.',
  );
  await expect(brief.getByText('Code-based checks, not advice')).toBeVisible();
  // Four strengths fire (revenue growth, above the 200-day, ahead of SPY, strength rank); the first three show.
  await expect(brief.getByText('Strengths (4)')).toBeVisible();
  await expect(brief.locator('[data-check]')).toHaveCount(5);
  await expect(brief).toContainText(
    'Revenue up 34.8% on a year earlier (4 quarters to 31 Dec 2025). Rule: up 10% or more.',
  );
  // The 200-day average of the closes 60 to 259 is 23.4957.
  await expect(brief).toContainText(
    'Above its 200-day average: close $25.91 against $23.50 on 20 Jul 2026.',
  );
  // (1.001 / 1.0002)^63 - 1 = 5.2% ahead of SPY.
  await expect(brief).toContainText(
    'Ahead of SPY by 5.2% over 63 sessions to 20 Jul 2026. Rule: 5% or more ahead.',
  );
  await expect(brief.locator('[data-check="strength-top"]')).toHaveCount(0);
  await expect(brief).toContainText('1 more in the full study');
  await expect(brief.getByText('Risks (2)')).toBeVisible();
  await expect(brief).toContainText(
    'Short interest 15.0% of shares outstanding (settled 30 Jun 2026). Rule: 10% or more.',
  );
  await expect(brief).toContainText(
    'Earnings in 4 days (estimated 24 Jul 2026): event risk. Rule: 14 days or fewer.',
  );
  await expect(brief).toContainText('2 positive · 1 neutral · 0 negative, of 3 stored stories');
  await expect(brief).toContainText("The news vendor's labels, an opinion.");
  await expect(brief).toContainText('Quarterly report (10-Q), filed 08 May 2026');
  await expect(brief).toContainText('~ Fri 24 Jul 2026, estimated (in 4 days)');
  await expect(brief).toContainText('Formula company-brief-1');

  // The existing parts stay: why it is here and the trader facts.
  await expect(panel).toContainText('You hold 100 shares; stop 22.00, targets 27.00.');
  await expect(section(panel, 'Trader facts')).toContainText('Stretch, 50-day');

  // In order: position, performance, brief, then the full-study link at the bottom.
  const y = async (l: Locator) => (await l.boundingBox())?.y ?? -1;
  const study = panel.getByRole('link', { name: 'Open full study' });
  await expect(study).toHaveAttribute('href', '/study/RKLB');
  const ys = [
    await y(section(panel, 'Your position')),
    await y(perf),
    await y(brief),
    await y(section(panel, 'Why it is here')),
    await y(study),
  ];
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);

  // The list underneath stays where it is; Escape closes the panel.
  await expect(page.getByRole('region', { name: 'Holdings and exit conditions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('quick look: a ticker that is not held has no position section, and missing company data says so', async ({
  page,
}) => {
  await stub(page);
  // The alert detail shows inline from 760 px (both projects), with SOFI as a quick-look link.
  await page.goto(`/alerts#alert-${ALERT_ID}`);
  await page.getByRole('button', { name: 'SOFI, quick look' }).first().click();
  const panel = page.getByRole('dialog', { name: 'SOFI' });
  await expect(panel).toBeVisible();
  await expect(section(panel, 'Performance')).toBeVisible();
  await expect(section(panel, 'Your position')).toHaveCount(0);
  // Why it is here: the alert, and no holding line.
  await expect(section(panel, 'Why it is here')).toContainText(
    'Latest alert 20 Jul: SOFI halted: News pending',
  );
  await expect(panel).not.toContainText('You hold');
  // Same synthetic series as RKLB; no sector fund is set for SOFI, so its row is left out and the reason shown.
  const perf = section(panel, 'Performance');
  await expect(perf.getByRole('row', { name: /^SOFI/ })).toContainText('▲ +2.1%▲ +6.5%▲ +28.6%');
  await expect(perf.getByRole('row')).toHaveCount(3);
  await expect(perf).toContainText('Sector fund: none set');
  await expect(perf).toContainText('Not in universe');
  // No company record, so no SEC facts, business section, filings or results 8-Ks: each line says so.
  await expect(perf.getByText('Revenue, 4 quarters').locator('..')).toContainText('Not available');
  const brief = section(panel, 'Company brief');
  await expect(brief.getByText('What it does').locator('..')).toContainText('Not available');
  await expect(brief).toContainText('No stories stored in 30 days.');
  await expect(brief).toContainText('No estimate stored');
  // Only the price checks can fire: above the 200-day and ahead of SPY.
  await expect(brief.getByText('Strengths (2)')).toBeVisible();
  await expect(brief.getByText('Risks (0)')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open full study' })).toHaveAttribute(
    'href',
    '/study/SOFI',
  );
});

test('quick look: the held ticker in the Daylight theme', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'marsad.display',
      JSON.stringify({ theme: 'light', lang: 'en', zone: 'Asia/Riyadh' }),
    );
  });
  await stub(page);
  const panel = await openRklb(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectPosition(panel);
  await expect(section(panel, 'Company brief')).toContainText('Formula company-brief-1');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('quick look: a ticker opens a sheet with the position and no sideways scroll', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await stub(page);
    await page.goto('/portfolio?view=holdings');
    await page.getByRole('button', { name: 'RKLB, quick look' }).first().tap();
    const sheet = page.getByRole('dialog', { name: 'RKLB' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('You hold 100 shares; stop 22.00, targets 27.00.');
    await expectPosition(sheet);
    await expect(section(sheet, 'Company brief')).toContainText('Formula company-brief-1');
    await expect(sheet.getByRole('link', { name: 'Open full study' })).toBeVisible();
    const overflow = await sheet.evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
