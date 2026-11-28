/**
 * The AI spending caps Khaled approved on 2026-11-28 for every Claude call Marsad makes (jobs and Ask together):
 * USD 1 a day and USD 10 a month (UTC days and months), with a warning at 80% (integrity rule 18). Callers read
 * spend from `public.ai_usage`, so every caller counts against the same budget.
 */
import type { Caps } from './cost.js';

export const AI_CAPS = Object.freeze({ dailyUsd: 1, monthlyUsd: 10, warnAt: 0.8 });

/**
 * The caps that apply: the approved caps, lowered by any smaller cap Khaled set in his preferences
 * (`user_settings.ai_daily_cap_usd` and `ai_monthly_cap_usd`). A preference can lower a cap, never raise it.
 */
export function effectiveCaps(preferred?: {
  dailyUsd: number | null;
  monthlyUsd: number | null;
}): Caps {
  const lower = (cap: number, p: number | null | undefined) =>
    typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.min(cap, p) : cap;
  return {
    dailyUsd: lower(AI_CAPS.dailyUsd, preferred?.dailyUsd),
    monthlyUsd: lower(AI_CAPS.monthlyUsd, preferred?.monthlyUsd),
  };
}
