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
  return usdAt(MODEL_PRICES[model], usage);
}

function usdAt(p: ModelPrice, usage: Usage): number {
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

/**
 * The AI spending caps Khaled approved on 2026-11-28 (ADR 0007, addendum): USD 1 a day and USD 10 a month (UTC),
 * warning at 80%, templates at the cap. This is the one place they are written. Caps saved in Preferences can lower
 * them, never raise them (`effectiveCaps`).
 */
export const AI_CAPS: Readonly<Caps> = Object.freeze({ dailyUsd: 1, monthlyUsd: 10 });
export const AI_CAPS_APPROVED_ON = '2026-11-28';

/** The approved caps, lowered by any cap saved in Preferences. A blank or invalid saved cap keeps the approved one. */
export function effectiveCaps(
  saved?: { dailyUsd: number | null; monthlyUsd: number | null } | null,
): Caps {
  const pick = (v: number | null | undefined, cap: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, cap) : cap;
  return {
    dailyUsd: pick(saved?.dailyUsd, AI_CAPS.dailyUsd),
    monthlyUsd: pick(saved?.monthlyUsd, AI_CAPS.monthlyUsd),
  };
}

/**
 * Models a server-side fallback can answer with (`fallbacks: "default"`), priced from the same table. Their cache
 * read price is not in the table used: assumed one tenth of input, the documented ratio.
 */
const FALLBACK_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-sonnet-5': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheReadAssumed: true,
  },
  'claude-opus-5': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheReadAssumed: true,
  },
  'claude-opus-4-8': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheReadAssumed: true,
  },
});

/** The dearest price known (Opus 5), used for a model missing from both tables so spend is never under-counted. */
const DEAREST: ModelPrice = { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 };

/** The price of any model id: known models from the tables, anything else at the dearest known price. */
export function priceOf(model: string): { price: ModelPrice; known: boolean } {
  const p = (MODEL_PRICES as Record<string, ModelPrice>)[model] ?? FALLBACK_PRICES[model];
  return p ? { price: p, known: true } : { price: DEAREST, known: false };
}

/** One sampling iteration of a response (`usage.iterations`), as the cost needs it. */
export interface IterationUsage extends Usage {
  /** The model that ran this iteration; null means the requested model. */
  model: string | null;
}

/**
 * USD for one response. When the response lists its iterations (a server-side fallback re-runs the request on
 * another model inside the same call), each iteration is priced at its own model's rates; otherwise the top-level
 * usage is priced at the model that served it.
 */
export function costOfResponse(
  servedModel: string,
  usage: Usage,
  iterations: readonly IterationUsage[] = [],
): number {
  const priced = (model: string, u: Usage) => usdAt(priceOf(model).price, u);
  if (iterations.length > 0)
    return iterations.reduce((a, it) => a + priced(it.model ?? servedModel, it), 0);
  return priced(servedModel, usage);
}

/**
 * A ceiling on what a call can cost before it is made: the prompt at three characters a token (English text runs
 * nearer four, so this over-counts) at the uncached input price, plus every output token `maxTokens` allows. Used
 * as `projectedUsd`, so a call that could cross a cap is not made.
 */
export function estimateCallUsd(model: string, promptChars: number, maxTokens: number): number {
  const p = priceOf(model).price;
  return (Math.ceil(promptChars / 3) * p.inputPerMTok + maxTokens * p.outputPerMTok) / 1_000_000;
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
