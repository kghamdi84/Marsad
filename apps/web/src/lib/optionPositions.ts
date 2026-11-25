import type { OptionLeg, OptionPosition } from '@marsad/core';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

export interface StoredOptionPosition extends OptionPosition {
  id: number;
}

/** Open positions and the newest stored close of each underlying. */
export async function loadOptionPositions(): Promise<{
  positions: StoredOptionPosition[];
  closes: Record<string, { value: number; asOf: string }>;
}> {
  const r = await client()
    .from('option_positions')
    .select(
      'id, underlying, label, expiry, legs, opened_on, exit_dte, profit_take_pct, loss_limit_pct, bear_case',
    )
    .is('closed_on', null)
    .order('expiry', { ascending: true });
  if (r.error) throw new Error(`option_positions: ${r.error.message}`);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const positions = ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: Number(x['id']),
    underlying: String(x['underlying']),
    label: String(x['label']),
    expiry: String(x['expiry']),
    legs: ((x['legs'] ?? []) as Record<string, unknown>[]).map((l): OptionLeg => ({
      type: l['type'] === 'put' ? 'put' : 'call',
      strike: Number(l['strike']),
      qty: Number(l['qty']),
      price: Number(l['price']),
    })),
    openedOn: String(x['opened_on']),
    exitDte: n(x['exit_dte']),
    profitTakePct: n(x['profit_take_pct']),
    lossLimitPct: n(x['loss_limit_pct']),
    bearCase: String(x['bear_case']),
  }));
  const closes: Record<string, { value: number; asOf: string }> = {};
  for (const t of [...new Set(positions.map((p) => p.underlying))]) {
    const b = await client()
      .from('daily_bars')
      .select('date, close')
      .eq('ticker', t)
      .order('date', { ascending: false })
      .limit(1);
    if (b.error) throw new Error(`daily_bars ${t}: ${b.error.message}`);
    const row = (b.data ?? [])[0] as Record<string, unknown> | undefined;
    if (row) closes[t] = { value: Number(row['close']), asOf: String(row['date']) };
  }
  return { positions, closes };
}

export async function addOptionPosition(p: OptionPosition): Promise<void> {
  const r = await client().from('option_positions').insert({
    underlying: p.underlying,
    label: p.label.trim(),
    expiry: p.expiry,
    legs: p.legs,
    opened_on: p.openedOn,
    exit_dte: p.exitDte,
    profit_take_pct: p.profitTakePct,
    loss_limit_pct: p.lossLimitPct,
    bear_case: p.bearCase.trim(),
  });
  if (r.error) throw new Error(`option_positions: ${r.error.message}`);
}

export async function closeOptionPosition(id: number, on: string, note: string): Promise<void> {
  const r = await client()
    .from('option_positions')
    .update({ closed_on: on, close_note: note.trim() === '' ? null : note.trim().slice(0, 500) })
    .eq('id', id);
  if (r.error) throw new Error(`option_positions: ${r.error.message}`);
}
