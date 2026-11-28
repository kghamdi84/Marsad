/**
 * Ask, the Edge Function (checklist 8.1, ADR 0054). Reads ANTHROPIC_API_KEY from the function secrets; without it
 * every question is answered "not configured" and nothing is spent. SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to every function. Never logs a key.
 */
import Anthropic from '@anthropic-ai/sdk';
import { handleAsk, type AskModel } from './handler.ts';
import { callerStore, usageRecorder } from './store.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const publishable = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

// One retry inside the SDK and a per-call timeout well inside the function's wall-clock limit.
const client = apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }) : null;
const model: AskModel | null = client
  ? { create: (params) => client.beta.messages.create(params) }
  : null;

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve((req) =>
  handleAsk(req, {
    store: (token) => callerStore(url, publishable, token),
    model,
    recordUsage: url && service ? usageRecorder(url, service) : null,
    now: () => new Date(),
    randomHex,
    log: (line) => console.log(line),
  }),
);
