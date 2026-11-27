import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/** How long a story that arrived while the page was open keeps its "New" tag. */
export const NEW_TAG_MS = 60_000;

export interface LiveNews {
  /** True while the realtime channel is subscribed; false means the page shows what it read at load. */
  live: boolean;
  /** Article ids and filing accessions that arrived while the page was open, with their arrival time (ms). */
  arrived: ReadonlyMap<string, number>;
  /** Now, ticking while any "New" tag is showing, so tags drop after NEW_TAG_MS. */
  now: number;
}

/**
 * Hears new news_articles and filings rows (Supabase Realtime, migration 20270101000000) and refetches the Watch
 * queries that read them. Row-level security applies, so only rows this user can read arrive. When the channel
 * cannot connect, `live` stays false and the page says when it read the rows instead of calling them live.
 */
export function useLiveNews(): LiveNews {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const [arrived, setArrived] = useState<ReadonlyMap<string, number>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const db = supabase;
    if (!db) return;
    const mark = (id: unknown) => {
      if (typeof id !== 'string' || id === '') return;
      setArrived((prev) => new Map(prev).set(id, Date.now()));
    };
    const channel = db
      .channel('watch-news')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'news_articles' },
        (p: { new: Record<string, unknown> }) => {
          mark(p.new['id']);
          void qc.invalidateQueries({ queryKey: ['watch'] });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'filings' },
        (p: { new: Record<string, unknown> }) => {
          mark(p.new['accession']);
          void qc.invalidateQueries({ queryKey: ['companies'] });
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      void db.removeChannel(channel);
    };
  }, [qc]);

  // Tick only while a tag is showing, then drop expired entries.
  const showing = [...arrived.values()].some((t) => now - t < NEW_TAG_MS);
  useEffect(() => {
    if (arrived.size === 0) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setArrived((prev) => {
        const next = new Map([...prev].filter(([, at]) => t - at < NEW_TAG_MS));
        return next.size === prev.size ? prev : next;
      });
    }, 5_000);
    return () => clearInterval(id);
  }, [arrived.size, showing]);

  return { live, arrived, now };
}

/** True when any of the row's source ids arrived less than NEW_TAG_MS ago. */
export function isNew(ids: readonly string[], l: Pick<LiveNews, 'arrived' | 'now'>): boolean {
  return ids.some((id) => {
    const at = l.arrived.get(id);
    return at !== undefined && l.now - at < NEW_TAG_MS;
  });
}
