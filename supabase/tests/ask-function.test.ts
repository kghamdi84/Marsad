/**
 * The Ask Edge Function's handler (ADR 0054) under Vitest, offline: a scripted fake in place of Claude and an
 * in-memory fake in place of Supabase. Nothing here calls the Anthropic API or spends anything.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { AskReply, AskTickerSummaryRow } from '@marsad/core';
import {
  handleAsk,
  type AiUsageInsert,
  type AskDeps,
  type AskLogInsert,
  type AskModel,
  type AskStore,
} from '../functions/ask/handler.ts';

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = Message['content'][number];

const NOW = new Date('2026-11-28T15:00:00Z');

const NVDA: AskTickerSummaryRow = {
  version: 'ticker-summary-1',
  date: '2026-11-27',
  ticker: 'NVDA',
  close: 189,
  close_date: '2026-11-27',
  return_1w: -0.0234,
  return_1y: 0.2345,
  beta: 1.71,
  computed_at: '2026-11-28T11:31:02Z',
};

/** F2 is NVDA's last close once get_ticker_summary has run first. */
const CLOSE = 'F2';

function message(
  content: Block[],
  stop_reason: Message['stop_reason'],
  over: Partial<Message> = {},
): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2000,
      output_tokens: 300,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...over,
  } as unknown as Message;
}

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block;
const toolUse = (name: string, input: unknown, id = `toolu_${name}`) =>
  ({ type: 'tool_use', id, name, input }) as unknown as Block;

/** Replies in order; each call's params are copied so later pushes do not change what was sent. */
function scripted(...steps: (Message | Error)[]) {
  const calls: Params[] = [];
  const model: AskModel = {
    async create(params) {
      calls.push(structuredClone(params));
      const step = steps.shift();
      if (!step) throw new Error('the script ran out');
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return { model, calls };
}

interface FakeOptions {
  owner?: boolean;
  user?: string | null;
  usage?: { createdAt: string; model: string; usd: number }[];
  caps?: { dailyUsd: number | null; monthlyUsd: number | null };
  failTicker?: boolean;
}

function fakeStore(o: FakeOptions = {}) {
  const logged: AskLogInsert[] = [];
  const reads: string[] = [];
  const store: AskStore = {
    async userId() {
      return o.user === undefined ? 'owner-id' : o.user;
    },
    async isOwner() {
      return o.owner ?? true;
    },
    async preferredCaps() {
      return o.caps ?? { dailyUsd: null, monthlyUsd: null };
    },
    async usageSince() {
      return o.usage ?? [];
    },
    async tickerSummary(t) {
      reads.push(`summary:${t}`);
      if (o.failTicker) throw new Error('ticker_daily_summary: connection reset');
      return t === 'NVDA' ? NVDA : null;
    },
    async holdings() {
      reads.push('holdings');
      return [{ ticker: 'NVDA', shares: 13, cost_basis: 150.2, opened_on: '2026-03-02' }];
    },
    async companyResearch() {
      return null;
    },
    async regime() {
      return null;
    },
    async breadth() {
      return null;
    },
    async filings() {
      return [];
    },
    async alerts() {
      return [];
    },
    async logAsk(row) {
      logged.push(row);
    },
  };
  return { store, logged, reads };
}

function setup(model: AskModel | null, o: FakeOptions = {}, record = true) {
  const fake = fakeStore(o);
  const usageRows: AiUsageInsert[] = [];
  const lines: string[] = [];
  const deps: AskDeps = {
    store: () => fake.store,
    model,
    recordUsage: record
      ? async (rows) => {
          usageRows.push(...rows);
        }
      : null,
    now: () => NOW,
    randomHex: () => '0123456789abcdef',
    log: (l) => lines.push(l),
  };
  return { deps, usageRows, lines, ...fake };
}

async function ask(
  deps: AskDeps,
  body: unknown = { question: 'How is NVDA doing?' },
  headers: Record<string, string> = { authorization: 'Bearer token-abc' },
) {
  const res = await handleAsk(
    new Request('https://example.supabase.co/functions/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    deps,
  );
  return { status: res.status, body: (await res.json()) as AskReply, headers: res.headers };
}

describe('before any spend', () => {
  it('without the key: 503 "not configured", no model call, the budget still shown', async () => {
    const s = setup(null);
    const r = await ask(s.deps);
    expect(r.status).toBe(503);
    expect(r.body.state).toBe('not-configured');
    expect(r.body.budget).toMatchObject({ dailyLeftUsd: 1, monthlyLeftUsd: 10 });
    expect(s.logged).toEqual([]);
  });

  it('without the service key to record spend: also not configured', async () => {
    const { model, calls } = scripted();
    const r = await ask(setup(model, {}, false).deps);
    expect(r.body.state).toBe('not-configured');
    expect(calls).toHaveLength(0);
  });

  it('a member (friend) is refused politely; nothing is read or called', async () => {
    const { model, calls } = scripted();
    const s = setup(model, { owner: false });
    const r = await ask(s.deps);
    expect(r.status).toBe(403);
    expect(r.body.state).toBe('owner-only');
    expect(calls).toHaveLength(0);
    expect(s.reads).toEqual([]);
  });

  it('no token, or a token Supabase Auth rejects: signed out', async () => {
    const { model } = scripted();
    expect((await ask(setup(model).deps, { question: 'x' }, {})).status).toBe(401);
    const r = await ask(setup(model, { user: null }).deps);
    expect(r.status).toBe(401);
    expect(r.body.state).toBe('signed-out');
  });

  it('the daily cap reached: "capped", no call, logged', async () => {
    const { model, calls } = scripted();
    const s = setup(model, {
      usage: [{ createdAt: '2026-11-28T09:00:00Z', model: 'claude-sonnet-5-5', usd: 0.99 }],
    });
    const r = await ask(s.deps);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('capped');
    expect(r.body.budget?.capped).toBe('daily');
    expect(calls).toHaveLength(0);
    expect(s.logged[0]).toMatchObject({ state: 'capped', usd: 0, model: null });
  });

  it('the monthly cap counts spend from other days and other jobs', async () => {
    const { model, calls } = scripted();
    const s = setup(model, {
      usage: [{ createdAt: '2026-11-03T09:00:00Z', model: 'claude-opus-5-5', usd: 9.99 }],
    });
    const r = await ask(s.deps);
    expect(r.body.state).toBe('capped');
    expect(r.body.budget?.capped).toBe('monthly');
    expect(calls).toHaveLength(0);
  });

  it('a lower cap in Settings wins; a higher one does not raise the approved cap', async () => {
    const { model } = scripted();
    const lower = await ask(setup(model, { caps: { dailyUsd: 0.5, monthlyUsd: 50 } }).deps, {
      mode: 'status',
    });
    expect(lower.body.budget).toMatchObject({ dailyCapUsd: 0.5, monthlyCapUsd: 10 });
  });

  it('status mode answers "ready" with spend left, and calls nothing', async () => {
    const { model, calls } = scripted();
    const s = setup(model, {
      usage: [{ createdAt: '2026-11-28T09:00:00Z', model: 'claude-sonnet-5-5', usd: 0.123 }],
    });
    const r = await ask(s.deps, { mode: 'status' });
    expect(r.body.state).toBe('ready');
    expect(r.body.budget).toMatchObject({ dailyLeftUsd: 0.87, state: 'ok' });
    expect(calls).toHaveLength(0);
  });

  it('an empty or over-long question is invalid', async () => {
    const { model } = scripted();
    expect((await ask(setup(model).deps, { question: '  ' })).status).toBe(400);
    expect((await ask(setup(model).deps, { question: 'x'.repeat(501) })).body.state).toBe(
      'invalid',
    );
  });

  it('answers CORS preflight for Marsad origins only', async () => {
    const pre = (origin: string) =>
      handleAsk(
        new Request('https://example.supabase.co/functions/v1/ask', {
          method: 'OPTIONS',
          headers: { origin },
        }),
        setup(null).deps,
      );
    const ok = await pre('https://marsad-k84.netlify.app');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://marsad-k84.netlify.app');
    expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBe(
      null,
    );
  });
});

describe('the tool loop and the checks', () => {
  it('a verified answer: tools as the caller, citations with links, spend recorded and logged', async () => {
    const { model, calls } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'nvda' })], 'tool_use'),
      message(
        [
          text(
            `NVDA closed at $189.00 in the session of 27 November [${CLOSE}]. Marsad never advises on what to do next [F1].`,
          ),
        ],
        'end_turn',
      ),
    );
    const s = setup(model);
    const r = await ask(s.deps);
    expect(r.body.state).toBe('answered');
    expect(r.body.verified).toBe(true);
    expect(r.body.model).toBe('claude-sonnet-5-5');
    expect(r.body.citations.map((c) => c.id)).toEqual([CLOSE, 'F1']);
    expect(r.body.citations[0]).toMatchObject({
      text: '$189.00',
      link: { page: 'study', ticker: 'NVDA', view: 'overview' },
      asOf: '2026-11-28T11:31:02Z',
    });
    expect(r.body.asOf).toBe('2026-11-28T11:31:02Z');
    expect(s.reads).toEqual(['summary:NVDA']);

    // Request shape: Sonnet 5.5, fallbacks on, strict tools, cached system prompt, effort set, no sampling, auto.
    const first = calls[0]!;
    expect(first.model).toBe('claude-sonnet-5-5');
    expect(first.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(first.fallbacks).toBe('default');
    expect(first.output_config).toEqual({ effort: 'medium' });
    expect(first.tool_choice).toEqual({ type: 'auto' });
    expect(first.thinking).toBeUndefined();
    expect('temperature' in first).toBe(false);
    expect(first.system).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    expect(first.tools?.every((t) => 'strict' in t && t.strict === true)).toBe(true);
    // The tool result went back in one user turn with the facts and their ids.
    const second = calls[1]!;
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect((last.content as { content: string }[])[0]!.content).toContain(`"id":"${CLOSE}"`);
    // The assistant turn was appended unchanged (append-only history).
    expect(second.messages[1]).toEqual({ role: 'assistant', content: [expect.any(Object)] });

    expect(s.usageRows).toHaveLength(2);
    expect(s.usageRows[0]).toMatchObject({
      job: 'ask',
      model: 'claude-sonnet-5-5',
      input_tokens: 2000,
      output_tokens: 300,
      fell_back: false,
    });
    // 2,000 in at USD 2 and 300 out at USD 10 per million: USD 0.007 a call.
    expect(r.body.usage.usd).toBeCloseTo(0.014, 12);
    expect(s.logged[0]).toMatchObject({
      state: 'answered',
      verified: true,
      model: 'claude-sonnet-5-5',
    });
  });

  it('a wrong number is regenerated once with the mismatch listed, then the facts only', async () => {
    const wrong = message([text(`NVDA closed at $191.00 [${CLOSE}].`)], 'end_turn');
    const { model, calls } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use'),
      wrong,
      message([text(`NVDA closed at $192.00 [${CLOSE}].`)], 'end_turn'),
    );
    const s = setup(model);
    const r = await ask(s.deps);
    expect(calls).toHaveLength(3);
    const retry = JSON.stringify(calls[2]!.messages.at(-1));
    expect(retry).toContain("Marsad's checks rejected that answer");
    expect(retry).toContain('$191.00 matches no fact');
    expect(r.body.state).toBe('facts-only');
    expect(r.body.reason).toBe('verification-failed');
    expect(r.body.verified).toBe(false);
    expect(r.body.answer).toContain(`NVDA last close (session 2026-11-27): $189.00 [${CLOSE}].`);
    expect(r.body.answer).not.toContain('191');
    expect(r.body.citations.length).toBeGreaterThan(0);
    expect(s.usageRows.every((u) => u.fell_back)).toBe(true);
    expect(s.logged[0]).toMatchObject({ state: 'facts-only', verified: false });
  });

  it('a corrected second attempt is accepted', async () => {
    const { model } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use'),
      message([text(`NVDA closed at $191.00 [${CLOSE}].`)], 'end_turn'),
      message([text(`NVDA closed at $189 [${CLOSE}].`)], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    expect(r.body.state).toBe('answered');
    expect(r.body.answer).toBe(`NVDA closed at $189 [${CLOSE}].`);
  });

  it('advice wording fails the check even with every figure right', async () => {
    const { model } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use'),
      message([text(`NVDA closed at $189.00 [${CLOSE}]. You should buy more [F1].`)], 'end_turn'),
      message([text(`NVDA closed at $189.00 [${CLOSE}]. Consider selling some [F1].`)], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    expect(r.body.state).toBe('facts-only');
    expect(r.body.answer).not.toMatch(/buy more|selling/);
  });

  it('a refusal stops at once: no retry, the facts gathered so far, the refusal state', async () => {
    const { model, calls } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use'),
      message([], 'refusal', {
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      } as Partial<Message>),
    );
    const s = setup(model);
    const r = await ask(s.deps);
    expect(calls).toHaveLength(2);
    expect(r.body.state).toBe('refused');
    expect(r.body.verified).toBe(false);
    expect(r.body.answer).toContain(`[${CLOSE}]`);
    expect(s.usageRows).toHaveLength(2);
  });

  it('a refusal before any tool: nothing to show, said as no data', async () => {
    const { model, calls } = scripted(message([], 'refusal'));
    const r = await ask(setup(model).deps);
    expect(calls).toHaveLength(1);
    expect(r.body).toMatchObject({ state: 'refused', answer: '', reason: 'no-data' });
  });

  it('a max_tokens stop is a failed attempt and is retried once', async () => {
    const { model, calls } = scripted(
      message([text('NVDA closed at')], 'max_tokens'),
      message([text('Marsad never advises [F1].')], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    expect(calls).toHaveLength(2);
    // The cut-off turn was not appended: the retry resends the same history.
    expect(calls[1]!.messages).toEqual(calls[0]!.messages);
    expect(r.body.state).toBe('answered');
  });

  it('a rejected key (typed SDK error) stops without retrying', async () => {
    const { model, calls } = scripted(
      new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers()),
    );
    const s = setup(model);
    const r = await ask(s.deps);
    expect(calls).toHaveLength(1);
    expect(r.body).toMatchObject({
      state: 'facts-only',
      reason: 'key-rejected',
      usage: { calls: 0 },
    });
    expect(s.lines.join('\n')).toContain('key-rejected');
  });

  it('a rate limit is retried once on the second attempt', async () => {
    const { model, calls } = scripted(
      new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', new Headers()),
      message([text('Marsad never advises [F1].')], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    expect(calls).toHaveLength(2);
    expect(r.body.state).toBe('answered');
  });

  it('a bad ticker or a failed read goes back to Claude as a tool error, not a crash', async () => {
    const { model, calls } = scripted(
      message(
        [
          toolUse('get_ticker_summary', { ticker: 'not a ticker!' }, 'toolu_a'),
          toolUse('get_holdings', {}, 'toolu_b'),
        ],
        'tool_use',
      ),
      message([text('You hold 13 shares of NVDA [F3].')], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    const results = calls[1]!.messages.at(-1)!.content as { is_error?: boolean; content: string }[];
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0]!.content).toMatch(/^Data unavailable/);
    expect(r.body.state).toBe('answered');
    // Holdings got F2 (open count) and F3 (shares): the failed read took no id.
    expect(r.body.citations[0]).toMatchObject({ id: 'F3', text: '13' });
  });

  it('a store failure inside a tool is reported to Claude as data unavailable', async () => {
    const { model, calls } = scripted(
      message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use'),
      message([text('The NVDA data is unavailable [F1].')], 'end_turn'),
    );
    const r = await ask(setup(model, { failTicker: true }).deps);
    expect(JSON.stringify(calls[1]!.messages.at(-1))).toContain('connection reset');
    expect(r.body.state).toBe('answered');
  });

  it('after the tool turn limit, the next call may not use tools', async () => {
    const loop = Array.from({ length: 4 }, (_, i) =>
      message([toolUse('get_regime', {}, `toolu_${i}`)], 'tool_use'),
    );
    const { model, calls } = scripted(
      ...loop,
      message([text('No regime is stored [F2].')], 'end_turn'),
    );
    const r = await ask(setup(model).deps);
    expect(calls.map((c) => c.tool_choice?.type)).toEqual(['auto', 'auto', 'auto', 'auto', 'none']);
    expect(r.body.state).toBe('answered');
  });

  it('stops calling when the next call would pass the cap, and shows the facts so far', async () => {
    const pricey = message([toolUse('get_ticker_summary', { ticker: 'NVDA' })], 'tool_use', {
      usage: { input_tokens: 20_000, output_tokens: 1_000 },
    } as Partial<Message>);
    const { model, calls } = scripted(pricey, message([text('unused')], 'end_turn'));
    const s = setup(model, {
      usage: [{ createdAt: '2026-11-28T09:00:00Z', model: 'claude-sonnet-5-5', usd: 0.94 }],
    });
    const r = await ask(s.deps);
    // 0.94 + 0.03 fits; after the call (USD 0.05) another would not.
    expect(calls).toHaveLength(1);
    expect(r.body.state).toBe('capped');
    expect(r.body.answer).toContain(`[${CLOSE}]`);
    expect(s.usageRows).toHaveLength(1);
  });

  it('a fallback model is recorded under its own name and price', async () => {
    const { model } = scripted(
      message([text('Marsad never advises [F1].')], 'end_turn', { model: 'claude-sonnet-5' }),
    );
    const s = setup(model);
    const r = await ask(s.deps);
    expect(r.body.model).toBe('claude-sonnet-5');
    expect(s.usageRows[0]?.model).toBe('claude-sonnet-5');
  });
});
