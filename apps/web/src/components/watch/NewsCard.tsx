import { useMemo, type ReactNode } from 'react';
import {
  TIER_LABELS,
  clusterNews,
  describeEightK,
  dualClock,
  etDate,
  newsImpact,
  rankByImpact,
  topicSummary,
  type ImpactContext,
  type NewsImpact,
  type SourceTier,
  type TopicDay,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { zoneName } from '../Clock';
import { TickerLink } from '../QuickLook';
import { Pill, type Tone } from '../ui/kit';
import { useDisplay } from '../../lib/display';
import { dayMonth } from '../../lib/dates';
import { secUrl } from '../../lib/study';
import type { StoredFiling, WatchData } from '../../lib/watch';
import { isNew, type LiveNews } from '../../lib/liveNews';
import { Aside, v, w } from './shared';

const n = v.news;

interface Ranked {
  id: string;
  /** Article ids or the filing accession behind the row, to mark rows that arrived while the page was open. */
  sourceIds: string[];
  at: string;
  /** False for a filing without an acceptance time: only its date is known. */
  timed: boolean;
  title: string;
  url: string | null;
  source: string;
  tier: SourceTier;
  opinion: boolean;
  tickers: string[];
  /** For filings: the plain words of the most material 8-K item. */
  plain: string | null;
  impact: NewsImpact;
}

const IMPACT_TONE: Record<string, Tone> = { high: 'warn', medium: 'neutral', low: 'neutral' };

/** The topic ratios (`topics-1`) as of the newest stored topic day; empty before the first run. */
function ratios(days: readonly TopicDay[]): ImpactContext['topicRatios'] {
  const last = days.at(-1);
  if (!last) return {};
  return Object.fromEntries(topicSummary(days, last.date).readings.map((r) => [r.topic, r.ratio]));
}

export function rankNews(
  data: WatchData,
  filings: readonly StoredFiling[],
  holdings: readonly string[],
  topics: readonly TopicDay[],
): Ranked[] {
  const ctx: ImpactContext = {
    watchlist: data.tickers,
    holdings,
    topicRatios: ratios(topics),
  };
  const fromNews = clusterNews(data.news).flatMap((cl): Ranked[] => {
    const first = cl.articles[0];
    if (!first) return [];
    const tickers = [...new Set(cl.articles.flatMap((a) => a.tickers))];
    return [
      {
        id: cl.id,
        sourceIds: cl.articles.map((a) => a.id),
        at: cl.earliest,
        timed: true,
        title: first.title,
        url: /^https:\/\//.test(first.url) ? first.url : null,
        source: first.publisher,
        tier: cl.bestTier,
        opinion: cl.opinionOnly,
        tickers,
        plain: null,
        impact: newsImpact(
          { tier: cl.bestTier, opinion: cl.opinionOnly, tickers, title: first.title },
          ctx,
        ),
      },
    ];
  });
  const fromFilings = filings.map((f): Ranked => {
    const d = describeEightK(f.form.startsWith('8-K') ? f.items : []);
    const top = d.items.find((i) => i.materiality === d.materiality) ?? d.items[0];
    const plain = top?.plain ?? null;
    const title = n.filingTitle(f.tickers[0] ?? f.cik, f.form, f.items.join(', '), plain ?? '');
    return {
      id: f.accession,
      sourceIds: [f.accession],
      at: f.acceptedAt ?? `${f.filingDate}T00:00:00Z`,
      timed: f.acceptedAt !== null,
      title,
      url: secUrl(f.cik, f),
      source: n.secEdgar,
      tier: 1,
      opinion: false,
      tickers: f.tickers,
      plain,
      impact: newsImpact(
        {
          tier: 1,
          filing: { form: f.form, materiality: d.materiality },
          tickers: f.tickers,
          title,
        },
        ctx,
      ),
    };
  });
  return rankByImpact([...fromNews, ...fromFilings]);
}

function When({ r }: { r: Ranked }) {
  const { zone } = useDisplay();
  const at = new Date(r.at);
  if (!r.timed) return <>{dayMonth(r.at.slice(0, 10))}</>;
  const c = dualClock(at, zone);
  return (
    <>
      {dayMonth(etDate(at))} {c.et} ET {'·'} {c.local} {zoneName(zone)}
    </>
  );
}

function Meta({ r, children }: { r: Ranked; children?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink3">
      {children}
      <span>{r.source}</span>
      <span aria-hidden="true">{'·'}</span>
      <span title={TIER_LABELS[r.tier]}>{n.tier(r.tier)}</span>
      {r.opinion && <span className="text-warn">{n.opinion}</span>}
      <span aria-hidden="true">{'·'}</span>
      <span>
        <When r={r} />
      </span>
      {r.tickers.slice(0, 4).map((tk) => (
        <TickerLink key={tk} ticker={tk} className="text-xs font-semibold" />
      ))}
    </span>
  );
}

function Title({ r, className }: { r: Ranked; className: string }) {
  return r.url ? (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} underline decoration-line-strong underline-offset-4 hover:decoration-up`}
    >
      {r.title}
    </a>
  ) : (
    <span className={className}>{r.title}</span>
  );
}

function why(r: Ranked): string {
  const x = r.impact;
  const parts: string[] = [];
  if (x.held.length) parts.push(n.why.held(x.held.join(', ')));
  if (x.watched.length) parts.push(n.why.watched(x.watched.join(', ')));
  if (r.plain) parts.push(n.why.filing(r.plain));
  if (x.topic)
    parts.push(n.why.topic(n.topics[x.topic.topic] ?? x.topic.topic, x.topic.ratio.toFixed(1)));
  parts.push(n.why.tier(r.tier));
  parts.push(n.why.score(x.score, x.version));
  return parts.join(' ');
}

function ImpactPill({ r }: { r: Ranked }) {
  const level = r.impact.level;
  return (
    <Pill tone={IMPACT_TONE[level] ?? 'neutral'} className="text-[11px]">
      {n.impact[level]}
    </Pill>
  );
}

function Row({ r, fresh }: { r: Ranked; fresh: boolean }) {
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2.5">
      <div className="flex items-start justify-between gap-2">
        <Title r={r} className="text-sm leading-snug text-ink" />
        {fresh && (
          <Pill tone="up" className="flex-none font-semibold">
            {n.newTag}
          </Pill>
        )}
      </div>
      <Meta r={r}>
        <ImpactPill r={r} />
      </Meta>
    </li>
  );
}

/** The highlight of the day and four more, ranked by impact (impact-1); the rest one tap away. */
export function NewsCard({
  data,
  filings,
  holdings,
  topics,
  readAt,
  live,
}: {
  data: WatchData;
  filings: readonly StoredFiling[];
  holdings: readonly string[];
  topics: readonly TopicDay[];
  /** When the page read the rows. */
  readAt: number;
  /** The realtime state (migration 20270101000000); new rows refetch the queries above. */
  live: LiveNews;
}) {
  const ranked = useMemo(
    () => rankNews(data, filings, holdings, topics),
    [data, filings, holdings, topics],
  );
  const [hl, ...rest] = ranked;
  const more = rest.slice(4, 20);
  return (
    <Card
      id="watch-news-h"
      title={w.news.title}
      aside={
        <span role="status" className="flex items-center gap-1.5">
          {live.live && <span aria-hidden="true" className="size-2 rounded-full bg-up" />}
          <Aside>
            {live.live
              ? n.live(dualClock(new Date(readAt)).et)
              : n.asOf(dualClock(new Date(readAt)).et)}
          </Aside>
        </span>
      }
    >
      {!hl ? (
        <p className="text-sm text-ink3">{w.news.none}</p>
      ) : (
        <>
          <article className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev p-3.5">
            <Meta r={hl}>
              <Pill tone="warn" className="font-semibold">
                {n.highlight}
              </Pill>
              {isNew(hl.sourceIds, live) && (
                <Pill tone="up" className="font-semibold">
                  {n.newTag}
                </Pill>
              )}
              <ImpactPill r={hl} />
            </Meta>
            <Title r={hl} className="text-lg leading-snug font-medium text-ink" />
            <p className="text-[13px] leading-normal text-ink2">{why(hl)}</p>
          </article>
          <ul className="-mb-2.5 flex flex-col">
            {rest.slice(0, 4).map((r) => (
              <Row key={r.id} r={r} fresh={isNew(r.sourceIds, live)} />
            ))}
          </ul>
          {more.length > 0 && (
            <details className="group rounded-lg border border-line">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-up select-none">
                {n.more(more.length)}
              </summary>
              <ul className="flex flex-col px-3">
                {more.map((r) => (
                  <Row key={r.id} r={r} fresh={isNew(r.sourceIds, live)} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Info>{n.about}</Info>
    </Card>
  );
}
