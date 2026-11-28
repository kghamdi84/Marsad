import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DIVIDEND_PROJECTION_METHOD, dividendCompare, toFixedHalfUp } from '@marsad/core';
import { scanAfterEach, seedSession } from './helpers';
import { json, routeBars, syntheticSeries, tickersOf, weekdays } from './summary-stubs';

scanAfterEach();

/**
 * Portfolio's "Compare dividend returns" (core dividend-compare-1). KO is held and PEP and AAPL are on the
 * watchlist; KO and PEP have quarterly dividends stored, AAPL none, so the comparison opens on KO and PEP. The
 * expected figures come from the core function on the same stubbed rows (its own known-answer tests check the
 * math); this spec checks the page shows them, with the method and the price change beside the projection.
 */
const DATES = weekdays('2026-11-27', 800);
const series = (tk: string) => syntheticSeries(tk, DATES);
const exDates = DATES.filter((_, i) => i % 63 === 30);
const DIVS: Record<string, number> = { KO: 0.51, PEP: 1.355 };
const dividendRows = (tk: string) =>
  DIVS[tk] === undefined
    ? []
    : exDates.map((d) => ({
        ticker: tk,
        ex_dividend_date: d,
        record_date: null,
        pay_date: null,
        declaration_date: null,
        cash_amount: DIVS[tk],
        split_adjusted_cash_amount: DIVS[tk],
        currency: 'USD',
        frequency: 4,
        fetched_at: '2026-11-27T22:00:00+00:00',
      }));

async function stub(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-28T15:00:00Z'));
  await page.route('**/rest/v1/**', (r) => r.fulfill(json([])));
  await page.route('**/rest/v1/holdings**', (r) =>
    r.fulfill(
      json([
        {
          id: 1,
          ticker: 'KO',
          shares: 20,
          cost_basis: 60,
          opened_on: '2026-03-02',
          stop: 50,
          targets: [],
          trend_break: null,
          time_stop_sessions: null,
          sector_etf: null,
          thesis_status: 'intact',
          horizon: 'long',
        },
      ]),
    ),
  );
  await page.route('**/rest/v1/watchlist_items**', (r) =>
    r.fulfill(
      json([
        { ticker: 'PEP', position: 0, sector_etf: null },
        { ticker: 'AAPL', position: 1, sector_etf: null },
      ]),
    ),
  );
  await routeBars(page, series);
  await page.route('**/rest/v1/dividends**', (r) => {
    const rows = tickersOf(r).flatMap(dividendRows);
    const desc = new URL(r.request().url()).searchParams.get('order')?.includes('desc');
    return r.fulfill(json(desc ? [...rows].reverse() : rows));
  });
}

const expected = (drip: boolean) => {
  const r = dividendCompare({
    amount: 10_000,
    years: 10,
    drip,
    taxPct: 30,
    tickers: ['KO', 'PEP'].map((tk) => {
      const bars = series(tk);
      const last = bars.at(-1);
      return {
        ticker: tk,
        price: last?.close ?? null,
        priceDate: last?.date ?? null,
        priceChange1y: (last?.close ?? 0) / (bars.at(-253)?.close ?? 1) - 1,
        bars,
        dividends: dividendRows(tk).map((d) => ({
          exDividendDate: d.ex_dividend_date,
          recordDate: null,
          payDate: null,
          declarationDate: null,
          cashAmount: d.cash_amount as number,
          splitAdjustedAmount: d.split_adjusted_cash_amount as number,
          currency: 'USD',
          frequency: 4,
        })),
      };
    }),
  });
  if (!r.ok) throw new Error(r.reason);
  return r.rows;
};
const pct = (v: number) => `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${toFixedHalfUp(Math.abs(v), 1)}%`;

test('dividend comparison: payers by default, the method, the price change beside the projection, CSV', async ({
  page,
}) => {
  await stub(page);
  await page.goto('/portfolio?view=income');
  const card = page.getByRole('region', { name: 'Compare dividend returns' });
  await expect(card.getByRole('list', { name: 'Tickers compared' })).toHaveText(/KO.*PEP/);
  await expect(card.getByRole('list', { name: 'Tickers compared' })).not.toContainText('AAPL');
  await expect(card).toContainText(`Method: ${DIVIDEND_PROJECTION_METHOD}`);
  const table = card.getByRole('region', { name: 'Dividend return comparison' });
  const [ko] = expected(true);
  if (!ko?.projection || !ko.historical.y1.available || ko.priceChange1yPct === null)
    throw new Error('KO expected figures');
  const row = table.getByRole('row').filter({ hasText: 'KO' });
  await expect(row).toContainText(`${toFixedHalfUp(ko.yieldPct ?? 0, 2)}% (4 payments)`);
  await expect(row).toContainText(pct(ko.projection.totalReturnPct));
  await expect(row).toContainText(`Price 1Y ${pct(ko.priceChange1yPct)}`);
  await expect(row).toContainText(pct(ko.historical.y1.totalReturnPct));
  // 800 stored sessions cover the 3-year window (756 sessions and its first close).
  await expect(row).toContainText(
    pct((ko.historical.y3 as { totalReturnPct: number }).totalReturnPct),
  );

  // DRIP off keeps dividends as cash: the projection changes to core's cash figure.
  await card.getByRole('button', { name: 'DRIP on: dividends reinvested' }).click();
  const [koCash] = expected(false);
  await expect(row).toContainText(pct(koCash?.projection?.totalReturnPct ?? 0));

  // Remove one, add another; AAPL has no dividends, so its projection is a zero yield, not hidden.
  await card.getByRole('button', { name: 'Remove PEP from the comparison' }).click();
  await expect(table.getByRole('row').filter({ hasText: 'PEP' })).toHaveCount(0);
  await card.getByLabel('Add a ticker').fill('aapl');
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(table.getByRole('row').filter({ hasText: 'AAPL' })).toContainText(
    'None in 12 months',
  );

  // An amount of zero is not computed, and says why.
  await card.getByLabel('Amount in each, USD').fill('0');
  await expect(card).toContainText('Not computed: amount must be above zero.');
  await card.getByLabel('Amount in each, USD').fill('10000');

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export CSV' }).click();
  const file = await (await download).path();
  const text = readFileSync(file, 'utf8').split('\n');
  expect(text[0]).toBe(`method,${DIVIDEND_PROJECTION_METHOD}`);
  expect(text[1]).toBe('withholding_pct,30');
  expect(text[3]?.startsWith('ticker,price,price_date,price_change_1y_pct,yield_pct')).toBe(true);
  expect(text.slice(4).map((l) => l.split(',')[0])).toEqual(['KO', 'AAPL']);
});
