import {
  DEFAULT_SOURCE_POLICIES,
  buildCalendar,
  describeSourceHealth,
  sessionInfo,
  type MarketCalendar,
  type SessionInfo,
  type UpcomingRow,
} from '@marsad/core';
import { supabase } from './supabase';

/** The two facts the shell shows on every page: the market session and which sources have gone quiet. */
export interface Pulse {
  calendar: MarketCalendar;
  sources: { source: string; name: string; lastMessageAt: string | null }[];
}

export interface PulseView {
  session: SessionInfo;
  /** Display names of sources past their silence limit for this session. */
  stale: string[];
  /** Sources whose limit depends on the session while the market calendar is not loaded: not judged. */
  unchecked: string[];
}

export async function loadPulse(): Promise<Pulse> {
  if (!supabase) throw new Error('not configured');
  const [sources, holidays] = await Promise.all([
    supabase.from('source_status').select('source, display_name, last_message_at'),
    supabase
      .from('market_holidays')
      .select('date, exchange, name, status, open_at, close_at')
      .eq('exchange', 'NYSE'),
  ]);
  if (sources.error) throw new Error(`source_status: ${sources.error.message}`);
  if (holidays.error) throw new Error(`market_holidays: ${holidays.error.message}`);
  const rows: UpcomingRow[] = ((holidays.data ?? []) as Record<string, string | null>[]).map(
    (h) => ({
      date: String(h['date']),
      exchange: String(h['exchange']),
      name: String(h['name']),
      status: String(h['status']),
      ...(h['open_at'] ? { open: h['open_at'] } : {}),
      ...(h['close_at'] ? { close: h['close_at'] } : {}),
    }),
  );
  return {
    calendar: buildCalendar(rows, 'NYSE'),
    sources: ((sources.data ?? []) as Record<string, string | null>[]).map((s) => ({
      source: String(s['source']),
      name: String(s['display_name'] ?? s['source']),
      lastMessageAt: s['last_message_at'] ?? null,
    })),
  };
}

/** The session now and the stale sources, judged by the same policies as the Status page. */
export function viewPulse(p: Pulse, now: Date): PulseView {
  const unchecked: string[] = [];
  const stale = p.sources.flatMap((s) => {
    const policy = DEFAULT_SOURCE_POLICIES.find((x) => x.source === s.source);
    if (!policy) return [];
    const v = describeSourceHealth(
      policy,
      s.lastMessageAt ? new Date(s.lastMessageAt) : null,
      now,
      p.calendar,
    );
    if (v.state === 'calendar-missing') unchecked.push(s.name);
    return v.state === 'stale' ? [s.name] : [];
  });
  return { session: sessionInfo(now, p.calendar), stale, unchecked };
}
