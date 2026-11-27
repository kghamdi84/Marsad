import { useState } from 'react';
import { seriesSnapshot, topicSummary, type Topic } from '@marsad/core';
import { Info } from '../Info';
import { Card, Details, ScrollX } from '../Card';
import { num, td, th, thNum } from '../study/Panel';
import { SnapshotTable } from './Measures';
import { fixed } from './format';
import type { RegimeData } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const g = r.geopolitics;

/** Ratio tone: 1.5 times the norm or more is a highlight, under 1 is quieter than usual. */
const ratioTone = (ratio: number | null) =>
  ratio === null ? 'text-ink3' : ratio >= 1.5 ? 'text-warn' : ratio >= 1 ? 'text-ink' : 'text-up';

/** Keyword topic counts against their 4-week norm, GPR and EPU percentiles, headlines and the reacting assets. */
export function Geopolitics({ data }: { data: RegimeData }) {
  const last = data.topics.at(-1);
  const gpr = seriesSnapshot(data.gpr);
  const epu = seriesSnapshot(data.series['USEPUINDXD'] ?? []);
  const sum = last ? topicSummary(data.topics, last.date) : null;
  const top = sum
    ? [...sum.readings].sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))[0]?.topic
    : undefined;
  const [picked, setPicked] = useState<Topic | null>(null);
  const topic = picked ?? top ?? null;
  const samples = (tp: Topic) => [...data.topics].reverse().flatMap((d) => d.samples[tp] ?? []);
  const headline = (s: { title: string; url: string }) =>
    /^https:\/\//.test(s.url) ? (
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center text-link underline underline-offset-2"
      >
        {s.title}
      </a>
    ) : (
      s.title
    );
  const indexes = [
    gpr ? u.percentileChip('GPR', r.ordinal(Math.round(gpr.percentile)), gpr.date) : null,
    epu ? u.percentileChip('EPU', r.ordinal(Math.round(epu.percentile)), epu.date) : null,
  ].filter((x): x is string => x !== null);
  const aside =
    indexes.length > 0 ? (
      <span className="text-xs text-ink3">{indexes.join(' · ')}</span>
    ) : undefined;
  const assets = (
    <>
      <h3 className="text-sm font-semibold text-ink">{g.assetsTitle}</h3>
      <SnapshotTable
        label={g.assetsTitle}
        rows={[
          { label: g.oil, obs: data.series['DCOILWTICO'] ?? [] },
          { label: g.dollar, obs: data.series['DTWEXBGS'] ?? [] },
          { label: g.dgs10, obs: data.series['DGS10'] ?? [] },
          { label: g.gld, obs: data.bars['GLD'] ?? [] },
          { label: g.ita, obs: data.bars['ITA'] ?? [] },
          { label: g.iyt, obs: data.bars['IYT'] ?? [] },
        ]}
      />
      <Info>{g.source}</Info>
    </>
  );
  if (!last || !sum)
    return (
      <Card id="geopolitics" title={g.title} subtitle={g.intro} aside={aside}>
        <p className="text-sm text-ink3">{g.none}</p>
        <Details>{assets}</Details>
      </Card>
    );
  const sel = topic ? samples(topic).slice(0, 3) : [];
  return (
    <Card
      id="geopolitics"
      title={g.title}
      subtitle={`${u.keywordTopics} · ${g.asOf(last.date, sum.recentDays, sum.baselineDays)}`}
      aside={aside}
    >
      <div
        role="group"
        aria-label={g.colTopic}
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}
      >
        {sum.readings.map((x) => {
          const on = x.topic === topic;
          return (
            <button
              key={x.topic}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(x.topic)}
              className={`flex min-h-11 flex-col gap-1 rounded-[10px] border px-3 py-2.5 text-start ${on ? 'border-up' : 'border-line'} bg-elev`}
            >
              <span className="text-[13px] font-semibold text-ink">
                {g.names[x.topic] ?? x.topic}
              </span>
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="text-xs text-ink3">{u.articlesN(x.last7)}</span>
                <span className={`text-[13px] font-semibold ${ratioTone(x.ratio)}`}>
                  {x.ratio === null ? g.noRatio : u.ratioX(fixed(x.ratio, 1))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {topic && (
        <div className="flex flex-col rounded-[10px] border border-line bg-elev px-4 py-3">
          <h3 className="pb-1.5 text-[13px] font-normal text-ink3">
            {u.topicHeadlines(g.names[topic] ?? topic, sel.length)}
          </h3>
          {sel.length === 0 && <p className="text-sm text-ink3">{u.noHeadlines}</p>}
          <ul>
            {sel.map((s2) => (
              <li
                key={s2.url + s2.title}
                className="flex flex-col gap-0.5 border-t border-line py-2 text-sm"
              >
                {headline(s2)}
                <span className="text-xs text-ink3">
                  {s2.publisher}, {s2.publishedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Info>{g.intro}</Info>
      <Details>
        <ScrollX label={u.tables.topics}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{g.colTopic}</th>
                <th className={thNum}>{g.colLast7}</th>
                <th className={thNum}>{g.colShare}</th>
                <th className={thNum}>{g.colBaseline}</th>
                <th className={thNum}>{g.colRatio}</th>
                <th className={th}>{g.colLatest}</th>
              </tr>
            </thead>
            <tbody>
              {sum.readings.map((x) => {
                const s2 = samples(x.topic)[0];
                return (
                  <tr key={x.topic}>
                    <td className={td}>{g.names[x.topic] ?? x.topic}</td>
                    <td className={`${td} ${num}`}>{x.last7}</td>
                    <td className={`${td} ${num}`}>
                      {x.share7 === null ? r.noData : `${fixed(x.share7 * 100, 1)}%`}
                    </td>
                    <td className={`${td} ${num}`}>
                      {x.weeklyBaseline === null ? r.noData : fixed(x.weeklyBaseline, 1)}
                    </td>
                    <td className={`${td} ${num}`}>
                      {x.ratio === null ? g.noRatio : g.ratio(fixed(x.ratio, 1))}
                    </td>
                    <td className={td}>
                      {s2 && headline(s2)}
                      {s2 && (
                        <span className="block text-xs text-ink3">
                          {s2.publisher}, {s2.publishedAt.slice(0, 10)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
        {assets}
      </Details>
    </Card>
  );
}
