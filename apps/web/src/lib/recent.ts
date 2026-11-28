/**
 * Recently viewed companies (ADR 0048): the last 8 tickers opened on Study, newest first, kept in this browser
 * only. Storage can be missing or blocked (private windows, previews), so every access is guarded and the page
 * works without it.
 */
export const RECENT_KEY = 'marsad.study.recent';
export const RECENT_MAX = 8;

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** The list with `ticker` moved to the front, without repeats, at most `RECENT_MAX` long. */
export function withViewed(list: readonly string[], ticker: string): string[] {
  return [ticker, ...list.filter((x) => x !== ticker)].slice(0, RECENT_MAX);
}

/** A stored value read back: only ticker-shaped strings, in order, without repeats. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) if (typeof x === 'string' && TICKER.test(x) && !out.includes(x)) out.push(x);
    return out.slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function readRecent(): string[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

export function rememberViewed(ticker: string): void {
  if (!TICKER.test(ticker)) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(withViewed(readRecent(), ticker)));
  } catch {
    // Not remembered; the page still works.
  }
}
