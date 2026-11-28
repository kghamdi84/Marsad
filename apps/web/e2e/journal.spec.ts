import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedSession, scanAfterEach, openTab } from './helpers';

scanAfterEach();

/** Portfolio's view switch (the holdings, options and exposure moved there from Journal, ADR 0048). */
const portfolioView = (page: Page, name: string) =>
  page
    .getByRole('group', { name: 'Portfolio view' })
    .getByRole('button', { name, exact: true })
    .click();

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
  await openTab(page, 'Sizer and Sahm ticket');
  const sizer = page.getByRole('region', { name: 'Pre-trade checklist and position sizer' });
  await expect(sizer.getByTestId('sahm-ticket')).toHaveText('Fill in ticker, entry and stop');
  await sizer.getByLabel('Ticker').fill('rklb');
  await sizer.getByLabel('Account ($)').fill('50000');
  await sizer.getByLabel('Risk per trade (%)').fill('0.5');
  await sizer.getByLabel('Limit entry').fill('24.15');
  await sizer.getByLabel('Stop', { exact: true }).fill('22.15');
  await sizer.getByLabel('Targets').fill('28.15 30.15');
  // USD 250 at risk over a 2.00 stop distance: 125 shares, USD 3,018.75 (6.0% of the account); 2.0R and 3.0R.
  for (const [label, value] of [
    ['Shares', '125'],
    ['Dollar risk', '$250'],
    ['Position', '$3,019'],
    ['Position', '6.0% of account'],
    ['Reward to risk', '2.0R'],
  ])
    await expect(sizer.getByText(label, { exact: true }).locator('..')).toContainText(value);
  await expect(sizer.getByText(/28\.15 = 2\.0R/)).toBeVisible();
  await expect(sizer.getByText(/30\.15 = 3\.0R/)).toBeVisible();
  await expect(sizer.getByTestId('sahm-ticket')).toHaveText(
    'BUY 125 RKLB LIMIT 24.15 STOP 22.15 GTC',
  );
  const copy = sizer.getByRole('button', { name: /^Copy Sahm order ticket/ });
  await expect(copy).toHaveText('Copy Sahm order ticket (0 of 7 checks)');
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
  // Six of seven is still not enough: the copy stays disabled (hard rule).
  const boxes = await sizer.getByRole('checkbox').all();
  expect(boxes).toHaveLength(7);
  // The ticket uses checklist-3: checklist-2's five checks, then risk defined and the profit plan in checklist-1's
  // words (ADR 0048 round 2).
  for (const [i, label] of [
    'Fits the current regime',
    'Stop set from structure, not hope',
    'Bear case and earnings date read',
    'Shariah aid checked',
    'Order will be entered by hand in Sahm',
    'Risk is defined: the stop is set and the size comes from it.',
    'There is a profit plan: targets and when to take them.',
  ].entries())
    await expect(boxes[i] as Locator).toHaveAccessibleName(label);
  for (const box of boxes.slice(0, 6)) await box.click();
  await expect(copy).toHaveText('Copy Sahm order ticket (6 of 7 checks)');
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
  await boxes[6]?.click();
  await expect(copy).toHaveText('Copy Sahm order ticket');
  await expect(copy).toHaveAttribute('aria-disabled', 'false');
  // Unticking one disables it again.
  await boxes[0]?.click();
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
});

test('journal: "Risk defined" needs a stop and a ticket no bigger than the sizer allows; copy stays blocked until then', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.goto('/journal?view=sizer&ticker=RKLB');
  const sizer = page.getByRole('region', { name: 'Pre-trade checklist and position sizer' });
  await expect(sizer.getByLabel('Ticker')).toHaveValue('RKLB');
  const risk = sizer.getByRole('checkbox', { name: /^Risk is defined/ });
  const copy = sizer.getByRole('button', { name: /^Copy Sahm order ticket/ });
  // No stop yet: the item cannot be ticked, and says why.
  await expect(risk).toHaveAttribute('aria-disabled', 'true');
  await expect(risk).toHaveAccessibleDescription(
    'Enter a stop first: risk is defined only by a stop.',
  );
  // A tap does nothing (force: Playwright itself waits for an enabled control).
  await risk.click({ force: true });
  await expect(risk).toHaveAttribute('aria-checked', 'false');
  // Every other item ticked: still blocked (6 of 7).
  for (const box of await sizer.getByRole('checkbox').all())
    if ((await box.getAttribute('aria-disabled')) !== 'true') await box.click();
  await expect(copy).toHaveText('Copy Sahm order ticket (6 of 7 checks)');
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
  // 1% of 50,000 over a 2.00 stop distance: the sizer allows 250 shares (the 25% cap allows 517).
  await sizer.getByLabel('Limit entry').fill('24.15');
  await sizer.getByLabel('Stop', { exact: true }).fill('22.15');
  await expect(sizer.getByText('Shares', { exact: true }).locator('..')).toContainText('250');
  // A ticket bigger than the sizer's result: still locked, with both numbers.
  await sizer.getByLabel('Shares on the ticket').fill('300');
  await expect(sizer.getByTestId('sahm-ticket')).toHaveText(
    'BUY 300 RKLB LIMIT 24.15 STOP 22.15 GTC',
  );
  await expect(risk).toHaveAttribute('aria-disabled', 'true');
  await expect(risk).toHaveAccessibleDescription(
    'The ticket buys 300 shares; the sizer allows 250 for this stop.',
  );
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
  // Fewer shares than the sizer allows: it can be ticked, and the copy opens.
  await sizer.getByLabel('Shares on the ticket').fill('200');
  await expect(risk).not.toHaveAttribute('aria-disabled', 'true');
  await risk.click();
  await expect(risk).toHaveAttribute('aria-checked', 'true');
  await expect(copy).toHaveText('Copy Sahm order ticket');
  await expect(copy).toHaveAttribute('aria-disabled', 'false');
  // Changing the stop clears it: the size must be confirmed again.
  await sizer.getByLabel('Stop', { exact: true }).fill('23.15');
  await expect(risk).toHaveAttribute('aria-checked', 'false');
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
});

test('portfolio holdings: the result and triggered exits; a CSV with mistakes names them', async ({
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
  await page.goto('/portfolio?view=holdings');
  const holdings = page.getByRole('region', { name: 'Holdings and exit conditions' });
  const rklb = holdings.getByRole('listitem').filter({ hasText: 'RKLB' });
  // 21.50 against a 24.00 cost: ▼ −$250 and −10.4% (design format); the stop and the trend break both triggered.
  await expect(rklb).toContainText('\u25BC \u2212$250');
  await expect(rklb).toContainText('\u221210.4%');
  await expect(rklb).toContainText('Stop hit');
  // The rules line: (25 + 24 + 21.5) / 3 = 23.50.
  await expect(rklb).toContainText('Trend break: closed under the 3-day 23.50');
  await expect(rklb).toContainText('Triggered: Closed at 21.50, at or below the stop 22.00.');
  await expect(rklb).toContainText('below the 3-day SMA');
  await expect(holdings.getByRole('listitem').filter({ hasText: 'SOFI' })).toContainText(
    'No exit conditions set: add a stop and a target.',
  );

  // The CSV import sits behind a button (design).
  await expect(page.getByLabel('Add from CSV')).toHaveCount(0);
  await page.getByRole('button', { name: 'Import Sahm CSV' }).click();
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

  // A row already stored (RKLB, same lot) is greyed in the preview and skipped.
  await page
    .getByLabel('Add from CSV')
    .fill('ticker,shares,cost_basis,opened_on\nRKLB,100,24,2026-10-01\nHOOD,5,30,2026-11-02');
  await expect(page.getByText('Already stored, skipped')).toBeVisible();
  await expect(page.getByText('1 to add, 1 skipped as already stored.')).toBeVisible();
});

test('portfolio: exposure, stress and rotation from stored bars; sector and thesis are saved', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // SPY returns alternate +1% and -0.5%; XLI moves with SPY; RKLB returns are exactly 2 x SPY's minus 0.4% a day,
  // so its beta to SPY and to XLI is exactly 2, and it lags both. The VIX moves -100 points per unit SPY return,
  // so RKLB's sensitivity is -0.02 a point: +10 points is -20%. One holding: every scenario is -20% x its weight.
  const n = 300;
  const r = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
  const series = (start: number, f: (x: number) => number) => {
    const out = [start];
    for (let i = 1; i < n; i++) out.push((out[i - 1] as number) * (1 + f(r[i] as number)));
    return out;
  };
  const day = (i: number) =>
    new Date(Date.UTC(2025, 5, 2) + i * 86_400_000).toISOString().slice(0, 10);
  const closes: Record<string, number[]> = {
    SPY: series(500, (x) => x),
    XLI: series(120, (x) => x),
    RKLB: series(20, (x) => 2 * x - 0.004),
  };
  let vix = 20;
  const vixRows = Array.from({ length: n }, (_, i) => {
    if (i > 0) vix += -100 * (r[i] as number);
    return { date: day(i), value: vix };
  });
  let patched: unknown = null;
  await page.route('**/rest/v1/**', (rt) => rt.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (rt) => {
    if (rt.request().method() === 'PATCH') {
      patched = rt.request().postDataJSON();
      return rt.fulfill({ status: 204, body: '' });
    }
    return rt.fulfill(
      json([
        {
          id: 1,
          ticker: 'RKLB',
          shares: 100,
          cost_basis: 20,
          opened_on: '2026-01-02',
          stop: null,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: 'XLI',
          thesis_status: 'weakening',
          horizon: 'swing',
        },
      ]),
    );
  });
  await page.route('**/rest/v1/daily_bars**', (rt) => {
    const t = new URL(rt.request().url()).searchParams.get('ticker')?.replace(/^eq\./, '') ?? '';
    return rt.fulfill(
      json(
        (closes[t] ?? [])
          .map((close, i) => ({
            date: day(i),
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
  await page.route('**/rest/v1/fred_observations**', (rt) =>
    rt.fulfill(json([...vixRows].reverse())),
  );
  await page.goto('/portfolio?view=analysis');
  const exposure = page.getByRole('region', { name: 'Exposure', exact: true });
  await expect(exposure).toContainText('Beta to SPY 2.00');
  // One holding, so every scenario is -20% of its value: 100 shares at the last RKLB close.
  const loss = `▼ −$${Math.round((closes.RKLB?.at(-1) ?? 0) * 100 * 0.2).toLocaleString('en-US')}`;
  for (const name of ['SPY down 10%', 'VIX up 10 points', 'Industrials (XLI) down 10%'])
    await expect(exposure.getByRole('listitem').filter({ hasText: name })).toContainText(loss);
  await expect(exposure.getByRole('listitem').filter({ hasText: 'SPY down 10%' })).toContainText(
    '−20.0% of portfolio',
  );
  await expect(
    exposure.getByRole('listitem').filter({ hasText: 'Industrials' }).first(),
  ).toContainText('100.0%');
  // The KPI strip reads the same beta.
  await expect(page.getByRole('region', { name: 'Portfolio at a glance' })).toContainText(
    'Beta to SPY2.00100% more than the market',
  );

  await portfolioView(page, 'Holdings');
  // RKLB lags XLI and SPY with a weakening thesis: the card flags a rotation, the edit sheet says why.
  await expect(page.getByText('Rotate to XLI?')).toBeVisible();
  // The horizon is the owner's choice, shown as a pill and changed under Edit holding.
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'RKLB' })
      .locator('span')
      .filter({ hasText: /^Swing$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit holding' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'and the thesis is weakening. Consider XLI or SPY instead.',
  );
  await page.getByRole('dialog').getByLabel('Horizon').selectOption('long');
  await expect.poll(() => patched).toEqual({ horizon: 'long' });
  await page.keyboard.press('Escape');
  // The thesis pill moves on one step per tap: weakening to broken.
  await page.getByRole('button', { name: 'Thesis weakening, tap to change' }).click();
  await expect.poll(() => patched).toEqual({ sector_etf: 'XLI', thesis_status: 'broken' });
});

test('journal: trades with adherence, statistics by setup, logging, exits and private screenshots', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  const OWNER = '00000000-0000-4000-8000-00000000000a';
  // A 1 x 1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const all5 = {
    cleanSetup: true,
    notExtended: true,
    riskDefined: true,
    profitPlan: true,
    bearCaseRead: true,
  };
  const trades = [
    {
      id: 1,
      ticker: 'RKLB',
      side: 'long',
      setup: 'trend-template-breakout',
      tags: [],
      alert_id: null,
      entry_date: '2026-11-02',
      entry_price: 24,
      shares: 100,
      stop: 22,
      target: 30,
      exit_date: '2026-11-10',
      exit_price: 28,
      checklist: all5,
      followed: { stopPlaced: true, sizedBySizer: true, exitedPerPlan: true, noEmotion: false },
      notes: 'Took profits at the plan.',
      screenshots: [`${OWNER}/trade-1-1.png`],
    },
    {
      id: 2,
      ticker: 'SOFI',
      side: 'long',
      setup: '',
      tags: [],
      alert_id: null,
      entry_date: '2026-11-20',
      entry_price: 18,
      shares: 50,
      stop: 17,
      target: null,
      exit_date: null,
      exit_price: null,
      checklist: {},
      followed: {},
      notes: '',
      screenshots: [],
    },
  ];
  const writes: { method: string; url: string; body: unknown }[] = [];
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/trades**', (r) => {
    const m = r.request().method();
    if (m === 'GET')
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(trades),
      });
    writes.push({ method: m, url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({ status: m === 'POST' ? 201 : 204, body: '' });
  });
  await page.route('**/storage/v1/object/**', (r) => {
    const m = r.request().method();
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'image/png', body: png });
    writes.push({ method: m, url: r.request().url(), body: null });
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Key: 'journal/x', Id: 'x' }),
    });
  });
  await page.goto('/journal');
  await openTab(page, 'Trades');
  const section = page.getByRole('region', { name: 'Trades and adherence' });
  // RKLB: (28 - 24) / (24 - 22) = 2R, USD 400; 10 items, noEmotion not honored: 9 of 10 = 90.
  // The design's rows: result in R and whether the plan was followed (80 or more); a tap opens the full card.
  const rklbRow = section.getByRole('button', { name: /^RKLB/ });
  await expect(rklbRow).toContainText('▲ +2.0R');
  await expect(rklbRow).toContainText('Followed plan');
  await expect(section.getByText('Adherence 45', { exact: true })).toBeVisible(); // (90 + 0) / 2
  await expect(section).toContainText('1 of 2 trades followed the plan');
  await rklbRow.click();
  const rklb = page.getByRole('dialog', { name: 'RKLB trade' });
  await expect(rklb).toContainText('Result ▲ +2.00R, USD ▲ +400.00.');
  await expect(rklb).toContainText('Adherence 90 (9 of 10 items).');
  await expect(rklb).toContainText('No chasing, no revenge trade, no moving the stop away.');
  await expect(rklb.getByRole('img', { name: 'Screenshot 1 of the RKLB trade' })).toBeVisible();
  await page.keyboard.press('Escape');
  // SOFI is open, unnamed, nothing ticked: 0 of 9.
  const sofiRow = section.getByRole('button', { name: /^SOFI/ });
  await expect(sofiRow).toContainText('Open');
  await expect(sofiRow).toContainText('Broke plan');
  // One closed trade: no win rate, which would be a percentage from fewer than 30 cases.
  const all = section.getByRole('listitem').filter({ hasText: 'All trades' });
  await expect(all).toContainText('Insufficient history (1 of 30)');
  await expect(all).not.toContainText('%');
  await expect(section).toContainText('Each group needs 30 closed trades');

  await sofiRow.click();
  const sofi = page.getByRole('dialog', { name: 'SOFI trade' });
  await expect(sofi).toContainText('Adherence 0 (0 of 9 items).');
  await sofi.getByLabel('Add a screenshot (PNG, JPEG or WebP, up to 5 MB)').setInputFiles({
    name: 'chart.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect
    .poll(() => writes.find((w) => w.url.includes('/storage/'))?.url ?? '')
    .toContain(`/journal/${OWNER}/trade-2-1.png`);
  await expect
    .poll(() => writes.find((w) => w.method === 'PATCH')?.body)
    .toMatchObject({ screenshots: [`${OWNER}/trade-2-1.png`] });

  await sofi.getByLabel('Exit price').fill('19.5');
  await sofi.getByLabel('The exit followed the plan.').check();
  await sofi.getByRole('button', { name: 'Record exit' }).click();
  await expect
    .poll(() => writes.filter((w) => w.method === 'PATCH').at(-1)?.body)
    .toMatchObject({ exit_price: 19.5, followed: { exitedPerPlan: true } });

  await page.keyboard.press('Escape');
  await section.getByRole('button', { name: 'Log a trade' }).click();
  const form = page.getByRole('form', { name: 'Log a trade' });
  await form.getByLabel('Ticker').fill('nvda');
  await form.getByLabel('Entry price').fill('180');
  await form.getByLabel('Shares', { exact: true }).fill('10');
  await form.getByLabel('Setup (playbook or your own name)').fill('trend-template-breakout');
  await form.getByLabel('The stop was placed in Sahm when the order filled.').check();
  // New trades answer checklist-3 (ADR 0048 round 2) and say so.
  await form.getByLabel('Fits the current regime').check();
  await form.getByLabel('Order will be entered by hand in Sahm').check();
  await expect(form.getByLabel(/The setup is clean/)).toHaveCount(0);
  await form.getByRole('button', { name: 'Save trade' }).click();
  await expect
    .poll(() => writes.find((w) => w.method === 'POST' && w.url.includes('/rest/v1/trades'))?.body)
    .toMatchObject({
      ticker: 'NVDA',
      entry_price: 180,
      shares: 10,
      setup: 'trend-template-breakout',
      checklist: { regimeFit: true, manualInSahm: true },
      checklist_version: 'checklist-3',
      followed: { stopPlaced: true },
    });
});

test('journal: the latest weekly review, or when the first one is due', async ({ page }) => {
  await seedSession(page, 'aal2');
  let rows: unknown[] = [];
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/rest/v1/briefs**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }),
  );
  // SPY closes 500.00 on Friday 20 Nov and 510.00 on Friday 27 Nov: +2.0% over the week ending 29 Nov.
  await page.route('**/rest/v1/daily_bars**', (r) =>
    r.fulfill(
      json(
        [
          ['2026-11-27', 510],
          ['2026-11-23', 505],
          ['2026-11-20', 500],
        ].map(([date, close]) => ({
          date,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1,
          vwap: null,
        })),
      ),
    ),
  );
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json([
        { ticker: 'NVDA', shares: 10, opened_on: '2026-01-02', closed_on: null },
        { ticker: 'AAPL', shares: 5, opened_on: '2026-11-24', closed_on: null },
      ]),
    ),
  );
  await page.goto('/journal');
  await openTab(page, 'Weekly review');
  await expect(page.getByText('The first weekly review is written on Sunday')).toBeVisible();
  rows = [
    {
      title: 'Weekly review, week ending 2026-11-29',
      for_date: '2026-11-29',
      sections: [{ heading: 'Behavior', lines: ['Mean adherence 86 over 3 trades.'] }],
      // The stored inputs: one trade closed in the week at +2R (24 to 28, stop 22), nothing ticked.
      inputs: {
        weekEnding: '2026-11-29',
        trades: [
          {
            id: 1,
            ticker: 'RKLB',
            side: 'long',
            setup: 'trend',
            tags: [],
            alertId: null,
            entryDate: '2026-11-24',
            entryPrice: 24,
            shares: 100,
            stop: 22,
            target: null,
            exitDate: '2026-11-27',
            exitPrice: 28,
            checklist: {},
            followed: {},
            notes: '',
            screenshots: [],
          },
        ],
      },
    },
  ];
  await page.reload();
  const review = page.getByRole('region', { name: 'Weekly review, week ending 2026-11-29' });
  await expect(review).toContainText('Mean adherence 86 over 3 trades.');
  // The design's tiles, computed from the stored inputs.
  await expect(review.getByText('Trades closed').locator('..')).toContainText('1');
  await expect(review.getByText('Plan followed').locator('..')).toContainText('0 of 1');
  await expect(review.getByText('Mean result').locator('..')).toContainText('▲ +2.00R');
  await expect(review.getByText('SPY', { exact: true }).locator('..')).toContainText(
    '▲ +2.0%Close 20 Nov to 27 Nov',
  );
  // The portfolio's week (held-week-1): NVDA held all week, 500 to 510 on the same closes as SPY, is +2.0%;
  // AAPL bought inside the week is left out and counted.
  await expect(review.getByText('Portfolio', { exact: true }).locator('..')).toContainText(
    '▲ +2.0%1 held all week; 1 bought or sold inside it, left out',
  );
});

test('options positions: the stored spread with its risk, exit rules and bear case; a naked call is refused', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // Fix the date so days to expiry are known: 2026-11-25 to 2026-12-18 is 23 days.
  await page.clock.setFixedTime(new Date('2026-11-25T15:00:00Z'));
  const posted: unknown[] = [];
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/option_positions**', (r) => {
    if (r.request().method() === 'POST') {
      posted.push(r.request().postDataJSON());
      return r.fulfill({ status: 201, body: '' });
    }
    return r.fulfill(
      json([
        {
          id: 1,
          underlying: 'NVDA',
          label: 'Bull call spread',
          expiry: '2026-12-18',
          legs: [
            { type: 'call', strike: 100, qty: 1, price: 5 },
            { type: 'call', strike: 110, qty: -1, price: 2 },
          ],
          opened_on: '2026-11-20',
          exit_dte: 21,
          profit_take_pct: 0.5,
          loss_limit_pct: null,
          bear_case: 'A data-center miss takes NVDA below 100.',
        },
      ]),
    );
  });
  await page.route('**/rest/v1/daily_bars**', (r) =>
    r.fulfill(json([{ date: '2026-11-24', close: 105 }])),
  );
  await page.goto('/portfolio?view=holdings');
  const s = page.getByRole('region', { name: 'Options positions' });
  const card = s.getByRole('listitem').filter({ hasText: 'Bull call spread' });
  // Debit 300, maximum gain 700, breakeven 103; at 105 the spread is worth +200 at expiry.
  await expect(card).toContainText('Long 100 C, short 110 C · 1 contract');
  await expect(card).toContainText('23 days to expiry');
  await expect(
    card.getByRole('img', { name: 'Maximum loss $300, maximum gain $700' }),
  ).toBeVisible();
  await expect(card).toContainText('Breakeven 103.00 · expires 18 Dec 2026 · defined risk only');
  await card.getByRole('button', { name: 'Details' }).click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByText('Debit $300.00. Maximum loss -$300.00; maximum gain $700.00.'),
  ).toBeVisible();
  await expect(sheet.getByText('Breakeven at expiry: 103.00.')).toBeVisible();
  await expect(sheet.getByText('23 days to expiry (2026-12-18).')).toBeVisible();
  await expect(
    sheet.getByText('At expiry, if the stock stays at 105.00 (close 2026-11-24): $200.00'),
  ).toBeVisible();
  await expect(sheet.getByText('Value today: unavailable (needs option quotes)')).toBeVisible();
  await expect(sheet.getByText('Time exit at 21 days to expiry (now 23).')).toBeVisible();
  await expect(
    sheet.getByText(
      'Profit take at 50% of the maximum gain ($350.00); needs option quotes to judge.',
    ),
  ).toBeVisible();
  await expect(sheet.getByText('A data-center miss takes NVDA below 100.')).toBeVisible();
  await page.keyboard.press('Escape');

  await s.getByRole('button', { name: 'Add an options position' }).click();
  const form = page.getByRole('form', { name: 'Add an options position' });
  await form.getByLabel('Underlying ticker').fill('rklb');
  await form.getByLabel('Name (for example, Bull call spread)').fill('Short call');
  await form.getByLabel('Expiry (YYYY-MM-DD)').fill('2027-01-15');
  await form.getByLabel('Side').selectOption('short');
  await form.getByLabel('Strike').fill('30');
  await form.getByLabel('Premium per share').fill('1.2');
  await form.getByLabel('Bear case: what makes this position lose').fill('A squeeze above 30.');
  await form.getByRole('button', { name: 'Save position' }).click();
  await expect(
    form.getByText('The maximum loss is unlimited. Marsad tracks defined-risk positions only.'),
  ).toBeVisible();
  expect(posted).toEqual([]);

  // Add a long 35 call: a bear call spread, defined risk.
  await form.getByRole('button', { name: 'Add a leg' }).click();
  await form.getByLabel('Strike').nth(1).fill('35');
  await form.getByLabel('Premium per share').nth(1).fill('0.4');
  await form.getByRole('button', { name: 'Save position' }).click();
  await expect(form.getByText('Position saved.')).toBeVisible();
  expect(posted[0]).toMatchObject({
    underlying: 'RKLB',
    label: 'Short call',
    expiry: '2027-01-15',
    legs: [
      { type: 'call', strike: 30, qty: -1, price: 1.2 },
      { type: 'call', strike: 35, qty: 1, price: 0.4 },
    ],
    exit_dte: 21,
    profit_take_pct: 0.5,
    loss_limit_pct: null,
    bear_case: 'A squeeze above 30.',
  });
});

test('ETF look-through: stocks held directly and through SPY and QQQ, and the overlap of the funds', async ({
  page,
}) => {
  await seedSession(page, 'aal2');
  // NVDA 10 x 100 = 1,000 direct; SPY 20 x 500 = 10,000 at 7.5% NVDA = 750; QQQ 10 x 400 = 4,000 at 8% = 320.
  // Overlap: min(7.5%, 8%) + min(7%, 9%) = 14.5%.
  const price: Record<string, number> = { NVDA: 100, SPY: 500, QQQ: 400 };
  const holding = (id: number, ticker: string, shares: number) => ({
    id,
    ticker,
    shares,
    cost_basis: price[ticker],
    opened_on: '2026-10-01',
    stop: null,
    targets: [],
    trend_break: null,
    time_stop_sessions: null,
    sector_etf: null,
    thesis_status: 'intact',
  });
  const funds: Record<string, { name: string; cusip: string; ticker: string; weight: number }[]> = {
    SPY: [
      { name: 'NVIDIA Corp', cusip: '67066G104', ticker: 'NVDA', weight: 0.075 },
      { name: 'Apple Inc', cusip: '037833100', ticker: 'AAPL', weight: 0.07 },
    ],
    QQQ: [
      { name: 'Apple Inc', cusip: '037833100', ticker: 'AAPL', weight: 0.09 },
      { name: 'NVIDIA Corp', cusip: '67066G104', ticker: 'NVDA', weight: 0.08 },
    ],
  };
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(json([holding(1, 'NVDA', 10), holding(2, 'SPY', 20), holding(3, 'QQQ', 10)])),
  );
  await page.route('**/rest/v1/daily_bars**', (r) => {
    const t = new URL(r.request().url()).searchParams.get('ticker')?.replace(/^eq\./, '') ?? '';
    const c = price[t];
    return r.fulfill(
      json(
        c === undefined
          ? []
          : [{ date: '2026-11-24', open: c, high: c, low: c, close: c, volume: 1, vwap: null }],
      ),
    );
  });
  await page.route('**/rest/v1/etf_reports**', (r) =>
    r.fulfill(
      json(
        ['SPY', 'QQQ'].map((etf) => ({
          etf,
          report_date: '2026-06-30',
          accession: '0001410368-26-089410',
          version: 'etf-1',
          holdings: 2,
          matched: 2,
        })),
      ),
    ),
  );
  await page.route('**/rest/v1/etf_holdings**', (r) => {
    const etf = new URL(r.request().url()).searchParams.get('etf')?.replace(/^eq\./, '') ?? '';
    return r.fulfill(json(funds[etf] ?? []));
  });
  await page.goto('/portfolio?view=analysis');
  const etf = page.getByRole('region', { name: 'ETF look-through (SEC N-PORT)' });
  // Portfolio 15,000: NVDA 1,000 direct (6.7%), 750 via SPY (5.0%), 320 via QQQ (2.1%), 2,070 in all (13.8%).
  await expect(etf).toContainText('Direct plus via SPY and QQQ, % of portfolio');
  await expect(
    etf.getByRole('listitem', {
      name: 'NVDA 13.8%: direct 6.7%, via SPY 5.0%, via QQQ 2.1%',
    }),
  ).toBeVisible();
  await expect(etf.getByRole('listitem', { name: 'QQQ and SPY overlap 14.5%' })).toContainText(
    'N-PORT for 30 Jun 2026',
  );
  await expect(etf).toContainText('published up to 60 days after the month they describe');
  // The position card's rules line: (750 + 320) / 15,000 = 7.1% more NVDA through the funds.
  await portfolioView(page, 'Holdings');
  await expect(
    page
      .getByRole('region', { name: 'Holdings and exit conditions' })
      .getByRole('listitem')
      .filter({ hasText: 'NVDA' })
      .first(),
  ).toContainText('ETF look-through adds 7.1% via SPY and QQQ');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('portfolio: holdings as cards with the stop-to-target bar, nothing wider than the screen', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'One phone run is enough; the viewport is set here.',
    );
    await seedSession(page, 'aal2');
    await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
    await page.route('**/rest/v1/holdings**', (r) =>
      r.fulfill(
        json([
          {
            id: 1,
            ticker: 'RKLB',
            shares: 100,
            cost_basis: 24,
            opened_on: '2026-10-01',
            stop: 22,
            targets: [27],
            trend_break: null,
            time_stop_sessions: 10,
          },
        ]),
      ),
    );
    await page.route('**/rest/v1/daily_bars**', (r) =>
      r.fulfill(
        json(
          [24, 25, 24, 21.5]
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
      ),
    );
    await page.goto('/portfolio?view=holdings');
    const holdings = page.getByRole('region', { name: 'Holdings and exit conditions' });
    const card = holdings.getByRole('listitem').filter({ hasText: 'RKLB' });
    await expect(card).toContainText('\u25BC \u2212$250');
    await expect(
      card.getByRole('img', { name: 'Stop 22.00, now 21.50, targets 27.' }),
    ).toBeVisible();
    // Bars on 2, 3, 4 and 5 October follow the 1 October open: 4 of 10 sessions used.
    await expect(card).toContainText('time stop 4 of 10 sessions');
    // Portfolio's six views behind one switch, Review first (ADR 0048).
    await expect(
      page.getByRole('group', { name: 'Portfolio view' }).getByRole('button'),
    ).toHaveText(['Review', 'Holdings', 'Analysis', 'Performance', 'Income', 'News']);
    // The page never scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    // Journal keeps what Khaled did: three tabs that wrap on a phone.
    await page.goto('/journal');
    await expect(page.getByRole('tab')).toHaveText([
      'Trades',
      'Sizer and Sahm ticket',
      'Weekly review',
    ]);
    await openTab(page, 'Weekly review');
    await expect(page.getByRole('tab', { name: 'Weekly review' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The page never scrolls sideways on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
