import { FunctionsHttpError } from '@supabase/supabase-js';
import { ASK_LIMITS, type AskCitation, type AskReply } from '@marsad/core';
import { supabase } from '../../lib/supabase';

/** What the page knows when the function itself cannot be reached (not deployed yet, or offline). */
export type AskResult = AskReply | { state: 'unreachable' };

function isReply(x: unknown): x is AskReply {
  return (
    typeof x === 'object' && x !== null && typeof (x as { state?: unknown }).state === 'string'
  );
}

/**
 * Calls the `ask` Edge Function with the signed-in session. A non-2xx reply (not configured, owner only, capped)
 * still carries the JSON body the page renders; only a missing or unreachable function is `unreachable`.
 */
export async function callAsk(body: { question: string } | { mode: 'status' }): Promise<AskResult> {
  if (!supabase) return { state: 'unreachable' };
  const { data, error } = await supabase.functions.invoke<AskReply>('ask', { body });
  if (!error) return isReply(data) ? data : { state: 'unreachable' };
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    try {
      const json: unknown = await res.json();
      if (isReply(json)) return json;
    } catch {
      // A body that is not Ask's JSON: the function is missing or the gateway answered.
    }
  }
  return { state: 'unreachable' };
}

export interface AskLogRow {
  id: number;
  created_at: string;
  question: string;
  answer: string;
  citations: AskCitation[];
  verified: boolean;
  model: string | null;
  usd: number;
  state: 'answered' | 'facts-only' | 'refused' | 'capped';
  as_of: string | null;
}

/** The newest questions from `ask_log` (personal, owner only by row-level security). */
export async function loadAskHistory(): Promise<AskLogRow[]> {
  if (!supabase) throw new Error('not configured');
  const r = await supabase
    .from('ask_log')
    .select('id, created_at, question, answer, citations, verified, model, usd, state, as_of')
    .order('created_at', { ascending: false })
    .limit(ASK_LIMITS.historyRows);
  if (r.error) throw new Error(r.error.message);
  return (r.data as Record<string, unknown>[]).map((x) => ({
    id: Number(x['id']),
    created_at: String(x['created_at']),
    question: String(x['question'] ?? ''),
    answer: String(x['answer'] ?? ''),
    citations: Array.isArray(x['citations']) ? (x['citations'] as AskCitation[]) : [],
    verified: x['verified'] === true,
    model: x['model'] == null ? null : String(x['model']),
    usd: Number(x['usd'] ?? 0),
    state: String(x['state']) as AskLogRow['state'],
    as_of: x['as_of'] == null ? null : String(x['as_of']),
  }));
}
