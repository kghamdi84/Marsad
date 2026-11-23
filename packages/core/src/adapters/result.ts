import type { FailureKind } from '../http.js';
import type { PlanTier, Sourced } from '../provenance.js';

/** What every adapter returns: data with provenance, or a failure the UI can explain. */
export type AdapterResult<T> =
  | { ok: true; data: Sourced<T>; latencyMs: number; fromCache: boolean }
  | {
      ok: false;
      kind: FailureKind | 'invalid-response';
      message: string;
      /** Set when the cause is the plan, so the UI shows "requires plan" and not an outage. */
      planTier: PlanTier;
      /** Text for the UI. */
      display: string;
    };

export function failure(
  source: string,
  kind: FailureKind | 'invalid-response',
  message: string,
): Extract<AdapterResult<never>, { ok: false }> {
  if (kind === 'not-entitled') {
    return {
      ok: false,
      kind,
      message,
      planTier: 'unavailable',
      display: `Requires a higher ${source} plan`,
    };
  }
  const text: Record<string, string> = {
    'auth-failed': `${source} rejected the API key`,
    'rate-limited': `${source} rate limit reached`,
    'not-found': `${source} has no data for this request`,
    'server-error': `${source} is having problems`,
    'client-error': `${source} rejected the request`,
    network: `Could not reach ${source}`,
    'invalid-response': `${source} returned data Marsad could not read`,
  };
  return {
    ok: false,
    kind,
    message,
    planTier: 'unknown',
    display: text[kind] ?? `${source} error`,
  };
}
