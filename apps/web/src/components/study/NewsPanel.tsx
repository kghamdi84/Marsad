import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, TIER_LABELS, clusterNews, dualClock, etDate } from '@marsad/core';
import { loadNews } from '../../lib/studyPanels';
import { t } from '../../strings';
import { PanelShell } from './Panel';

export function NewsPanel({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['news', ticker], queryFn: () => loadNews(ticker) });
  const clusters = useMemo(() => (q.data ? clusterNews(q.data).slice(0, 15) : []), [q.data]);
  const n = t.study.news;
  return (
    <PanelShell id="news" title={n.title} state={q}>
      <p className="text-sm text-muted">{n.note}</p>
      {clusters.length === 0 ? (
        <p className="text-muted">{n.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {clusters.map((c) => {
            const first = c.articles[0];
            if (!first) return null;
            const when = new Date(c.earliest);
            return (
              <li key={c.id} className="rounded-sm border border-line p-3">
                <a
                  className="font-medium underline underline-offset-4"
                  href={first.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {first.title}
                </a>
                <p className="text-sm text-muted">
                  {etDate(when)} {dualClock(when, DEFAULT_LOCAL_ZONE).label} | {first.publisher}
                  {c.outlets.length > 1
                    ? ` and ${c.outlets.length - 1} more (${n.outlets(c.outlets.length)})`
                    : ''}
                </p>
                <p className="text-sm">
                  <span
                    className="rounded-sm border border-line px-1.5 py-0.5 text-xs"
                    title={TIER_LABELS[c.bestTier]}
                  >
                    {n.tier(c.bestTier)}
                  </span>{' '}
                  <span className="text-muted">{c.opinionOnly ? n.opinion : n.reporting}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
