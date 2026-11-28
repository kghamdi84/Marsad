import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LOCAL_ZONE,
  MIN_LABELLED,
  NEWS_SENTIMENT_VERSION,
  TIER_LABELS,
  classifyPublisher,
  dualClock,
  etDate,
  labelFor,
  newsSentiment,
  toFixedHalfUp,
  type DailyBar,
  type SentimentLabel,
} from '@marsad/core';
import { Segmented } from '../../Card';
import { BarRow, Num, Pill, type Tone } from '../../ui/kit';
import { dayMonth } from '../../../lib/dates';
import { loadAllNewsSince, loadNewsWindow } from '../../../lib/research';
import { t } from '../../../strings';
import { BarChart } from './charts';
import { R, SourceLine, Tile, pctText } from './shared';

const DAY = 86_400_000;
const FILTERS = ['all', 'bullish', 'bearish'] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 8;
const TONE: Record<SentimentLabel, Tone> = { positive: 'up', neutral: 'neutral', negative: 'down' };

export function NewsView({ ticker, bars }: { ticker: string; bars: readonly DailyBar[] }) {
  const x = R.news;
  const now = useMemo(() => new Date(), []);
  // 12 weeks back from this ET week's Monday, with a day of slack for the time zone.
  const monday = useMemo(() => {
    const d = etDate(now);
    const t0 = Date.parse(`${d}T00:00:00Z`);
    return t0 - ((new Date(t0).getUTCDay() + 6) % 7) * DAY;
  }, [now]);
  const since = new Date(monday - (11 * 7 + 1) * DAY).toISOString();
  const weekSince = new Date(monday - DAY).toISOString();
  const mine = useQuery({
    queryKey: ['research-news', ticker, since],
    queryFn: () => loadNewsWindow(ticker, since),
  });
  const others = useQuery({
    queryKey: ['research-news-all', weekSince],
    queryFn: () => loadAllNewsSince(weekSince),
  });
  const s = useMemo(
    () =>
      mine.data
        ? newsSentiment({
            articles: mine.data.rows.map((a) => ({
              publishedAt: a.publishedAt,
              label: labelFor(a.sentiment, ticker),
            })),
            others: (others.data?.rows ?? []).flatMap((a) =>
              a.sentiment
                .filter((e) => e.ticker !== ticker)
                .map((e) => ({
                  ticker: e.ticker,
                  publishedAt: a.publishedAt,
                  label: labelFor([e], e.ticker),
                })),
            ),
            bars,
            now,
          })
        : null,
    [mine.data, others.data, bars, now, ticker],
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const all = mine.data?.rows ?? [];
    if (filter === 'all') return all;
    const want = filter === 'bullish' ? 'positive' : 'negative';
    return all.filter((a) => labelFor(a.sentiment, ticker) === want);
  }, [mine.data, filter, ticker]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${dayMonth(etDate(d))} ${dualClock(d, DEFAULT_LOCAL_ZONE).label}`;
  };

  if (mine.isPending) return <p className="text-sm text-ink3">{R.loading}</p>;
  if (mine.isError)
    return (
      <p role="alert" className="text-sm text-crit">
        {t.study.panelError(x.title, mine.error.message)}
      </p>
    );

  const shareLine = (sh: NonNullable<typeof s>['sentiment']) =>
    sh.positivePct === null
      ? x.counts(sh.positive, sh.neutral, sh.negative, sh.labelled, MIN_LABELLED)
      : x.share(pctText(sh.positivePct, 0), sh.labelled);
  const buzz = s?.buzz;
  const scale = buzz ? Math.max(buzz.thisWeek, buzz.averagePerWeek ?? 0, 1) * 1.25 : 1;

  return (
    <>
      <p className="text-xs text-warn">{x.vendorNote}</p>
      {s && (
        <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
          <Tile id="rs-buzz" title={x.buzz}>
            <BarRow
              label={x.thisWeek(dayMonth(s.weekStart))}
              value={<Num>{s.buzz.thisWeek}</Num>}
              width={(s.buzz.thisWeek / scale) * 100}
              barClass="bg-link"
              {...(s.buzz.averagePerWeek === null
                ? {}
                : { limit: (s.buzz.averagePerWeek / scale) * 100 })}
              note={
                <Num>
                  {s.buzz.averagePerWeek === null
                    ? x.noAverage
                    : x.average(toFixedHalfUp(s.buzz.averagePerWeek, 1), s.buzz.storedWeeks)}
                </Num>
              }
            />
          </Tile>
          <Tile id="rs-sentiment" title={x.sentiment}>
            <p className="text-sm text-ink">
              <Num>{shareLine(s.sentiment)}</Num>
            </p>
            <p className="text-xs text-ink3">
              <Num>
                {x.othersLine(
                  s.others.tickers,
                  s.others.positivePct === null
                    ? x.counts(
                        s.others.positive,
                        s.others.neutral,
                        s.others.negative,
                        s.others.labelled,
                        MIN_LABELLED,
                      )
                    : x.share(pctText(s.others.positivePct, 0), s.others.labelled),
                )}
              </Num>
            </p>
            {others.isError && <p className="text-xs text-warn">{x.othersFailed}</p>}
          </Tile>
        </div>
      )}
      {s && (
        <Tile id="rs-coverage" title={x.coverage}>
          <BarChart
            label={x.coverageAria(s.coverage.length)}
            stacked
            groups={s.coverage.map((w) => ({
              label: dayMonth(w.start),
              values: [w.positive, w.neutral, w.negative, w.unlabelled],
            }))}
            series={[
              { name: x.labels.positive, className: 'text-up' },
              { name: x.labels.neutral, className: 'text-ink3' },
              { name: x.labels.negative, className: 'text-down' },
              { name: x.labels.none, className: 'text-line-strong' },
            ]}
            line={{ name: x.closeLine, values: s.coverage.map((w) => w.close), className: 'text-ink' }}
            format={(v) => `$${toFixedHalfUp(v, 2)}`}
          />
        </Tile>
      )}
      <Tile id="rs-news" title={x.title}>
        <Segmented
          label={x.filter}
          options={FILTERS.map((f) => ({ key: f, label: x.filters[f] }))}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(0);
          }}
        />
        {shown.length === 0 ? (
          <p className="text-sm text-ink3">{x.none}</p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((a) => {
              const cls = classifyPublisher(a.publisher);
              const label = labelFor(a.sentiment, ticker);
              return (
                <li key={a.id} className="flex flex-col gap-1 border-t border-line py-2.5">
                  {/^https:\/\//.test(a.url) ? (
                    <a
                      className="inline-flex min-h-11 items-center text-sm leading-snug text-ink underline-offset-4 hover:underline"
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="text-sm leading-snug text-ink">{a.title}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink3">
                    <Pill tone={label ? TONE[label] : 'neutral'}>
                      {label ? x.labels[label] : x.labels.none}
                    </Pill>
                    <span title={TIER_LABELS[cls.tier]}>
                      <Pill tone={cls.tier <= 2 ? 'neutral' : 'warn'}>{t.study.news.tier(cls.tier)}</Pill>
                    </span>
                    <span>{cls.opinion ? t.study.news.opinion : t.study.news.reporting}</span>
                    <span>{a.publisher}</span>
                    <Num>{when(a.publishedAt)}</Num>
                  </span>
                  {a.tickers.filter((k) => k !== ticker).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {a.tickers
                        .filter((k) => k !== ticker)
                        .slice(0, 8)
                        .map((k) => (
                          <Pill key={k}>
                            <Num>{k}</Num>
                          </Pill>
                        ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {x.prev}
            </button>
            <span className="text-sm text-ink2" aria-live="polite">
              <Num>{x.page(page + 1, pages)}</Num>
            </span>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
              className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {x.next}
            </button>
          </div>
        )}
        <SourceLine>
          {x.source(mine.data.rows.length, NEWS_SENTIMENT_VERSION, mine.data.capped)}
        </SourceLine>
      </Tile>
    </>
  );
}
