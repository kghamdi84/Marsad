import { useMemo, useState } from 'react';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, TIER_LABELS, clusterNews, dualClock, etDate } from '@marsad/core';
import { loadNews } from '../../lib/studyPanels';
import { dayMonth } from '../../lib/dates';
import { t } from '../../strings';
import { Num, Pill } from '../ui/kit';
import { PanelShell } from './Panel';

/** Reporting (tier 1 or 2, not opinion) shows by default; opinion and tier 3 or 4 sit behind a toggle (council batch 2). */
const isReporting = (c: { opinionOnly: boolean; bestTier: number }) =>
  !c.opinionOnly && c.bestTier <= 2;

const FIRST = 4;

/**
 * Latest company news (v2): the newest stories, one row each, with tier, reporting or opinion, and the time in ET and
 * local. Stored news from the news job, never called live; the newest time sits in the card header.
 */
export function NewsPanel({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['news', ticker], queryFn: () => loadNews(ticker) });
  const clusters = useMemo(
    () =>
      q.data
        ? clusterNews(q.data)
            .sort((a, b) => Date.parse(b.earliest) - Date.parse(a.earliest))
            .slice(0, 15)
        : [],
    [q.data],
  );
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  const n = t.study.news;
  const filtered = all ? clusters : clusters.filter(isReporting);
  const shown = more ? filtered : filtered.slice(0, FIRST);
  const hidden = clusters.length - clusters.filter(isReporting).length;
  const newest = clusters[0];
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${dayMonth(etDate(d))} ${dualClock(d, DEFAULT_LOCAL_ZONE).label}`;
  };
  return (
    <PanelShell
      id="news"
      title={n.title}
      state={q}
      aside={
        newest ? (
          <span className="text-xs text-ink3">
            <Num>{n.newest(when(newest.earliest))}</Num>
          </span>
        ) : undefined
      }
    >
      <Info>{n.note}</Info>
      {clusters.length === 0 ? (
        <p className="text-sm text-ink3">{n.none}</p>
      ) : (
        <>
          {filtered.length === 0 && <p className="text-sm text-ink3">{n.noReporting}</p>}
          <ul className="flex flex-col">
            {shown.map((c) => {
              const first = c.articles[0];
              if (!first) return null;
              return (
                <li key={c.id} className="flex flex-col gap-1 border-t border-line py-2.5">
                  {/^https:\/\//.test(first.url) ? (
                    <a
                      className="inline-flex min-h-11 items-center text-sm leading-snug text-ink underline-offset-4 hover:underline"
                      href={first.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {first.title}
                    </a>
                  ) : (
                    // A vendor link that is not https (for example javascript:) is shown as text, never as a link.
                    <span className="text-sm leading-snug text-ink">{first.title}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink3">
                    <span title={TIER_LABELS[c.bestTier]}>
                      <Pill tone={c.bestTier <= 2 ? 'neutral' : 'warn'}>{n.tier(c.bestTier)}</Pill>
                    </span>
                    <span>{c.opinionOnly ? n.opinion : n.reporting}</span>
                    <span>
                      {first.publisher}
                      {c.outlets.length > 1
                        ? ` and ${c.outlets.length - 1} more (${n.outlets(c.outlets.length)})`
                        : ''}
                    </span>
                    <Num>{when(c.earliest)}</Num>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            {filtered.length > FIRST && (
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore(!more)}
                className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
              >
                {more ? n.showFewer : n.showMore(filtered.length - FIRST)}
              </button>
            )}
            {hidden > 0 && (
              <button
                type="button"
                aria-pressed={all}
                onClick={() => setAll(!all)}
                className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
              >
                {all ? n.reportingOnly : n.showOpinion(hidden)}
              </button>
            )}
          </div>
        </>
      )}
    </PanelShell>
  );
}
