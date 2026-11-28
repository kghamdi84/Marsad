import { expect, test, type Page } from '@playwright/test';
import { validateAnalyst, validateCalendar, validateProfile } from '@marsad/core';
import aapl from '../../../fixtures/tauric/research-AAPL-2026-11-28.json' with { type: 'json' };
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// 70 weekdays ending Friday 27 Nov 2026, oldest first.
const DATES: string[] = (() => {
  const out: string[] = [];
  for (let t = Date.parse('2026-11-27T00:00:00Z'); out.length < 70; t -= 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
})();
const CLOSES: Record<string, (i: number) => number> = {
  SPY: (i) => 500 + i,
  // +0.10 a session, then a jump to 29 on the last day (29 / 26.40 = +9.8% over five sessions).
  RKLB: (i) => (i === 69 ? 29 : 20 + 0.1 * i),
  SOFI: (i) => 20 - 0.05 * i,
  KO: (i) => (i === 69 ? 62.5 : 62),
};
const barsOf = (tk: string) =>
  DATES.map((date, i) => {
    const close = Math.round((CLOSES[tk]?.(i) ?? 10) * 100) / 100;
    return { date, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1, vwap: null };
  }).reverse();

// Tauric research for RKLB from the recorded AAPL parts, validated by core as the job stores them.
const part = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const research = {
  ticker: 'RKLB',
  analyst: part(validateAnalyst(aapl.parts.analyst.body, 'AAPL')),
  profile: part(validateProfile(aapl.parts.profile.body, 'AAPL')),
  calendar: part(validateCalendar(aapl.parts.calendar.body, 'AAPL')),
  thesis: null,
  errors: { thesis: 'not_published' },
};

const trade = (id: number, win: boolean) => ({
  id,
  ticker: 'SOFI',
  side: 'long',
  setup: 'Breakout',
  tags: [],
  alert_id: null,
  entry_date: '2026-10-01',
  entry_price: 10,
  shares: 10,
  stop: 9,
  target: 12,
  exit_date: '2026-10-05',
  exit_price: win ? 11 : 9.5,
  checklist: {},
  checklist_version: 'checklist-2',
  followed: {},
  notes: '',
  screenshots: [],
});

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json([
        {
          id: 1,
          ticker: 'RKLB',
          shares: 100,
          cost_basis: 24,
          opened_on: '2026-09-01',
          stop: 22,
          targets: [30],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: 'XLI',
          thesis_status: 'intact',
          horizon: 'swing',
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
          sector_etf: null,
          thesis_status: 'intact',
          horizon: null,
        },
        {
          id: 3,
          ticker: 'KO',
          shares: 50,
          cost_basis: 60,
          opened_on: '2026-08-03',
          stop: 55,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: 'XLP',
          thesis_status: 'intact',
          horizon: 'long',
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const tk = new URL(r.request().url()).searchParams.get('ticker')?.replace(/^eq\./, '') ?? '';
    return r.fulfill(json(CLOSES[tk] ? barsOf(tk) : []));
  });
  await page.route('**/rest/v1/briefs**', (r) => r.fulfill(json([{ for_date: '2026-11-27' }])));
  await page.route('**/rest/v1/company_research**', (r) => r.fulfill(json([research])));
  await page.route('**/rest/v1/instruments**', (r) =>
    r.fulfill(
      json([
        { ticker: 'KO', name: 'Coca-Cola Co', cik: '0000021344' },
        { ticker: 'RKLB', name: 'Rocket Lab Corp', cik: '0001819994' },
      ]),
    ),
  );
  await page.route('**/rest/v1/dividends**', (r) =>
    r.fulfill(
      json(
        ['2025-12-12', '2026-03-13', '2026-06-12', '2026-09-12', '2026-12-01'].map((d, i) => ({
          ticker: 'KO',
          ex_dividend_date: d,
          pay_date: i === 4 ? '2026-12-15' : null,
          cash_amount: i === 4 ? 0.52 : 0.51,
          frequency: 4,
          fetched_at: '2026-11-27T22:00:00Z',
        })),
      ),
    ),
  );
  await page.route('**/rest/v1/trades**', (r) =>
    r.fulfill(json(Array.from({ length: 16 }, (_x, i) => trade(i + 1, i < 4)))),
  );
  await page.route('**/rest/v1/news_articles**', (r) =>
    r.fulfill(
      json([
        {
          id: 'n1',
          published_at: '2026-11-27T13:05:00Z',
          publisher: 'Example Wire',
          title: 'Rocket Lab sets a launch date',
          url: 'https://example.com/rklb',
          tickers: ['RKLB'],
          description: 'The company named a date for its next launch.',
        },
        {
          id: 'n2',
          published_at: '2026-11-26T10:00:00Z',
          publisher: 'Other Desk',
          title: 'Soft drinks volumes',
          url: 'https://example.com/ko',
          tickers: ['KO'],
          description: null,
        },
      ]),
    ),
  );
}

/** Opens the Portfolio page (ADR 0048: its own page now) and taps one view on its switch. */
async function openPortfolio(page: Page, view: string) {
  await page.goto('/portfolio');
  await page
    .getByRole('group', { name: 'Portfolio view' })
    .getByRole('button', { name: view })
    .click();
}

test('portfolio review: open risk with risk unknown, the council limits, holdings without rules first', async ({
  page,
}) => {
  await stub(page);
  await openPortfolio(page, 'Review');
  const card = page.getByRole('region', { name: 'Review', exact: true });
  // Equity 2,900 + 662 + 3,125 = 6,687; risk to stops 700 (RKLB) + 375 (KO) = 1,075, 16.1%. SOFI has no stop.
  await expect(card).toContainText('16.1%');
  await expect(card).toContainText('+ risk unknown on 1');
  await expect(card).toContainText('$1,075 lost if every stop fills exactly, of $6,687 equity');
  await expect(card).toContainText('Risk unknown, not counted as zero (no stop): SOFI.');
  const limits = card.getByRole('list', { name: 'Your limits against the book' });
  await expect(limits.getByRole('listitem').filter({ hasText: 'Largest position' })).toContainText(
    '46.7%',
  );
  await expect(limits.getByRole('listitem').filter({ hasText: 'Cash' })).toContainText(
    'Not tracked',
  );
  await expect(limits.getByRole('listitem').filter({ hasText: 'Total open risk' })).toContainText(
    'limit 6.0%',
  );
  const breaches = card.getByRole('list', { name: 'Breaches' });
  await expect(breaches).toContainText(
    'Largest position (KO): 46.7% of equity; your limit is 20.0%.',
  );
  await expect(breaches).toContainText('Top 5 positions: 100.0% of equity; your limit is 60.0%.');
  await expect(card).toContainText(
    'Set by the council at your request on 28 Nov 2026; change any time',
  );
  await expect(card).not.toContainText(/Marsad default/i);
  const rows = card.getByRole('list', { name: 'Holdings by exit plan' }).getByRole('listitem');
  await expect(rows.first()).toContainText('SOFI');
  await expect(rows.first()).toContainText('Exit rules missing');
  const rklb = rows.filter({ hasText: 'RKLB' });
  // 1% of 6,687 over a 7.00 stop distance: 9 shares; the 25% cap would allow 57.
  await expect(rklb).toContainText(
    'The sizer allows 9 shares at today’s close and stop; you hold 100.',
  );
  await expect(rklb).toContainText('$700');
  // "Size a trade" opens Journal's sizer with the ticker filled in (ADR 0048).
  await expect(rklb.getByRole('link', { name: 'Size a trade in RKLB' })).toHaveAttribute(
    'href',
    '/journal?view=sizer&ticker=RKLB',
  );
  // Weekly moves: RKLB 26.40 to 29.00 over five sessions.
  await card
    .getByRole('group', { name: 'Review section' })
    .getByRole('button', { name: 'Weekly moves' })
    .click();
  await expect(card).toContainText('▲ +9.8%');
  await expect(card).toContainText('no alert is raised from this page');
  await card
    .getByRole('group', { name: 'Review section' })
    .getByRole('button', { name: 'Coming up' })
    .click();
  await expect(card).toContainText('Ex-dividend');
  await expect(card).toContainText('0.52 a share');
});

test('portfolio review: limits saved in Settings replace the council values and say who set them', async ({
  page,
}) => {
  await stub(page);
  // Khaled's own row (Settings): largest position raised to 50%, the top-5 limit cleared.
  await page.route('**/rest/v1/portfolio_limits**', (r) =>
    r.fulfill(
      json([
        {
          largest_position: 0.5,
          top5: null,
          min_cash: '0.1',
          portfolio_beta: '1.5',
          open_risk: 0.06,
          set_by: 'user',
          set_on: '2026-11-29',
          version: 2,
        },
      ]),
    ),
  );
  await openPortfolio(page, 'Review');
  const card = page.getByRole('region', { name: 'Review', exact: true });
  const limits = card.getByRole('list', { name: 'Your limits against the book' });
  // KO at 46.7% of equity is inside a 50% limit; the cleared top-5 limit reads "No limit set".
  await expect(limits.getByRole('listitem').filter({ hasText: 'Largest position' })).toContainText(
    'limit 50.0%',
  );
  await expect(limits.getByRole('listitem').filter({ hasText: 'Top 5 positions' })).toContainText(
    'No limit set',
  );
  const breaches = card.getByRole('list', { name: 'Breaches' });
  await expect(breaches).not.toContainText('Largest position');
  await expect(breaches).not.toContainText('Top 5 positions');
  await expect(card).toContainText('Set by you on 29 Nov 2026; change any time');
  await expect(card).not.toContainText('Set by the council');
  await expect(card.getByRole('link', { name: 'Change them in Settings' })).toHaveAttribute(
    'href',
    '/settings?view=prefs',
  );
});

test('portfolio holdings: summary, the chart label, five column sets and no analyst column', async ({
  page,
}) => {
  await stub(page);
  await openPortfolio(page, 'Holdings');
  await expect(page.getByRole('region', { name: 'Portfolio summary' })).toContainText('$6,687');
  await expect(
    page.getByText('Current holdings at today’s weights, not your actual result'),
  ).toBeVisible();
  const sets = page.getByRole('group', { name: 'Columns' });
  await expect(sets.getByRole('button')).toHaveCount(5);
  await expect(sets.getByRole('button', { name: 'Analyst' })).toHaveCount(0);
  await sets.getByRole('button', { name: 'Dividends' }).click();
  const table = page.getByRole('region', { name: 'Holdings table, Dividends columns' });
  const ko = table.getByRole('row').filter({ hasText: 'KO' });
  // Four 0.51 payments in the 365 days to 27 Nov: 2.04 a share, 3.3% of 62.50, $102 on 50 shares.
  await expect(ko).toContainText('2.04');
  await expect(ko).toContainText('3.3%');
  await expect(ko).toContainText('$102');
  await expect(table.getByRole('row').filter({ hasText: 'SOFI' })).toContainText('None stored');
  // Technicals come from the one technical engine (technical-1), named under the table.
  await sets.getByRole('button', { name: 'Technicals' }).click();
  const tech = page.getByRole('region', { name: 'Holdings table, Technicals columns' });
  for (const head of ['Readings', 'vs SMA 50', 'vs SMA 200', 'RSI 14'])
    await expect(tech.getByRole('columnheader', { name: head })).toBeVisible();
  await expect(page.getByText(/From the one technical engine \(technical-1\)/)).toBeVisible();
});

test('portfolio analysis: rules beside each card, P/E coverage, unavailable sources named', async ({
  page,
}) => {
  await stub(page);
  await openPortfolio(page, 'Analysis');
  const card = page.getByRole('region', { name: 'Analysis', exact: true });
  await expect(card).toContainText('Written by Marsad from the numbers above');
  await card
    .getByRole('group', { name: 'Analysis section' })
    .getByRole('button', { name: 'Needs attention' })
    .click();
  const loss = card
    .getByRole('listitem')
    .filter({ hasText: 'One position holds a large share of the loss' });
  await expect(loss).toContainText(
    'Rule: one position holding more than 25.0% of the total unrealized loss.',
  );
  await expect(loss).toContainText('Exit rules missing');
  await expect(card).not.toContainText(/target/i);
  await expect(card).not.toContainText(/consider|trim|worth holding/i);
  await card
    .getByRole('group', { name: 'Analysis section' })
    .getByRole('button', { name: 'Distribution' })
    .click();
  await expect(card).toContainText('Coverage: 1 of 3 holdings');
  await expect(card).toContainText('Not meaningful (negative, zero or missing P/E): KO, SOFI.');
  await expect(card).toContainText('Geographic allocation: not available, no source.');
  await expect(card).toContainText('Marsad has no other-investor data');
});

test('portfolio performance: below 30 closed trades, counts and no percentage', async ({
  page,
}) => {
  await stub(page);
  await openPortfolio(page, 'Performance');
  const card = page.getByRole('region', { name: 'Performance', exact: true });
  await expect(card).toContainText('4 of 16 closed trades were profitable');
  await expect(card).toContainText('Insufficient history (16 of 30 closed trades): counts only.');
  const trades = card.locator('dl').first();
  await expect(trades).not.toContainText('%');
  await expect(card).toContainText('Current holdings at today’s weights, not your actual result');
});

test('portfolio income and news: net of withholding; a reading pane with a link out', async ({
  page,
}) => {
  await stub(page);
  await openPortfolio(page, 'Income');
  const income = page.getByRole('region', { name: 'Income', exact: true });
  // KO: 0.52 x 4 = 2.08 a share on 50 shares, $104 gross, $72.80 net; 2.08 / 60.00 = 3.5% on cost gross,
  // 2.08 x 0.7 / 60.00 = 2.4% net.
  const ko = income.getByRole('row').filter({ hasText: 'KO' });
  await expect(ko).toContainText('$104');
  await expect(ko).toContainText('$73');
  await expect(ko).toContainText('2.4% (3.5%)');
  const rate = income.getByLabel(
    'US withholding, 30% (no US and Saudi treaty), editable; check your Sahm statement',
  );
  await expect(rate).toHaveValue('30');
  // 15% withheld: 104 x 0.85 = $88.40; 2.08 x 0.85 / 60.00 = 2.9% on cost.
  await rate.fill('15');
  await expect(ko).toContainText('$88');
  await expect(ko).toContainText('2.9% (3.5%)');
  // Not a rate: net figures are withheld rather than guessed.
  await rate.fill('150');
  await expect(income).toContainText('Enter a percent from 0 to 100');
  await expect(ko).not.toContainText('$88');
  await rate.fill('30');
  await expect(income).toContainText('the US has no income tax treaty with Saudi Arabia');
  await page
    .getByRole('group', { name: 'Portfolio view' })
    .getByRole('button', { name: 'News' })
    .click();
  const news = page.getByRole('region', { name: 'Holdings news' });
  await news.getByLabel('Search titles and descriptions').fill('launch');
  await expect(news.getByRole('list', { name: 'Articles' }).getByRole('listitem')).toHaveCount(1);
  await news.getByRole('button', { name: /Rocket Lab sets a launch date/ }).click();
  const pane = news.getByRole('region', { name: 'Reading pane' });
  await expect(pane).toContainText('The company named a date for its next launch.');
  await expect(pane.getByRole('link', { name: 'Read at Example Wire' })).toHaveAttribute(
    'href',
    'https://example.com/rklb',
  );
  await expect(pane.locator('img')).toHaveCount(0);
});

test('watch dividends: the day strip, an ex-date with its yield, and an empty day', async ({
  page,
}) => {
  await stub(page);
  // Watchlist only: the dividend view takes watchlist and holdings tickers alike, and Watch loads faster without a book.
  await page.route('**/rest/v1/holdings**', (r) => r.fulfill(json([])));
  // The Watch brief card reads full brief rows; the owner probe only needs one row, so leave briefs empty here.
  await page.route('**/rest/v1/briefs**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/watchlist_items**', (r) =>
    r.fulfill(json([{ ticker: 'KO', position: 0, sector_etf: null }])),
  );
  await page.goto('/');
  await page
    .getByRole('group', { name: 'News, calendar or dividends' })
    .getByRole('button', { name: 'Dividends' })
    .click();
  const card = page.getByRole('region', { name: 'Ex-dividend calendar' });
  await expect(card).toContainText('No ex-dividend dates for your tickers on this day');
  // The strip scrolls sideways inside the card, never the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 1280,
  );
  const dec1 = card.getByRole('button', { name: /01 Dec.*1 ex-dividend date/ });
  await dec1.focus();
  await page.keyboard.press('Enter');
  await expect(dec1).toHaveAttribute('aria-pressed', 'true');
  // 0.52 x 4 = 2.08 over the 62.50 close: 3.33%.
  await expect(card).toContainText('0.52 a share');
  await expect(card).toContainText('quarterly');
  await expect(card).toContainText('yield 3.33%');
  await expect(card).toContainText('Coca-Cola Co');
});
