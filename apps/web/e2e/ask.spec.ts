import { expect, test, type Page, type Route } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// Ask (checklist 8.1, ADR 0054). The Edge Function is stubbed by route interception: nothing reaches Claude.

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const budget = (over: Record<string, unknown> = {}) => ({
  dailyCapUsd: 1,
  monthlyCapUsd: 10,
  todayUsd: 0.12,
  monthUsd: 1.5,
  dailyLeftUsd: 0.88,
  monthlyLeftUsd: 8.5,
  state: 'ok',
  capped: null,
  ...over,
});

const reply = (over: Record<string, unknown>) => ({
  version: 'ask-1',
  reason: null,
  answer: '',
  citations: [],
  verified: false,
  model: null,
  usage: {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0,
  },
  asOf: null,
  budget: budget(),
  ...over,
});

const citations = [
  {
    id: 'F2',
    kind: 'fact',
    label: 'NVDA last close (session 2026-11-27)',
    text: '$189.00',
    source: 'Marsad nightly summary (ticker_daily_summary, ticker-summary-1, session 2026-11-27)',
    asOf: '2026-11-28T11:31:02Z',
    link: { page: 'study', ticker: 'NVDA', view: 'overview' },
    url: null,
  },
  {
    id: 'F40',
    kind: 'fact',
    label: 'NVDA 10-K risk factors, period ended 2026-01-25, filed',
    text: '2026-02-25',
    source: 'SEC filings as stored by Marsad (annual_sections, quarterly_sections)',
    asOf: '2026-11-20T03:00:00Z',
    link: { page: 'study', ticker: 'NVDA', view: 'filings' },
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/x.htm',
  },
  {
    id: 'F1',
    kind: 'fact',
    label: "Marsad's scope: it explains stored data and never advises",
    text: 'Marsad policy',
    source: 'Marsad (ADR 0054)',
    asOf: null,
    link: null,
    url: null,
  },
];

const answered = reply({
  state: 'answered',
  verified: true,
  model: 'claude-sonnet-5-5',
  answer:
    'NVDA closed at $189.00 in the session of 27 November [F2]. Its latest 10-K risk factors were filed on 2026-02-25 [F40]. Marsad never advises on what to do next [F1].',
  citations,
  asOf: '2026-11-20T03:00:00Z',
  usage: {
    calls: 2,
    inputTokens: 4000,
    outputTokens: 600,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0.014,
  },
});

async function stub(page: Page, onAsk: (body: Record<string, unknown>, route: Route) => unknown) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  const sent: Record<string, unknown>[] = [];
  const auth: (string | null)[] = [];
  await page.route('**/functions/v1/ask', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    auth.push(route.request().headers()['authorization'] ?? null);
    await onAsk(body, route);
  });
  return { sent, auth };
}

test('not configured: the page says so, the form is closed and no question is sent', async ({
  page,
}) => {
  const { sent } = await stub(page, (_b, route) =>
    route.fulfill(json(reply({ state: 'not-configured' }), 503)),
  );
  await page.goto('/ask');
  await expect(page.getByRole('heading', { level: 1, name: 'Ask' })).toBeVisible();
  await expect(page.getByText('Ask is not configured yet')).toBeVisible();
  await expect(page.getByLabel('Your question')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  await expect(page.getByText('AI spend left: USD 0.88 today, USD 8.50 this month')).toBeVisible();
  expect(sent).toEqual([{ mode: 'status' }]);
  // Marsad never advises: no buy or sell wording anywhere on the page.
  expect(await page.locator('main').innerText()).not.toMatch(/\b(buy|sell)\b/i);
});

test('a function that is not deployed reads as not configured', async ({ page }) => {
  await stub(page, (_b, route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'Function not found' }),
  );
  await page.goto('/ask');
  await expect(page.getByText('Ask is not configured yet')).toBeVisible();
  await expect(page.getByText(/cannot be reached/)).toBeVisible();
});

test('a checked answer: label, numbered citations linking into Marsad and SEC.gov, model, as-of, history', async ({
  page,
}) => {
  let asked = false;
  const { sent, auth } = await stub(page, (body, route) => {
    if (body['mode'] === 'status') return route.fulfill(json(reply({ state: 'ready' })));
    asked = true;
    return route.fulfill(json(answered));
  });
  await page.route('**/rest/v1/ask_log**', (r) =>
    r.fulfill(
      json(
        asked
          ? [
              {
                id: 7,
                created_at: '2026-11-28T15:00:00Z',
                question: 'How is NVDA doing?',
                answer: answered.answer,
                citations,
                verified: true,
                model: 'claude-sonnet-5-5',
                usd: 0.014,
                state: 'answered',
                as_of: '2026-11-20T03:00:00Z',
              },
            ]
          : [],
      ),
    ),
  );
  await page.goto('/ask');
  await expect(page.getByText('No questions yet.')).toBeVisible();
  await page.getByLabel('Your question').fill('How is NVDA doing?');
  await expect(page.getByText('18 of 500 characters')).toBeVisible();
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  const latest = page.getByRole('region', { name: 'Ask about your Marsad data' });
  await expect(
    latest.getByText('AI answer (Claude), figures checked against Marsad data'),
  ).toBeVisible();
  await expect(
    latest.getByText(/NVDA closed at \$189\.00 in the session of 27 November/),
  ).toBeVisible();
  // Citation ids become numbers in order of the source list, each linked to its source.
  await expect(latest.getByRole('link', { name: 'Source 1' }).first()).toHaveAttribute(
    'href',
    '#ask-latest-1',
  );
  await expect(latest.getByRole('link', { name: 'Source 3' })).toBeVisible();
  const sources = latest.getByRole('region', { name: 'Sources' }).getByRole('listitem');
  await expect(sources).toHaveCount(3);
  await expect(sources.nth(0)).toContainText('NVDA last close (session 2026-11-27): $189.00');
  await expect(sources.nth(0)).toContainText('ET');
  await expect(sources.nth(0).getByRole('link', { name: 'Open in Marsad' })).toHaveAttribute(
    'href',
    '/study/NVDA?view=overview',
  );
  await expect(
    sources.nth(1).getByRole('link', { name: /Open the filing on SEC.gov/ }),
  ).toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/1045810/x.htm');
  await expect(sources.nth(2)).toContainText("Marsad's scope");
  await expect(latest.getByText('Model claude-sonnet-5-5')).toBeVisible();
  await expect(latest.getByText(/Data as of 19 Nov 22:00 ET/)).toBeVisible();
  await expect(latest.getByText('This answer cost USD 0.01')).toBeVisible();

  // The status check, the question, then a fresh status check for the spend left.
  expect(sent.slice(0, 2)).toEqual([{ mode: 'status' }, { question: 'How is NVDA doing?' }]);
  expect(auth.every((a) => a?.startsWith('Bearer '))).toBe(true);

  // The history reloads from ask_log after the answer.
  const history = page.getByRole('region', { name: 'Earlier questions' });
  await expect(history.getByText('How is NVDA doing?')).toBeVisible();
  await history.getByText('Show the answer').click();
  await expect(history.getByRole('link', { name: 'Open in Marsad' }).first()).toBeVisible();

  await sources.nth(0).getByRole('link', { name: 'Open in Marsad' }).click();
  await expect(page).toHaveURL(/\/study\/NVDA\?view=overview$/);
});

test('facts only: Marsad says why and shows the facts it read, without the AI label', async ({
  page,
}) => {
  await stub(page, (body, route) =>
    route.fulfill(
      json(
        body['mode'] === 'status'
          ? reply({ state: 'ready' })
          : reply({
              state: 'facts-only',
              reason: 'verification-failed',
              model: 'claude-sonnet-5-5',
              answer: 'NVDA last close (session 2026-11-27): $189.00 [F2].',
              citations: citations.slice(0, 1),
              asOf: '2026-11-28T11:31:02Z',
            }),
      ),
    ),
  );
  await page.goto('/ask');
  await page.getByLabel('Your question').fill('How is NVDA doing?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Facts only, written by Marsad from its data')).toBeVisible();
  await expect(page.getByText(/did not pass Marsad's figure check twice/)).toBeVisible();
  await expect(
    page.getByText('AI answer (Claude), figures checked against Marsad data'),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Source 1' })).toBeVisible();
});

test('the daily cap reached: "AI limit reached for today" and the form is closed', async ({
  page,
}) => {
  const { sent } = await stub(page, (_b, route) =>
    route.fulfill(
      json(
        reply({
          state: 'capped',
          budget: budget({ state: 'capped', capped: 'daily', todayUsd: 0.99, dailyLeftUsd: 0.01 }),
        }),
      ),
    ),
  );
  await page.goto('/ask');
  await expect(page.getByText('AI limit reached for today')).toBeVisible();
  await expect(page.getByLabel('Your question')).toBeDisabled();
  await expect(page.getByText('AI spend left: USD 0.01 today, USD 8.50 this month')).toBeVisible();
  expect(sent).toHaveLength(1);
});

test('a member account is told Ask is for the owner only', async ({ page }) => {
  await stub(page, (_b, route) =>
    route.fulfill(json(reply({ state: 'owner-only', budget: null }), 403)),
  );
  await page.goto('/ask');
  await expect(page.getByText('Ask is for the owner of this Marsad only.')).toBeVisible();
  await expect(page.getByLabel('Your question')).toBeDisabled();
});
