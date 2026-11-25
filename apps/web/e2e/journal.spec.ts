import { expect, test } from '@playwright/test';
import { seedSession, scanAfterEach } from './helpers';

scanAfterEach();

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
  const sizer = page.getByRole('region', { name: 'Pre-trade checklist and position sizer' });
  await sizer.getByLabel('Ticker').fill('rklb');
  await sizer.getByLabel('Account size (USD)').fill('50000');
  await sizer.getByLabel('Risk per trade (%)').fill('0.5');
  await sizer.getByLabel('Limit price').fill('24.15');
  await sizer.getByLabel('Stop', { exact: true }).fill('22.15');
  await sizer.getByLabel('Targets (separate with spaces)').fill('28.15 30.15');
  // USD 250 at risk over a 2.00 stop distance: 125 shares, USD 3,018.75 (6.0% of the account); 2.0R and 3.0R.
  await expect(
    sizer.getByText(
      '125 shares; risk USD 250.00 if the stop fills; position USD 3018.75 (6.0% of the account).',
    ),
  ).toBeVisible();
  await expect(sizer.getByText('Reward to risk: 2.0R, 3.0R.')).toBeVisible();
  await expect(sizer.getByTestId('sahm-ticket')).toHaveText(
    'BUY 125 RKLB LIMIT 24.15, STOP 22.15, GTC',
  );
  const copy = sizer.getByRole('button', { name: 'Copy Sahm order ticket' });
  await expect(copy).toBeDisabled();
  for (const box of await sizer.getByRole('checkbox').all()) await box.check();
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
  const holdings = page.getByRole('region', { name: 'Holdings and exit conditions' });
  const rklb = holdings.getByRole('row', { name: /^RKLB/ });
  // 21.50 against a 24.00 cost: -10.4% (USD -250.00); the stop and the trend break both triggered.
  await expect(rklb).toContainText('-10.4% (USD -250.00)');
  await expect(rklb).toContainText('Triggered: Closed at 21.50, at or below the stop 22.00.');
  await expect(rklb).toContainText('below the 3-day SMA');
  await expect(holdings.getByRole('row', { name: /^SOFI/ })).toContainText(
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

test('journal: exposure, stress and rotation from stored bars; sector and thesis are saved', async ({
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
  await page.goto('/journal');
  const exposure = page.getByRole('region', { name: 'Exposure, beta and stress' });
  await expect(exposure).toContainText('Beta-weighted exposure: 2.00 times SPY');
  await expect(exposure.getByRole('row', { name: /^SPY down 10%/ })).toContainText('(-20.0%)');
  await expect(exposure.getByRole('row', { name: /^VIX up 10 points/ })).toContainText('(-20.0%)');
  await expect(exposure.getByRole('row', { name: /^Industrials \(XLI\) down 10%/ })).toContainText(
    '(-20.0%)',
  );
  await expect(exposure).toContainText('Industrials: 100.0%');
  const rotation = page.getByRole('region', { name: 'Stock-to-ETF rotation' });
  await expect(rotation.getByRole('row', { name: /^RKLB/ })).toContainText('Rotate');
  await expect(rotation).toContainText('and the thesis is weakening. Consider XLI or SPY instead.');

  await page.getByLabel('Thesis').selectOption('broken');
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
  const section = page.getByRole('region', { name: 'Trades and adherence' });
  // RKLB: (28 - 24) / (24 - 22) = 2R, USD 400; 10 items, noEmotion not honored: 9 of 10 = 90.
  const rklb = section.getByRole('listitem').filter({ hasText: 'RKLB' });
  await expect(rklb).toContainText('Result ▲ +2.00R, USD ▲ +400.00.');
  await expect(rklb).toContainText('Adherence 90 (9 of 10 items).');
  await expect(rklb).toContainText('No chasing, no revenge trade, no moving the stop away.');
  await expect(rklb.getByRole('img', { name: 'Screenshot 1 of the RKLB trade' })).toBeVisible();
  // SOFI is open, unnamed, nothing ticked: 0 of 9.
  const sofi = section.getByRole('listitem').filter({ hasText: 'SOFI' });
  await expect(sofi).toContainText('Adherence 0 (0 of 9 items).');
  await expect(section.getByRole('row', { name: /^All trades/ })).toContainText('1 (1)');
  await expect(section).toContainText('Each group needs 30 closed trades');

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

  const form = page.getByRole('form', { name: 'Log a trade' });
  await form.getByLabel('Ticker').fill('nvda');
  await form.getByLabel('Entry price').fill('180');
  await form.getByLabel('Shares', { exact: true }).fill('10');
  await form.getByLabel('Setup (playbook or your own name)').fill('trend-template-breakout');
  await form.getByLabel('The stop was placed in Sahm when the order filled.').check();
  await form.getByRole('button', { name: 'Save trade' }).click();
  await expect
    .poll(() => writes.find((w) => w.method === 'POST' && w.url.includes('/rest/v1/trades'))?.body)
    .toMatchObject({
      ticker: 'NVDA',
      entry_price: 180,
      shares: 10,
      setup: 'trend-template-breakout',
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
  await page.goto('/journal');
  await expect(page.getByText('The first weekly review is written on Sunday')).toBeVisible();
  rows = [
    {
      title: 'Weekly review, week ending 2026-11-29',
      for_date: '2026-11-29',
      sections: [{ heading: 'Behavior', lines: ['Mean adherence 86 over 3 trades.'] }],
    },
  ];
  await page.reload();
  const review = page.getByRole('region', { name: 'Weekly review, week ending 2026-11-29' });
  await expect(review).toContainText('Mean adherence 86 over 3 trades.');
});
