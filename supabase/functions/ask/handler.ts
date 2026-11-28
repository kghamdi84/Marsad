/**
 * Ask's request handler (checklist 8.1, ADR 0054), kept free of Deno APIs so Vitest runs it with a fake model and a
 * fake store. `index.ts` wires it to Deno.serve, the Anthropic SDK and Supabase.
 *
 * Order of checks, each before any spend: the caller's Supabase session, the app owner (members get "owner only"),
 * the key and the spend recorder ("not configured"), the caps from `ai_usage` ("capped", no call). Then a manual tool
 * loop on Claude Sonnet 5.5 over read-only tools that query Supabase as the caller (row-level security applies), the
 * figure and advice checks, one regeneration with the mismatches listed, and the facts-only text built by code. Every
 * call is priced from its usage fields and written to `ai_usage`; every question to `ask_log`.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ASK_LIMITS,
  ASK_MODEL,
  ASK_SYSTEM_PROMPT,
  ASK_TOOLS,
  ASK_VERSION,
  AskEvidence,
  aiSpend,
  alertsOutput,
  askBudget,
  askFactsTemplate,
  breadthOutput,
  callCost,
  companyResearchOutput,
  describeIssues,
  effectiveCaps,
  filingsOutput,
  holdingsOutput,
  oldestAsOf,
  pricedModel,
  regimeOutput,
  tickerSummaryOutput,
  usageOf,
  validateToolInput,
  verifyAskAnswer,
  type AskAlertRow,
  type AskBreadthRow,
  type AskBudget,
  type AskCompanyResearchRow,
  type AskFilingSectionRow,
  type AskHoldingRow,
  type AskReason,
  type AskRegimeRow,
  type AskReply,
  type AskState,
  type AskTickerSummaryRow,
  type AskToolOutput,
  type AskUsageTotals,
  type ModelId,
} from '@marsad/core';

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;

/** The one model call Ask makes; `index.ts` passes `client.beta.messages.create`. */
export interface AskModel {
  create(params: CreateParams): Promise<Message>;
}

/** One `public.ai_usage` row. */
export interface AiUsageInsert {
  job: 'ask';
  purpose: string;
  model: ModelId;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  usd: number;
  fell_back: boolean;
}

/** One `public.ask_log` row (owner_id defaults to the caller). */
export interface AskLogInsert {
  question: string;
  answer: string;
  citations: unknown;
  verified: boolean;
  model: string | null;
  usd: number;
  state: AskState;
  as_of: string | null;
}

/** Everything Ask reads or writes, as the signed-in caller (row-level security applies). */
export interface AskStore {
  /** The caller's user id after Supabase Auth checks the token, or null. */
  userId(): Promise<string | null>;
  isOwner(): Promise<boolean>;
  preferredCaps(): Promise<{ dailyUsd: number | null; monthlyUsd: number | null }>;
  usageSince(iso: string): Promise<{ createdAt: string; model: string; usd: number }[]>;
  tickerSummary(ticker: string): Promise<AskTickerSummaryRow | null>;
  holdings(): Promise<AskHoldingRow[]>;
  companyResearch(ticker: string): Promise<AskCompanyResearchRow | null>;
  regime(): Promise<AskRegimeRow | null>;
  breadth(): Promise<AskBreadthRow | null>;
  filings(ticker: string): Promise<AskFilingSectionRow[]>;
  alerts(): Promise<AskAlertRow[]>;
  logAsk(row: AskLogInsert): Promise<void>;
}

export interface AskDeps {
  store: (accessToken: string) => AskStore;
  /** Null when `ANTHROPIC_API_KEY` is not set. */
  model: AskModel | null;
  /** Writes `ai_usage` with the service key (the only system write); null when that key is missing. */
  recordUsage: ((rows: AiUsageInsert[]) => Promise<void>) | null;
  now: () => Date;
  /** 16 fresh random hex characters per call (crypto). */
  randomHex: () => string;
  log: (line: string) => void;
}

const ALLOWED_ORIGINS = [
  /^https:\/\/marsad-k84\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--marsad-k84\.netlify\.app$/,
  /^http:\/\/localhost:(?:5173|4173)$/,
];

function cors(origin: string | null): Record<string, string> {
  const ok = origin !== null && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const ZERO: AskUsageTotals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usd: 0,
};

function reply(partial: Partial<AskReply> & { state: AskState }): AskReply {
  return {
    version: ASK_VERSION,
    reason: null,
    answer: '',
    citations: [],
    verified: false,
    model: null,
    usage: { ...ZERO },
    asOf: null,
    budget: null,
    ...partial,
  };
}

const STATUS: Record<AskState, number> = {
  ready: 200,
  answered: 200,
  'facts-only': 200,
  refused: 200,
  capped: 200,
  'not-configured': 503,
  'owner-only': 403,
  'signed-out': 401,
  invalid: 400,
  error: 500,
};

/** Turns a model call failure into a reason; `fatal` stops further calls for this question. */
function classify(e: unknown): { reason: AskReason; fatal: boolean; detail: string } {
  const detail = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return { reason: 'key-rejected', fatal: true, detail };
  if (e instanceof Anthropic.BadRequestError) return { reason: 'api-error', fatal: true, detail };
  if (e instanceof Anthropic.RateLimitError)
    return { reason: 'rate-limited', fatal: false, detail };
  if (e instanceof Anthropic.APIConnectionError)
    return { reason: 'unreachable', fatal: false, detail };
  if (e instanceof Anthropic.APIError) return { reason: 'api-error', fatal: false, detail };
  return { reason: 'api-error', fatal: true, detail };
}

class Stop extends Error {
  constructor(
    readonly reason: AskReason | 'refusal' | 'cap',
    readonly fatal: boolean,
  ) {
    super(reason);
  }
}

const TOOLS: Anthropic.Beta.Messages.BetaTool[] = ASK_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  strict: true,
  input_schema: {
    type: 'object',
    properties: t.input_schema.properties,
    required: [...t.input_schema.required],
    additionalProperties: false,
  },
}));

async function toolOutput(store: AskStore, name: string, input: unknown): Promise<AskToolOutput> {
  const v = validateToolInput(name, input);
  if (!v.ok) throw new Error(v.error);
  const ticker = v.ticker ?? '';
  switch (v.tool) {
    case 'get_ticker_summary':
      return tickerSummaryOutput(await store.tickerSummary(ticker), ticker);
    case 'get_holdings':
      return holdingsOutput(await store.holdings());
    case 'get_company_research':
      return companyResearchOutput(await store.companyResearch(ticker), ticker);
    case 'get_regime':
      return regimeOutput(await store.regime());
    case 'get_breadth':
      return breadthOutput(await store.breadth());
    case 'get_filings':
      return filingsOutput(await store.filings(ticker), ticker);
    case 'get_alerts':
      return alertsOutput(await store.alerts());
  }
}

interface Spend {
  todayUsd: number;
  monthUsd: number;
}

/** Answers one question. Never throws: every failure ends in a reply the page can show. */
async function answerQuestion(
  question: string,
  model: AskModel,
  deps: AskDeps,
  store: AskStore,
  spent: Spend,
  caps: { dailyUsd: number; monthlyUsd: number },
): Promise<{ reply: AskReply; rows: AiUsageInsert[] }> {
  const started = deps.now().getTime();
  const evidence = new AskEvidence();
  const messages: MessageParam[] = [{ role: 'user', content: question }];
  const rows: AiUsageInsert[] = [];
  const totals: AskUsageTotals = { ...ZERO };
  let lastModel: string | null = null;

  const budgetNow = (): AskBudget =>
    askBudget(
      { todayUsd: spent.todayUsd + totals.usd, monthUsd: spent.monthUsd + totals.usd },
      caps,
    );

  async function call(lastTurn: boolean): Promise<Message> {
    if (totals.calls >= ASK_LIMITS.maxModelCalls) throw new Stop('too-many-calls', true);
    if (deps.now().getTime() - started > 110_000) throw new Stop('timeout', true);
    if (budgetNow().state === 'capped') throw new Stop('cap', true);
    let msg: Message;
    try {
      msg = await model.create({
        model: ASK_MODEL,
        max_tokens: ASK_LIMITS.maxTokens,
        // Server-side fallback: a declined request is retried on Anthropic's recommended model for its category.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Adaptive thinking is the default on this model; effort is set explicitly (medium: multistep tool use).
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: ASK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        tool_choice: lastTurn ? { type: 'none' } : { type: 'auto' },
        // Caches the conversation so far, so each tool turn rereads the earlier ones at the cache price.
        cache_control: { type: 'ephemeral' },
        messages,
      });
    } catch (e) {
      const c = classify(e);
      deps.log(`ask: model call failed (${c.reason}): ${c.detail}`);
      throw new Stop(c.reason, c.fatal);
    }
    const priced = pricedModel(msg.model);
    const usage = usageOf(msg.usage);
    // An unknown model is priced as Opus 5.5, the dearest Marsad knows, so the caps stay conservative.
    const usd = callCost(priced ?? 'claude-opus-5-5', usage);
    totals.calls += 1;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheReadTokens += usage.cacheReadTokens;
    totals.cacheWriteTokens += usage.cacheWriteTokens;
    totals.usd += usd;
    lastModel = msg.model;
    rows.push({
      job: 'ask',
      purpose: 'question',
      model: priced ?? ASK_MODEL,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      usd,
      fell_back: false,
    });
    if (!priced) {
      deps.log(`ask: unpriced model ${msg.model}; recorded at ${ASK_MODEL} with Opus 5.5 prices`);
      throw new Stop('api-error', true);
    }
    return msg;
  }

  async function runTools(blocks: ToolUse[]): Promise<ToolResult[]> {
    const outs = await Promise.all(
      blocks.map(async (b) => {
        try {
          return { ok: true as const, out: await toolOutput(store, b.name, b.input) };
        } catch (e) {
          return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    // Ids are given in the order Claude asked, after every read finished.
    return blocks.map((b, i) => {
      const r = outs[i]!;
      if (!r.ok)
        return {
          type: 'tool_result',
          tool_use_id: b.id,
          is_error: true,
          content: `Data unavailable: ${r.error.slice(0, 200)}`,
        };
      return {
        type: 'tool_result',
        tool_use_id: b.id,
        content: evidence.add(r.out, deps.randomHex),
      };
    });
  }

  /** The tool loop for one attempt; returns the final text. */
  async function turns(): Promise<{ text: string; model: string }> {
    for (let turn = 0; ; turn += 1) {
      const msg = await call(turn >= ASK_LIMITS.maxToolTurns);
      // Check the stop reason before reading content or running tools.
      if (msg.stop_reason === 'refusal') throw new Stop('refusal', true);
      if (msg.stop_reason === 'max_tokens') throw new Stop('max-tokens', false);
      messages.push({ role: 'assistant', content: msg.content });
      if (msg.stop_reason === 'pause_turn') continue;
      const uses = msg.content.filter((b): b is ToolUse => b.type === 'tool_use');
      if (msg.stop_reason === 'tool_use' && uses.length > 0) {
        messages.push({ role: 'user', content: await runTools(uses) });
        continue;
      }
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('')
        .trim();
      return { text, model: msg.model };
    }
  }

  let stop: Stop | null = null;
  let feedback: string[] | null = null;
  for (const attempt of [1, 2] as const) {
    if (attempt === 2 && feedback)
      messages.push({
        role: 'user',
        content: `Marsad's checks rejected that answer:\n${feedback.map((f) => `- ${f}`).join('\n')}\nRewrite the whole answer. Every sentence must cite its facts, every figure must match the text of a fact it cites, and no sentence may give advice. Call a tool only if a fact you need is missing.`,
      });
    try {
      const { text, model } = await turns();
      const v = verifyAskAnswer(text, evidence);
      if (v.ok) {
        const citations = evidence.citations(v.citations);
        return {
          rows,
          reply: reply({
            state: 'answered',
            answer: text,
            citations,
            verified: true,
            model,
            usage: totals,
            asOf: oldestAsOf(citations),
            budget: budgetNow(),
          }),
        };
      }
      feedback = describeIssues(v.issues);
      deps.log(`ask: attempt ${attempt} failed the checks: ${feedback.join(' | ')}`);
      stop = new Stop('verification-failed', false);
    } catch (e) {
      stop = e instanceof Stop ? e : new Stop('api-error', true);
      feedback = null;
      if (stop.fatal) break;
    }
  }

  // Facts only: text built by code from the same facts, which passes the verifier by construction.
  for (const r of rows) r.fell_back = true;
  const text = askFactsTemplate(evidence);
  const ids = [...text.matchAll(/\[(F\d+)\]/g)].map((m) => m[1] as string);
  const citations = evidence.citations(ids);
  const state: AskState =
    stop?.reason === 'refusal' ? 'refused' : stop?.reason === 'cap' ? 'capped' : 'facts-only';
  const reason: AskReason | null =
    stop === null || stop.reason === 'refusal' || stop.reason === 'cap'
      ? text === ''
        ? 'no-data'
        : null
      : stop.reason;
  return {
    rows,
    reply: reply({
      state,
      reason,
      answer: text,
      citations,
      verified: false,
      model: lastModel,
      usage: totals,
      asOf: oldestAsOf(citations),
      budget: budgetNow(),
    }),
  };
}

function monthStart(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01T00:00:00Z`;
}

/** The HTTP handler: OPTIONS for CORS, then POST `{question}` or `{mode: "status"}` with the caller's JWT. */
export async function handleAsk(req: Request, deps: AskDeps): Promise<Response> {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  const send = (r: AskReply) =>
    new Response(JSON.stringify(r), { status: STATUS[r.state], headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });

  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (!token) return send(reply({ state: 'signed-out' }));
  const store = deps.store(token);
  let body: { question?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
    if (typeof body !== 'object' || body === null) throw new Error('not an object');
  } catch {
    return send(reply({ state: 'invalid' }));
  }

  try {
    if (!(await store.userId())) return send(reply({ state: 'signed-out' }));
    if (!(await store.isOwner())) return send(reply({ state: 'owner-only' }));

    const now = deps.now();
    const [preferred, usage] = await Promise.all([
      store.preferredCaps(),
      store.usageSince(monthStart(now)),
    ]);
    const caps = effectiveCaps(preferred);
    const spend = aiSpend(usage, now, caps);
    const spent = { todayUsd: spend.todayUsd, monthUsd: spend.monthUsd };
    const budget = askBudget(spent, caps);

    if (!deps.model || !deps.recordUsage) return send(reply({ state: 'not-configured', budget }));
    if (body.mode === 'status')
      return send(reply({ state: budget.state === 'capped' ? 'capped' : 'ready', budget }));

    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (question === '' || question.length > ASK_LIMITS.maxQuestionChars)
      return send(reply({ state: 'invalid', budget }));

    const log = async (r: AskReply) => {
      try {
        await store.logAsk({
          question,
          answer: r.answer,
          citations: r.citations,
          verified: r.verified,
          model: r.model,
          usd: r.usage.usd,
          state: r.state,
          as_of: r.asOf,
        });
      } catch (e) {
        deps.log(`ask: ask_log write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    if (budget.state === 'capped') {
      const r = reply({ state: 'capped', budget });
      await log(r);
      return send(r);
    }

    const recordUsage = deps.recordUsage;
    const { reply: r, rows } = await answerQuestion(question, deps.model, deps, store, spent, caps);
    if (rows.length > 0) {
      try {
        await recordUsage(rows);
      } catch (e) {
        // The spend happened; say so loudly. The next question re-reads ai_usage and would under-count it.
        deps.log(`ask: ai_usage write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await log(r);
    return send(r);
  } catch (e) {
    deps.log(`ask: ${e instanceof Error ? e.message : String(e)}`);
    return send(reply({ state: 'error' }));
  }
}
