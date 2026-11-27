import { useQuery } from '@tanstack/react-query';
import { loadPulse, viewPulse } from './pulse';

/**
 * Refresh rules (council batch 5, ADR 0042). Marsad's prices are end of day: they change once a session, so a page
 * keeps what it loaded for 30 minutes instead of reloading every few seconds. Quotes (Tauric snapshots) are the
 * only data that moves during the day, so they are polled once a minute while the regular session is open and
 * not at all otherwise. Pull to refresh still reloads everything on the screen at once.
 */
export const EOD_STALE_MS = 30 * 60_000;
export const QUOTE_POLL_MS = 60_000;

/** The poll interval for quotes: once a minute in the regular session, never when the market is closed. */
export function quotePollInterval(state: string | null | undefined): number | false {
  return state === 'regular' ? QUOTE_POLL_MS : false;
}

/** The market session from the shared pulse query (the same one the market chip reads), or null before it loads. */
export function useSessionState(): string | null {
  const q = useQuery({ queryKey: ['pulse'], queryFn: loadPulse, refetchInterval: 60_000 });
  return q.data ? viewPulse(q.data, new Date()).session.state : null;
}

/** The quote query's refetch interval for the current session. */
export function useQuotePoll(): number | false {
  return quotePollInterval(useSessionState());
}
