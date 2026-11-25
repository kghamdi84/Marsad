/** The tickers Marsad tracks before the user edits the watchlist. Shared by the jobs and the web app. */

export const STARTING_STOCKS = [
  'NVDA',
  'RKLB',
  'MARA',
  'SOFI',
  'HOOD',
  'OKLO',
  'IONQ',
  'HIMS',
  'RGTI',
  'BBAI',
] as const;

export const CORE_ETFS = ['SPY', 'QQQ', 'IWM', 'DIA'] as const;

/** Stored as daily bars only (not on the watchlist): IEF for the composite's safe-haven component (ADR 0011). */
export const BAR_ONLY_TICKERS = ['IEF'] as const;

/** Stocks first, then the benchmark ETFs. */
export const STARTING_TICKERS = [...STARTING_STOCKS, ...CORE_ETFS] as const;

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** Upper-cases and validates a ticker typed or taken from a URL. Returns null when it is not plausible. */
export function normalizeTicker(input: string): string | null {
  const t = input.trim().toUpperCase();
  return TICKER.test(t) ? t : null;
}
