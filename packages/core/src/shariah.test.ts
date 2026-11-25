import { describe, expect, it } from 'vitest';
import type { FinancialFact } from './adapters/sec-facts.js';
import { DEFAULT_SHARIAH, shariahScreen, sharesOutstanding } from './shariah.js';

const fact = (end: string, filed: string, value: number): FinancialFact => ({
  taxonomy: 'dei',
  concept: 'EntityCommonStockSharesOutstanding',
  unit: 'shares',
  start: null,
  end,
  value,
  accession: 'a',
  form: '10-Q',
  fy: 2026,
  fp: 'Q3',
  filed,
  frame: null,
});

describe('sharesOutstanding', () => {
  it('takes the newest cover-page value already filed', () => {
    const facts = [fact('2026-07-20', '2026-08-01', 100), fact('2026-10-20', '2026-11-01', 110)];
    expect(sharesOutstanding(facts, '2026-10-31')).toEqual({
      value: 100,
      end: '2026-07-20',
      filed: '2026-08-01',
    });
    expect(sharesOutstanding(facts, '2026-11-25')?.value).toBe(110);
    expect(sharesOutstanding(facts, '2026-01-01')).toBeNull();
  });
});

describe('shariahScreen (hand-checked)', () => {
  it('debt 20 and cash 40 over a market cap of 100: debt passes 33%, cash fails', () => {
    const r = shariahScreen(
      { longTermDebt: 20, cash: 40, assets: 500, marketCap: 100 },
      DEFAULT_SHARIAH,
    );
    expect(r.ratios).toEqual([
      { name: 'debt', value: 0.2, max: 0.33, pass: true },
      { name: 'cash', value: 0.4, max: 0.33, pass: false },
    ]);
    expect(r.verdict).toBe('fails-ratios');
    expect(r.caveats[0]).toBe(
      'A screening aid, not a ruling. Sahm’s own Shariah label takes precedence.',
    );
  });
  it('on total assets the same company passes both (20/500 and 40/500)', () => {
    const r = shariahScreen(
      { longTermDebt: 20, cash: 40, assets: 500, marketCap: 100 },
      { ...DEFAULT_SHARIAH, basis: 'assets' },
    );
    expect(r.ratios.map((x) => x.value)).toEqual([0.04, 0.08]);
    expect(r.verdict).toBe('passes-ratios');
  });
  it('at the threshold fails (the limit is "below"); a missing input is unknown, never a pass', () => {
    expect(
      shariahScreen({ longTermDebt: 33, cash: 0, assets: null, marketCap: 100 }, DEFAULT_SHARIAH)
        .verdict,
    ).toBe('fails-ratios');
    expect(
      shariahScreen({ longTermDebt: null, cash: 1, assets: null, marketCap: 100 }, DEFAULT_SHARIAH)
        .verdict,
    ).toBe('unknown');
    expect(
      shariahScreen({ longTermDebt: 1, cash: 1, assets: null, marketCap: null }, DEFAULT_SHARIAH)
        .verdict,
    ).toBe('unknown');
  });
});
