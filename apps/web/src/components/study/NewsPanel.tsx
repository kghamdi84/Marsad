import { useMemo, useState } from 'react';
import { Info } from '../Info';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOCAL_ZONE, TIER_LABELS, clusterNews, dualClock, etDate } from '@marsad/core';
import { loadNews } from '../../lib/studyPanels';
import { weekdayDayMonth } from '../../lib/dates';
import { t } from '../../strings';
import { PanelShell } from './Panel';

/** Reporting (tier 1 or 2, not opinion) shows by default; opinion and tier 3 or 4 sit behind a toggle (council batch 2). */
const isReporting = (c: { opinionOnly: boolean; bestTier: number }) =>
  !c.opinionOnly && c.bestTier <= 2;

export function NewsPanel({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ['news', ticker], queryFn: () => loadNews(ticker) });
  const clusters = useMemo(() => (q.data ? clusterNews(q.data).slice(0, 15) : []), [q.data]);
  const [all, setAll] = useState(false);
  const n = t.study.news;
  const shown = all ? clusters : clusters.filter(isReporting);
  const hidden = clusters.length - clusters.filter(isReporting).length;
  const days = [...new Set(shown.map((c) => etDate(new Date(c.earliest))))];
  return (
    <PanelShell id="news" title={n.title} state={q}>
      <Info>{n.note}</Info>
      {clusters.length === 0 ? (
        <p className="text-muted">{n.none}</p>
      ) : (
        <>
          {shown.length === 0 && <p className="text-sm text-muted">{n.noReporting}</p>}
          {days.map((d) => (
            <div key={d} className="flex flex-col gap-1">
              <h3 className="text-[13px] font-semibold text-muted">{weekdayDayMonth(d)}</h3>
              <ul className="flex flex-col">
                {shown
                  .filter((c) => etDate(new Date(c.earliest)) === d)
                  .map((c) => {
                    const first = c.articles[0];
                    if (!first) return null;
                    const when = new Date(c.earliest);
                    return (
                      <li key={c.id} className="flex flex-col border-b border-line-soft py-1.5">
                        {/^https:\/\//.test(first.url) ? (
                          <a
                            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                            href={first.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {first.title}
                          </a>
                        ) : (
                          // A vendor link that is not https (for example javascript:) is shown as text, never as a link.
                          <span className="font-medium">{first.title}</span>
                        )}
                        <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                          <span>
                            {dualClock(when, DEFAULT_LOCAL_ZONE).label} {'·'} {first.publisher}
                            {c.outlets.length > 1
                              ? ` and ${c.outlets.length - 1} more (${n.outlets(c.outlets.length)})`
                              : ''}
                          </span>
                          <span
                            className="rounded-sm border border-line px-1.5 py-px text-xs text-fg"
                            title={TIER_LABELS[c.bestTier]}
                          >
                            {n.tier(c.bestTier)}
                          </span>
                          <span>{c.opinionOnly ? n.opinion : n.reporting}</span>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              aria-pressed={all}
              onClick={() => setAll(!all)}
              className="min-h-11 self-start rounded-xl border border-muted/35 px-3 text-sm text-white"
            >
              {all ? n.reportingOnly : n.showOpinion(hidden)}
            </button>
          )}
        </>
      )}
    </PanelShell>
  );
}
