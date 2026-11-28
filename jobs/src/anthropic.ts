/**
 * The one Anthropic client wrapper (ADR 0007). Core holds every grounding rule and never imports the SDK; this file
 * turns a prompt and a payload into the `generate` function `groundedGenerate` calls, and around each call it:
 *
 * 1. checks spend today and this month (UTC) against the caps before calling, with the call's worst case added,
 *    so a call that could cross a cap is not made (the template is used instead);
 * 2. calls the Messages API through the official SDK: exact model id, adaptive thinking, an explicit effort,
 *    structured output through `output_config.format`, the static system prompt marked for caching, and the
 *    server-side refusal fallback (`fallbacks: "default"`);
 * 3. records the call in `ai_usage` (requested and served model, every token count, USD from core's price table,
 *    prompt id and version, purpose, outcome), whether it succeeded or not;
 * 4. reads the stop reason: `max_tokens` is a failure the second attempt retries once, `refusal` ends the attempts
 *    and goes to the template, anything else unexpected is a failure.
 *
 * Tests inject a fake client; nothing here runs without a key, and no test ever calls the API.
 */
import { randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  GROUNDED_TEXT_SCHEMA,
  StopGeneration,
  buildMessages,
  costOfResponse,
  effectiveCaps,
  estimateCallUsd,
  evaluateBudget,
  parseGroundedText,
  type BudgetStatus,
  type Caps,
  type GenerateRequest,
  type IterationUsage,
  type Payload,
  type PromptDef,
  type Usage,
} from '@marsad/core';

export type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Beta.Messages.BetaMessage;

/** What the wrapper needs from the SDK: one non-streaming beta Messages call. */
export interface MessagesClient {
  create(params: MessageParams): Promise<Message>;
}

/** The secret's name, as GitHub Actions passes it. */
export const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';
export const NOT_CONFIGURED = `not configured (${ANTHROPIC_KEY_ENV} secret missing)`;

/** The real client, or null without a key (the job then records `skipped: not configured` and spends nothing). */
export function anthropicFromEnv(env: NodeJS.ProcessEnv = process.env): MessagesClient | null {
  const apiKey = env[ANTHROPIC_KEY_ENV]?.trim();
  if (!apiKey) return null;
  // The SDK retries 408, 409, 429 and 5xx twice with backoff; the grounded flow adds one more attempt.
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  return { create: (params) => client.beta.messages.create(params) };
}

/** How each prompt is called. Effort is always set (Opus 5.5 defaults to medium, Sonnet 5.5 to high). */
export const CALL_SETTINGS: Readonly<
  Record<string, { effort: 'low' | 'medium' | 'high'; maxTokens: number }>
> = Object.freeze({
  'filing-summary': { effort: 'low', maxTokens: 8_000 },
  'thesis-draft': { effort: 'medium', maxTokens: 8_000 },
  'weekly-review': { effort: 'medium', maxTokens: 8_000 },
});

/** One row of `public.ai_usage` as written. */
export interface AiUsageRow {
  job: string;
  purpose: string;
  model: string;
  served_model: string | null;
  prompt_id: string;
  prompt_version: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  usd: number;
  outcome: 'text' | 'max_tokens' | 'refusal' | 'invalid-json' | 'unexpected-stop' | 'api-error';
  /** True when a server-side fallback model answered instead of the requested one. */
  fell_back: boolean;
}

/** Spend reads and the usage log. Implemented over Supabase in ai-store.ts and by a fake in tests. */
export interface AiLedger {
  /** USD recorded today and this month (UTC) in `ai_usage`. */
  spent(now: Date): Promise<{ dailyUsd: number; monthlyUsd: number }>;
  /** Caps saved in Preferences (they can only lower the approved caps), or null when none are saved. */
  savedCaps(): Promise<{ dailyUsd: number | null; monthlyUsd: number | null } | null>;
  recordUsage(row: AiUsageRow): Promise<void>;
}

export interface AiSessionStats {
  calls: number;
  usd: number;
  /** The newest budget check, for the run's details. */
  budget: BudgetStatus | null;
  /** Distinct warnings (80% of a cap) seen in this run. */
  warnings: string[];
}

function usageOf(m: Message): { usage: Usage; iterations: IterationUsage[] } {
  const u = m.usage;
  const usage: Usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  const iterations: IterationUsage[] = [];
  for (const it of u.iterations ?? []) {
    if (it.type !== 'message' && it.type !== 'fallback_message') continue;
    iterations.push({
      model: it.model ?? null,
      inputTokens: it.input_tokens ?? 0,
      outputTokens: it.output_tokens ?? 0,
      cacheReadTokens: it.cache_read_input_tokens ?? 0,
      cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
    });
  }
  return { usage, iterations };
}

/** Errors a second attempt cannot fix: end the attempts and use the template. */
function isFinal(e: unknown): boolean {
  return (
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    e instanceof Anthropic.BadRequestError ||
    e instanceof Anthropic.NotFoundError ||
    e instanceof Anthropic.UnprocessableEntityError
  );
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'rate limited (429) after the SDK retries';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'request timed out';
  if (e instanceof Anthropic.APIConnectionError) return 'could not reach the API';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''} ${e.name}`.trim();
  return e instanceof Error ? e.message : String(e);
}

const randomHex = () => randomBytes(8).toString('hex');

export interface AiSessionDeps {
  client: MessagesClient;
  ledger: AiLedger;
  job: string;
  now: () => Date;
  /** For tests: the per-call tag id. Defaults to 16 random hex characters from crypto. */
  randomHex?: () => string;
}

/**
 * One job run's AI access. Reads the caps once, then hands out `generate` functions that check the budget before
 * every call and log every call.
 */
export class AiSession {
  readonly stats: AiSessionStats = { calls: 0, usd: 0, budget: null, warnings: [] };
  private caps: Caps | null = null;
  constructor(private readonly deps: AiSessionDeps) {}

  /** The caps in force: the approved ones, lowered by any saved in Preferences. */
  async currentCaps(): Promise<Caps> {
    this.caps ??= effectiveCaps(await this.deps.ledger.savedCaps());
    return this.caps;
  }

  /** Budget without a call, for the run's details and to skip work at the cap. */
  async budget(projectedUsd = 0): Promise<BudgetStatus> {
    const status = evaluateBudget(
      await this.deps.ledger.spent(this.deps.now()),
      await this.currentCaps(),
      projectedUsd,
    );
    this.stats.budget = status;
    if (status.state === 'warn' && !this.stats.warnings.includes(status.message))
      this.stats.warnings.push(status.message);
    return status;
  }

  /** A `generate` function for groundedGenerate, for one prompt and payload. */
  generator(
    def: PromptDef,
    payload: Payload,
    purpose: string,
  ): (req: GenerateRequest) => Promise<string> {
    const settings = CALL_SETTINGS[def.id];
    if (!settings) throw new Error(`No call settings for prompt ${def.id}`);
    return async (req) => {
      const built = buildMessages(def, payload, this.deps.randomHex ?? randomHex);
      const user =
        req.feedback.length === 0
          ? built.user
          : `${built.user}\n\nYour previous answer was rejected for these reasons:\n${req.feedback.map((f) => `- ${f}`).join('\n')}\nWrite it again with every one of them fixed.`;
      const projected = estimateCallUsd(
        def.model,
        built.system.length + user.length,
        settings.maxTokens,
      );
      const budget = await this.budget(projected);
      if (budget.state === 'capped') throw new StopGeneration('cost-cap', budget.message);

      const params: MessageParams = {
        model: def.model,
        max_tokens: settings.maxTokens,
        system: [{ type: 'text', text: built.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: settings.effort,
          format: { type: 'json_schema', schema: { ...GROUNDED_TEXT_SCHEMA } },
        },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      };
      const base = {
        job: this.deps.job,
        purpose,
        model: def.model,
        prompt_id: def.id,
        prompt_version: def.version,
      };
      let message: Message;
      try {
        message = await this.deps.client.create(params);
      } catch (e) {
        // No response, so no tokens were billed; the call is still logged.
        this.stats.calls += 1;
        await this.deps.ledger.recordUsage({
          ...base,
          served_model: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          usd: 0,
          outcome: 'api-error',
          fell_back: false,
        });
        if (isFinal(e)) throw new StopGeneration('generation-failed', describeError(e));
        throw new Error(describeError(e), { cause: e });
      }

      const { usage, iterations } = usageOf(message);
      const served = message.model;
      const usd = costOfResponse(served, usage, iterations);
      const text = message.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      const parsed = message.stop_reason === 'end_turn' ? parseGroundedText(text) : null;
      const outcome: AiUsageRow['outcome'] =
        message.stop_reason === 'refusal'
          ? 'refusal'
          : message.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : message.stop_reason !== 'end_turn'
              ? 'unexpected-stop'
              : parsed === null
                ? 'invalid-json'
                : 'text';
      this.stats.calls += 1;
      this.stats.usd += usd;
      await this.deps.ledger.recordUsage({
        ...base,
        served_model: served,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_write_tokens: usage.cacheWriteTokens,
        usd,
        outcome,
        fell_back: served !== def.model,
      });
      switch (outcome) {
        case 'refusal':
          throw new StopGeneration(
            'refusal',
            `The model declined (${message.stop_details?.category ?? 'no category'})`,
          );
        case 'max_tokens':
          throw new Error(`Stopped at max_tokens (${settings.maxTokens})`);
        case 'unexpected-stop':
          throw new Error(`Unexpected stop reason ${String(message.stop_reason)}`);
        case 'invalid-json':
          throw new Error('The reply was not the requested JSON');
        default:
          return parsed as string;
      }
    };
  }
}
