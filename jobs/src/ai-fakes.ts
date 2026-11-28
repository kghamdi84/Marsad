/**
 * Test doubles for the AI layer: a Messages client that replays recorded-shaped responses (the fields and nesting
 * of a real beta Messages response, with made-up text) and an in-memory ledger. Nothing here calls the API.
 */
import type { AiLedger, AiUsageRow, Message, MessageParams, MessagesClient } from './anthropic.js';

export interface FakeReply {
  /** The JSON text the model returns, or any string to test a bad reply. */
  text?: string;
  stop?: 'end_turn' | 'max_tokens' | 'refusal' | 'pause_turn';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Throw this instead of answering. */
  error?: Error;
}

/** A response shaped like the API's: a thinking block (display omitted), then the text block. */
export function recordedMessage(requested: string, r: FakeReply): Message {
  const stop = r.stop ?? 'end_turn';
  return {
    id: 'msg_01TestRecordedShape',
    type: 'message',
    role: 'assistant',
    model: r.model ?? requested,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig-test' },
      ...(stop === 'refusal' ? [] : [{ type: 'text', text: r.text ?? '', citations: null }]),
    ],
    stop_reason: stop,
    stop_sequence: null,
    stop_details:
      stop === 'refusal'
        ? { type: 'refusal', category: 'general_harms', explanation: 'Declined in a test.' }
        : null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: r.inputTokens ?? 2_000,
      output_tokens: r.outputTokens ?? 400,
      cache_read_input_tokens: r.cacheRead ?? 0,
      cache_creation_input_tokens: r.cacheWrite ?? 0,
      cache_creation: null,
      inference_geo: 'us',
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: 'standard',
      fallback_credit: null,
    },
  } as unknown as Message;
}

export function json(text: string): string {
  return JSON.stringify({ text });
}

/** Replays replies in order and keeps every request it was sent. */
export function fakeClient(replies: FakeReply[]): MessagesClient & { requests: MessageParams[] } {
  const requests: MessageParams[] = [];
  return {
    requests,
    create(params) {
      requests.push(params);
      const r = replies.shift();
      if (!r) return Promise.reject(new Error('fake client: no reply left'));
      if (r.error) return Promise.reject(r.error);
      return Promise.resolve(recordedMessage(params.model, r));
    },
  };
}

export function fakeLedger(
  spent = { dailyUsd: 0, monthlyUsd: 0 },
  saved: { dailyUsd: number | null; monthlyUsd: number | null } | null = null,
): AiLedger & { rows: AiUsageRow[] } {
  const rows: AiUsageRow[] = [];
  return {
    rows,
    spent: () => {
      const usd = rows.reduce((a, r) => a + r.usd, 0);
      return Promise.resolve({
        dailyUsd: spent.dailyUsd + usd,
        monthlyUsd: spent.monthlyUsd + usd,
      });
    },
    savedCaps: () => Promise.resolve(saved),
    recordUsage: (row) => {
      rows.push(row);
      return Promise.resolve();
    },
  };
}
