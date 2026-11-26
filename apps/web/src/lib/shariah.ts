import {
  shariahScreen,
  sharesOutstanding,
  summarizeFinancials,
  type DailyBar,
  type FinancialFact,
  type ShariahResult,
  type ShariahSettings,
} from '@marsad/core';

/**
 * The Shariah screening aid for one company as of a date: balance-sheet figures from the filings public by then and
 * the market value from the last close on or before it. The Financials panel and the Study list both use this, so
 * they cannot disagree. Null without a balance sheet.
 */
export function shariahAsOf(
  facts: readonly FinancialFact[],
  bars: readonly DailyBar[],
  settings: ShariahSettings,
  asOf: string,
): ShariahResult | null {
  const s = summarizeFinancials(facts, asOf);
  if (!s.balance) return null;
  const price = [...bars].reverse().find((b) => b.date <= asOf) ?? null;
  const shares = sharesOutstanding(facts, asOf);
  return shariahScreen(
    {
      longTermDebt: s.balance.longTermDebt.value,
      cash: s.balance.cash.value,
      assets: s.balance.assets.value,
      marketCap: price && shares ? price.close * shares.value : null,
    },
    settings,
  );
}
