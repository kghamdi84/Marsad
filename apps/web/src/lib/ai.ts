import type { CitationRef } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export type AiKind = 'filing-summary' | 'thesis-draft' | 'weekly-review';

/** One stored AI output (ADR 0007): verified model text, or the template with the reason the model was not used. */
export interface AiOutput {
  id: number;
  kind: AiKind;
  ticker: string | null;
  forDate: string | null;
  text: string;
  citations: CitationRef[];
  verified: boolean;
  source: 'model' | 'template';
  fallbackReason: string | null;
  model: string;
  servedModel: string | null;
  prompt: string;
  createdAt: string;
}

const COLUMNS =
  'id, kind, ticker, for_date, text, citations, verified, source, fallback_reason, model, served_model, prompt_id, prompt_version, created_at';

function citation(x: unknown): CitationRef | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['label'] !== 'string') return null;
  const url = typeof r['url'] === 'string' && r['url'].startsWith('https://') ? r['url'] : null;
  return {
    id: r['id'],
    kind: r['kind'] === 'document' ? 'document' : 'fact',
    label: r['label'],
    url,
    source: typeof r['source'] === 'string' ? r['source'] : '',
    asOf: typeof r['asOf'] === 'string' ? r['asOf'] : null,
  };
}

function toOutput(x: Record<string, unknown>): AiOutput {
  return {
    id: Number(x['id']),
    kind: String(x['kind']) as AiKind,
    ticker: x['ticker'] == null ? null : String(x['ticker']),
    forDate: x['for_date'] == null ? null : String(x['for_date']),
    text: String(x['text'] ?? ''),
    citations: (Array.isArray(x['citations']) ? (x['citations'] as unknown[]) : [])
      .map(citation)
      .filter((c): c is CitationRef => c !== null),
    verified: x['verified'] === true,
    source: x['source'] === 'model' ? 'model' : 'template',
    fallbackReason: x['fallback_reason'] == null ? null : String(x['fallback_reason']),
    model: String(x['model'] ?? ''),
    servedModel: x['served_model'] == null ? null : String(x['served_model']),
    prompt: `${String(x['prompt_id'] ?? '')}@${String(x['prompt_version'] ?? '')}`,
    createdAt: new Date(String(x['created_at'])).toISOString(),
  };
}

/** The newest output of a kind for a ticker, or null before the first run. */
export async function loadLatestAiOutput(
  kind: 'filing-summary' | 'thesis-draft',
  ticker: string,
): Promise<AiOutput | null> {
  const r = await client()
    .from('ai_outputs')
    .select(COLUMNS)
    .eq('kind', kind)
    .eq('ticker', ticker)
    .order('created_at', { ascending: false })
    .limit(1);
  if (r.error) throw new Error(`ai_outputs: ${r.error.message}`);
  const x = ((r.data ?? []) as Record<string, unknown>[])[0];
  return x ? toOutput(x) : null;
}

/** The newest weekly review prose for a week, or null when none was written. */
export async function loadWeeklyAiReview(forDate: string): Promise<AiOutput | null> {
  const r = await client()
    .from('ai_outputs')
    .select(COLUMNS)
    .eq('kind', 'weekly-review')
    .eq('for_date', forDate)
    .order('created_at', { ascending: false })
    .limit(1);
  if (r.error) throw new Error(`ai_outputs: ${r.error.message}`);
  const x = ((r.data ?? []) as Record<string, unknown>[])[0];
  return x ? toOutput(x) : null;
}

/** True when the text may be shown as AI text: written by the model and passed by the verifier. */
export const isVerifiedModelText = (o: AiOutput | null | undefined): boolean =>
  !!o && o.source === 'model' && o.verified;
