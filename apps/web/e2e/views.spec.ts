import { expect, test, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// ADR 0048: every view has a URL. `?view=` wins over the choice remembered on the device, and switching a view
// rewrites the URL in place (replace, not a new history entry), so alerts, briefs and friends can link to a view.

async function empty(page: Page) {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** Remembers a view on the device before the page loads, to show the URL wins over it. */
async function remember(page: Page, key: string, value: string) {
  await page.addInitScript(
    ([k, v]) => localStorage.setItem(k as string, v as string),
    [key, value],
  );
}

test('study: ?view= opens that view over the remembered one, and a tap rewrites the URL in place', async ({
  page,
}) => {
  await empty(page);
  await remember(page, 'marsad.study.section', 'news');
  await page.goto('/study');
  await page.goto('/study/NVDA?view=analysts');
  await expect(page.getByRole('tab', { name: 'Analysts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Earnings', exact: true }).click();
  await expect(page).toHaveURL(/\/study\/NVDA\?view=earnings$/);
  // Replace, not push: Back leaves the company page instead of stepping through views.
  await page.goBack();
  await expect(page).toHaveURL(/\/study$/);
});

test('study: an unknown view falls back to the remembered one', async ({ page }) => {
  await empty(page);
  await remember(page, 'marsad.study.section', 'news');
  await page.goto('/study/NVDA?view=nonsense');
  await expect(page.getByRole('tab', { name: 'News', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('settings and status: ?view= picks the section, the switch writes it back', async ({
  page,
}) => {
  await empty(page);
  await page.goto('/settings?view=data');
  await expect(
    page
      .getByRole('group', { name: 'Settings sections' })
      .getByRole('button', { name: 'Quote source and exports' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('group', { name: 'Settings sections' })
    .getByRole('button', { name: 'Notifications' })
    .click();
  await expect(page).toHaveURL(/\/settings\?view=notifications$/);

  await page.goto('/status?view=costs');
  await expect(
    page.getByRole('group', { name: 'Status details' }).getByRole('button', { name: 'Costs' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('journal: ?view= picks trades, sizer or review; the tabs that moved open their Portfolio view', async ({
  page,
}) => {
  await empty(page);
  await page.goto('/journal?view=sizer');
  await expect(page.getByRole('tab', { name: 'Sizer and Sahm ticket' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Weekly review' }).click();
  await expect(page).toHaveURL(/\/journal\?view=review$/);
  // Old Journal links (ADR 0048 moved these tabs to Portfolio) land on the view that holds them now.
  for (const [old, now, label] of [
    ['positions', 'holdings', 'Holdings'],
    ['portfolio', 'review', 'Review'],
    ['options', 'holdings', 'Holdings'],
    ['exposure', 'analysis', 'Analysis'],
  ] as const) {
    await page.goto(`/journal?view=${old}`);
    await expect(page).toHaveURL(new RegExp(`/portfolio\\?view=${now}$`));
    await expect(
      page.getByRole('group', { name: 'Portfolio view' }).getByRole('button', { name: label }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
});

/**
 * Every page and every `?view=` URL, with the control that shows the chosen view: a Segmented group (pressed
 * button) or a tab row (selected tab). Each URL must render its page title, select that view and throw nothing.
 */
const PAGES: {
  path: string;
  title: string;
  views?: { group?: string; tabs?: true; list: [string, string][] };
}[] = [
  { path: '/', title: 'Watch' },
  {
    path: '/markets',
    title: 'Markets',
    views: {
      group: 'Markets view',
      list: [
        ['regime', 'Regime'],
        ['movers', 'Movers'],
        ['sectors', 'Sectors'],
        ['calendar', 'Calendar'],
      ],
    },
  },
  { path: '/study', title: 'Study' },
  {
    path: '/study/NVDA',
    title: 'NVDA',
    views: {
      tabs: true,
      list: [
        ['overview', 'Overview'],
        ['analysts', 'Analysts'],
        ['financials', 'Financials'],
        ['earnings', 'Earnings'],
        ['technicals', 'Technicals'],
        ['dividends', 'Dividends'],
        ['ownership', 'Ownership'],
        ['news', 'News'],
        ['filings', 'Filings'],
        ['shariah', 'Shariah aid'],
      ],
    },
  },
  {
    path: '/portfolio',
    title: 'Portfolio',
    views: {
      group: 'Portfolio view',
      list: [
        ['review', 'Review'],
        ['holdings', 'Holdings'],
        ['analysis', 'Analysis'],
        ['performance', 'Performance'],
        ['income', 'Income'],
        ['news', 'News'],
      ],
    },
  },
  {
    path: '/journal',
    title: 'Journal',
    views: {
      tabs: true,
      list: [
        ['trades', 'Trades'],
        ['sizer', 'Sizer and Sahm ticket'],
        ['review', 'Weekly review'],
      ],
    },
  },
  { path: '/alerts', title: 'Alerts' },
  { path: '/lab', title: 'Lab' },
  {
    path: '/status',
    title: 'Status',
    views: {
      group: 'Status details',
      list: [
        ['jobs', 'Jobs'],
        ['costs', 'Costs'],
        ['alerts', 'System alerts'],
        ['latency', 'Latency'],
      ],
    },
  },
  {
    path: '/settings',
    title: 'Settings',
    views: {
      group: 'Settings sections',
      list: [
        ['display', 'Display and security'],
        ['notifications', 'Notifications'],
        ['prefs', 'Limits, Shariah and AI caps'],
        ['data', 'Quote source and exports'],
      ],
    },
  },
];

for (const pg of PAGES)
  test(`every view loads: ${pg.path}${pg.views ? ` (${pg.views.list.length} views)` : ''}`, async ({
    page,
  }) => {
    await empty(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const urls = pg.views
      ? pg.views.list.map(([key, label]) => ({ url: `${pg.path}?view=${key}`, label }))
      : [{ url: pg.path, label: null }];
    for (const { url, label } of urls) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: pg.title })).toBeVisible();
      if (label && pg.views?.tabs)
        await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      else if (label && pg.views?.group)
        await expect(
          page
            .getByRole('group', { name: pg.views.group })
            .getByRole('button', { name: label, exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Something went wrong.')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
