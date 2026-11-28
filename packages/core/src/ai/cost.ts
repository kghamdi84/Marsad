/**
 * What Claude calls cost, and when to stop (integrity rule 19). Spend comes from the usage fields of each
 * response. Prices are USD per million tokens, copied from Anthropic's published model table as cached in the
 * Claude API reference on 2026-11-03; check them at https://platform.claude.com/docs before relying on a cap.
 * Cache reads and writes follow the documented ratios: a read costs the price listed (Haiku: assumed one tenth
 * of input, not published in the table used), a 5-minute cache write costs 1.25 times input.
 */

/**
 * `claude-sonnet-5` is here only because Claude Sonnet 5.5's server-side fallback can answer a declined request on
 * it (Ask, ADR 0054); Marsad never asks for it directly. Same input and output price; cache reads cost twice
 * Sonnet 5.5's rate.
 */
export type ModelId =
  'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-sonnet-5' | 'claude-opus-5-5';

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** Prompts longer than this many tokens are billed at `long*`. */
  longPromptTokens?: number;
  longInputPerMTok?: number;
  longOutputPerMTok?: number;
  /** True when the cache read price is not in the published table and is assumed. */
  cacheReadAssumed?: boolean;
}

export const MODEL_PRICES: Readonly<Record<ModelId, ModelPrice>> = Object.freeze({
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheReadAssumed: true,
    longPromptTokens: 100_000,
    longInputPerMTok: 0.5,
    longOutputPerMTok: 2.5,
  },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
});

export interface Usage {
  /** Uncached input tokens (`usage.input_tokens`). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD for one response, from its usage fields. */
export function costOfUsage(model: ModelId, usage: Usage): number {
  const p = MODEL_PRICES[model];
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = p.longPromptTokens !== undefined && promptTokens > p.longPromptTokens;
  const input = long ? (p.longInputPerMTok ?? p.inputPerMTok) : p.inputPerMTok;
  const output = long ? (p.longOutputPerMTok ?? p.outputPerMTok) : p.outputPerMTok;
  const usd =
    (usage.inputTokens * input +
      usage.cacheWriteTokens * input * 1.25 +
      usage.cacheReadTokens * p.cacheReadPerMTok +
      usage.outputTokens * output) /
    1_000_000;
  return usd;
}

export interface Caps {
  dailyUsd: number;
  monthlyUsd: number;
}

export type BudgetState = 'ok' | 'warn' | 'capped';

export interface BudgetStatus {
  state: BudgetState;
  dailyPct: number;
  monthlyPct: number;
  /** One line for the Status page and the log. */
  message: string;
}

/** Warning at 80% of either cap; capped at 100%. `projectedUsd` is the cost of the call about to be made. */
export function evaluateBudget(
  spent: { dailyUsd: number; monthlyUsd: number },
  caps: Caps,
  projectedUsd = 0,
): BudgetStatus {
  const dailyPct = (spent.dailyUsd / caps.dailyUsd) * 100;
  const monthlyPct = (spent.monthlyUsd / caps.monthlyUsd) * 100;
  const overDaily = spent.dailyUsd + projectedUsd > caps.dailyUsd;
  const overMonthly = spent.monthlyUsd + projectedUsd > caps.monthlyUsd;
  const round = (n: number) => Math.round(n * 10) / 10;
  if (overDaily || overMonthly) {
    return {
      state: 'capped',
      dailyPct: round(dailyPct),
      monthlyPct: round(monthlyPct),
      message: `AI cap reached (${overDaily ? 'daily' : 'monthly'}): text falls back to templates`,
    };
  }
  if (dailyPct >= 80 || monthlyPct >= 80) {
    return {
      state: 'warn',
      dailyPct: round(dailyPct),
      monthlyPct: round(monthlyPct),
      message: `AI spend at ${round(Math.max(dailyPct, monthlyPct))}% of a cap`,
    };
  }
  return {
    state: 'ok',
    dailyPct: round(dailyPct),
    monthlyPct: round(monthlyPct),
    message: 'AI spend within caps',
  };
}
