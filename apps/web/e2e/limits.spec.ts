import { expect, test, type Page } from '@playwright/test';
import { scanAfterEach, seedSession } from './helpers';

scanAfterEach();

// Portfolio limits in Settings (ADR 0048): each person's own, the owner's seeded with the council's values.

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function stub(page: Page, row: Record<string, unknown> | null) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-29T09:00:00Z'));
  const writes: { method: string; body: unknown }[] = [];
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/portfolio_limits**', (r) => {
    const method = r.request().method();
    if (method === 'GET') return r.fulfill(json(row ? [row] : []));
    writes.push({ method, body: r.request().postDataJSON() });
    return r.fulfill({ status: 201, contentType: 'application/json', body: '' });
  });
  return writes;
}

const COUNCIL = {
  largest_position: 0.2,
  top5: 0.6,
  min_cash: 0.1,
  portfolio_beta: 1.5,
  open_risk: 0.06,
  set_by: 'council',
  set_on: '2026-11-28',
  version: 1,
};

test('settings: the council limits load as percents, bad entries are named, a save stores fractions', async ({
  page,
}) => {
  const writes = await stub(page, COUNCIL);
  await page.goto('/settings?view=prefs');
  const form = page.getByRole('form', { name: 'Portfolio limits' });
  await expect(form.getByLabel('Largest single position (% of equity)')).toHaveValue('20');
  await expect(form.getByLabel('Top 5 positions together (% of equity)')).toHaveValue('60');
  await expect(form.getByLabel('Minimum cash (% of equity)')).toHaveValue('10');
  await expect(form.getByLabel('Maximum portfolio beta to SPY')).toHaveValue('1.5');
  await expect(form.getByLabel('Maximum total open risk (% of equity)')).toHaveValue('6');
  await expect(form).toContainText(
    'Set by the council at your request on 28 Nov 2026; change any time. Version 1, set 28 Nov 2026.',
  );
  // Out of range and not a number: each named beside its box, nothing written.
  await form.getByLabel('Top 5 positions together (% of equity)').fill('150');
  await form.getByLabel('Maximum portfolio beta to SPY').fill('high');
  await form.getByRole('button', { name: 'Save limits' }).click();
  await expect(form.getByRole('status')).toHaveText('Check the highlighted boxes.');
  await expect(
    form.getByLabel('Top 5 positions together (% of equity)'),
  ).toHaveAccessibleDescription('Enter a number above 0 and at most 100.');
  await expect(form.getByLabel('Maximum portfolio beta to SPY')).toHaveAccessibleDescription(
    'Enter a number, or leave it empty.',
  );
  expect(writes).toEqual([]);
  // Fixed, with minimum cash cleared ("No limit set") and the largest position raised to 25%.
  await form.getByLabel('Top 5 positions together (% of equity)').fill('60');
  await form.getByLabel('Maximum portfolio beta to SPY').fill('1.5');
  await form.getByLabel('Minimum cash (% of equity)').fill('');
  await form.getByLabel('Largest single position (% of equity)').fill('25');
  await form.getByRole('button', { name: 'Save limits' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  expect(writes).toEqual([
    {
      method: 'POST',
      body: {
        set_by: 'user',
        set_on: '2026-11-29',
        largest_position: 0.25,
        top5: 0.6,
        min_cash: null,
        portfolio_beta: 1.5,
        open_risk: 0.06,
      },
    },
  ]);
});

test('settings: a member with no stored row starts with no limit set', async ({ page }) => {
  await stub(page, null);
  await page.goto('/settings?view=prefs');
  const form = page.getByRole('form', { name: 'Portfolio limits' });
  for (const label of [
    'Largest single position (% of equity)',
    'Top 5 positions together (% of equity)',
    'Minimum cash (% of equity)',
    'Maximum portfolio beta to SPY',
    'Maximum total open risk (% of equity)',
  ])
    await expect(form.getByLabel(label)).toHaveValue('');
  await expect(form).toContainText('No limits stored yet: every limit reads "No limit set".');
  await expect(form).not.toContainText('council');
});
