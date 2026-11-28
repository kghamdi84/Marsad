import { useId, type ReactNode } from 'react';
import { AnalystLine } from '../study/research/AnalystLine';
import {
  daysBetween,
  describeEightK,
  exitSignals,
  formLabel,
  portfolioTotals,
  toFixedHalfUp,
  unrealized,
  type CompanyBrief,
  type PeriodReturn,
} from '@marsad/core';
import { ChangeBadge, Num, StopBar } from '../ui/kit';
import { checkText } from '../study/CompanyBrief';
import { formatUsd } from '../../lib/study';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import type { Figures } from '../../lib/summary';
import { dayMonth, dayMonthYear, weekdayDayMonth } from '../../lib/dates';
import { busy, type Q } from './useQuickBrief';
import { t } from '../../strings';

const x = t.quickLook;
const b = t.study.brief;
const money = (v: number) => toFixedHalfUp(v, 2);
const arrowPct = (fraction: number, digits = 1) =>
  `${fraction > 0 ? '▲ +' : fraction < 0 ? '▼ −' : ''}${toFixedHalfUp(Math.abs(fraction) * 100, digits)}%`;
const arrowUsd = (v: number) => `${v >= 0 ? '▲ +' : '▼ −'}${formatUsd(Math.abs(v))}`;
const tone = (v: number | null | undefined) =>
  v == null ? 'text-ink3' : v >= 0 ? 'text-up' : 'text-down';

const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-ink3">{children}</span>
);
const NA = () => <Muted>{b.na}</Muted>;
const Loading = () => <Muted>{b.loading}</Muted>;

/** A titled part of the quick look: a rule above, no card. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1 border-t border-line pt-3">
      <h3 id={id} className="text-xs font-semibold tracking-[0.02em] text-ink2 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One short row: the label on the start side, the value on the end side. */
function Row({
  k,
  children,
  className = '',
}: {
  k: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="flex-none text-xs text-ink3">{k}</dt>
      <dd className={`min-w-0 text-end text-ink tabular-nums ${className}`}>{children}</dd>
    </div>
  );
}

const THESIS_TONE: Record<string, string> = {
  intact: 'text-up',
  weakening: 'text-warn',
  broken: 'text-down',
};

/**
 * The owner's open lots of this ticker: size, cost, value and gain at the last stored close, weight among the open
 * holdings, the stop bar, thesis, any exit rule that holds at that close (exitSignals) and the horizon. Nothing
 * shows for a ticker that is not held, or for a member (holdings are the owner's own rows under row-level security).
 */
export function PositionSection({
  ticker,
  holdings,
  bars,
}: {
  ticker: string;
  holdings: readonly StoredHolding[];
  bars: BarsByTicker;
}) {
  const lots = holdings.filter((h) => h.ticker === ticker);
  if (lots.length === 0) return null;
  const p = x.position;
  const j = t.journal;
  const lastClose = (tk: string) => bars[tk]?.at(-1)?.close ?? null;
  const tot = portfolioTotals(holdings, lastClose);
  return (
    <Section title={p.title}>
      {lots.map((h) => {
        const own = bars[h.ticker] ?? [];
        const lastBar = own.at(-1);
        const last = lastBar?.close ?? null;
        const u = last !== null ? unrealized(h, last) : null;
        const value = last !== null ? last * h.shares : null;
        const weight = value !== null && tot.value > 0 ? value / tot.value : null;
        const exits = exitSignals(h, own);
        const top = h.targets.length ? Math.max(...h.targets) : null;
        const targets = h.targets.length ? h.targets.map(money).join(', ') : j.holdings.none2;
        const hasRules =
          h.stop !== null || h.targets.length > 0 || h.trendBreak !== null || !!h.timeStopSessions;
        return (
          <div key={h.id} className="flex flex-col">
            {lots.length > 1 && (
              <p className="pt-1 text-xs font-medium text-ink2">
                <Num>{p.lot(dayMonthYear(h.openedOn))}</Num>
              </p>
            )}
            <dl className="flex flex-col">
              <Row k={p.shares}>{p.sharesLine(h.shares, money(h.costBasis))}</Row>
              {u && value !== null && lastBar ? (
                <>
                  <Row k={p.value}>{p.valueLine(formatUsd(value), dayMonth(lastBar.date))}</Row>
                  <Row k={p.gain} className={`font-semibold ${tone(u.usd)}`}>
                    {`${arrowUsd(u.usd)} · ${arrowPct(u.pct)}`}
                  </Row>
                  <Row k={p.weight}>
                    {weight === null
                      ? b.na
                      : tot.unpriced.length > 0
                        ? p.weightPartial(`${toFixedHalfUp(weight * 100, 1)}%`, tot.unpriced.length)
                        : p.weightLine(`${toFixedHalfUp(weight * 100, 1)}%`)}
                  </Row>
                </>
              ) : (
                <p className="py-1 text-sm text-ink3">{p.noPrice}</p>
              )}
            </dl>
            {last !== null && h.stop !== null && (
              <div
                role="img"
                aria-label={j.ui.barAria(money(h.stop), money(last), targets)}
                className="py-1.5"
              >
                <StopBar
                  stop={h.stop}
                  now={last}
                  target={top ?? Math.max(last, h.costBasis, h.stop)}
                  labels={{
                    stop: (
                      <span className="text-down">
                        {j.ui.barStop} {money(h.stop)}
                      </span>
                    ),
                    now: `${j.ui.barNow} ${money(last)}`,
                    target: (
                      <span className="text-up">
                        {j.ui.barTarget} {targets}
                      </span>
                    ),
                  }}
                />
              </div>
            )}
            <dl className="flex flex-col">
              <Row k={p.thesis} className={`font-medium ${THESIS_TONE[h.thesisStatus] ?? ''}`}>
                {j.holdings.thesisStatus[h.thesisStatus] ?? h.thesisStatus}
              </Row>
              <Row k={p.exits}>
                {!hasRules ? (
                  <span className="text-down">{j.holdings.noRules}</span>
                ) : exits.length > 0 ? (
                  <span className="flex flex-col gap-0.5 font-medium text-warn">
                    {exits.map((e) => (
                      <span key={e.kind}>
                        {j.holdings.triggered}: {e.detail}
                      </span>
                    ))}
                  </span>
                ) : lastBar ? (
                  <Muted>{p.exitsNone(dayMonth(lastBar.date))}</Muted>
                ) : (
                  <NA />
                )}
              </Row>
              {h.horizon && (
                <Row k={p.horizon}>
                  {h.horizon === 'long' ? j.holdings.horizonLong : j.holdings.horizonSwing}
                </Row>
              )}
            </dl>
          </div>
        );
      })}
    </Section>
  );
}

/** A return cell: a badge with sign and arrow, or "n/a" read out as "Not available". */
function Ret({ v }: { v: number | null | undefined }) {
  if (v == null)
    return (
      <span className="text-xs text-ink3">
        <span aria-hidden="true">{x.perf.naShort}</span>
        <span className="sr-only">{b.na}</span>
      </span>
    );
  return <ChangeBadge pct={v * 100} digits={1} />;
}

function Returns({
  ticker,
  returns,
  sector,
}: {
  ticker: string;
  returns: { m1: PeriodReturn | null; m3: PeriodReturn | null; y1: PeriodReturn | null };
  sector: string | null;
}) {
  const keys = ['m1', 'm3', 'y1'] as const;
  const to = returns.m1?.to ?? returns.m3?.to ?? returns.y1?.to;
  if (!to)
    return (
      <dl>
        <Row k={b.returns}>
          <NA />
        </Row>
      </dl>
    );
  const rows: { name: string; pick: (r: PeriodReturn) => number | null }[] = [
    { name: ticker, pick: (r) => r.stock },
    { name: 'SPY', pick: (r) => r.spy },
    ...(sector ? [{ name: sector, pick: (r: PeriodReturn) => r.sector }] : []),
  ];
  return (
    <div className="flex flex-col gap-0.5">
      <table className="w-full text-sm">
        <caption className="sr-only">{b.returnsCaption(dayMonthYear(to))}</caption>
        <thead>
          <tr>
            <th scope="col" className="py-0.5 text-start text-xs font-normal text-ink3">
              {b.colTicker}
            </th>
            {keys.map((k) => (
              <th key={k} scope="col" className="py-0.5 text-end text-xs font-normal text-ink3">
                {b.periods[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <th scope="row" className="py-1 text-start font-medium text-ink">
                {r.name}
              </th>
              {keys.map((k) => {
                const p = returns[k];
                return (
                  <td key={k} className="py-1 text-end">
                    <Ret v={p ? r.pick(p) : null} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink3">
        <Num>{b.returnsCaption(dayMonthYear(to))}</Num>
        {!sector && <> · {b.noSector}</>}
      </p>
    </div>
  );
}

/**
 * How the stock has done: 1M, 3M and 1Y returns beside SPY and the sector fund (company-brief-1), where the close
 * sits in its 52-week range, ATR %, the strength rank and volume against its 20-day average (trader-1, strength-1,
 * indicators-1), and revenue over four quarters with its year-on-year change and the net margin (snapshot-1).
 */
/** Where the summary figures came from: the nightly row (its session and when it was written) or the bars. */
export function FiguresSource({ fig }: { fig: Figures }) {
  return (
    <p className="text-xs text-ink3">
      {fig.from.kind === 'summary'
        ? x.perf.fromSummary(
            dayMonth(fig.from.date),
            new Date(fig.from.computedAt).toISOString().slice(11, 16),
          )
        : x.perf.fromBars}
    </p>
  );
}

export function PerformanceSection({
  ticker,
  brief,
  fig,
  q,
}: {
  ticker: string;
  brief: CompanyBrief;
  /** The nightly summary row when current, else the same row from the bars (ADR 0050). */
  fig: Figures;
  q: { spy: Q; sector: Q; strength: Q; facts: Q };
}) {
  const p = brief.performance;
  const r = fig.row;
  const tr = t.trader;
  // The 52-week range is on closing prices, as the summary and Watch compute it.
  const fromHigh =
    r.close !== null && r.high_52w !== null && r.high_52w > 0 ? r.close / r.high_52w - 1 : null;
  return (
    <Section title={x.perf.title}>
      {busy(q.spy, q.sector) ? (
        <Loading />
      ) : (
        <Returns ticker={ticker} returns={p.returns} sector={p.sectorTicker} />
      )}
      <dl className="flex flex-col">
        <Row k={x.perf.range52Close}>
          {fromHigh === null || r.low_52w === null || r.high_52w === null ? (
            <Muted>{r.unavailable['high_52w'] ? x.perf.rangeShortClose : b.na}</Muted>
          ) : (
            <span className={fromHigh < 0 ? 'text-down' : ''}>
              {x.perf.rangeLine(arrowPct(fromHigh), money(r.low_52w), money(r.high_52w))}
            </span>
          )}
        </Row>
        <Row k={tr.atrPct}>
          {r.atr_14_pct === null ? <NA /> : `${toFixedHalfUp(r.atr_14_pct * 100, 1)}%`}
        </Row>
        <Row k={tr.rankFact}>
          {busy(q.strength) ? (
            <Loading />
          ) : p.strength ? (
            `${tr.rankValue(Math.round(p.strength.percentile))} · ${tr.rankSub(p.strength.rank, p.strength.members, dayMonth(p.strength.date))}`
          ) : q.strength.isSuccess ? (
            <Muted>{tr.notRanked}</Muted>
          ) : (
            <NA />
          )}
        </Row>
        <Row k={x.volume}>
          {r.volume_ratio_20 === null ? <NA /> : x.times(toFixedHalfUp(r.volume_ratio_20, 1))}
        </Row>
        <Row k={x.perf.revenue}>
          {busy(q.facts) ? (
            <Loading />
          ) : p.revenue ? (
            x.perf.revenueLine(
              formatUsd(p.revenue.value),
              p.revenue.yoyPct === null ? null : arrowPct(p.revenue.yoyPct / 100),
              dayMonthYear(p.revenue.end),
            )
          ) : (
            <NA />
          )}
        </Row>
        <Row k={x.perf.netMargin}>
          {busy(q.facts) ? (
            <Loading />
          ) : p.netMargin ? (
            x.perf.netMarginLine(
              `${p.netMargin.pct < 0 ? '−' : ''}${toFixedHalfUp(Math.abs(p.netMargin.pct), 1)}%`,
              dayMonthYear(p.netMargin.end),
            )
          ) : (
            <NA />
          )}
        </Row>
      </dl>
      <FiguresSource fig={fig} />
    </Section>
  );
}

function TopChecks({ title, items }: { title: string; items: CompanyBrief['checks'] }) {
  const shown = items.slice(0, 3);
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-ink2">{title}</h4>
      {shown.length === 0 ? (
        <p className="text-[13px] text-ink3">{b.noChecks}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px] leading-snug text-ink">
          {shown.map((c) => (
            <li key={c.id} data-check={c.id}>
              <Num>{checkText(c)}</Num>
            </li>
          ))}
        </ul>
      )}
      {items.length > shown.length && (
        <p className="text-xs text-ink3">{x.brief.more(items.length - shown.length)}</p>
      )}
    </div>
  );
}

/**
 * The short company brief: what the company does (the 10-K business section's first sentence), the first three
 * strengths and risks of company-brief-1, the stored news sentiment, the latest report in plain words and the
 * estimated next earnings date. Each line says Loading or Not available on its own.
 */
export function BriefSection({
  brief,
  cik,
  fig,
  today,
  q,
}: {
  brief: CompanyBrief;
  cik: string | undefined;
  /** The summary's next results date is preferred: Tauric's stated date, else Marsad's estimate (ADR 0050). */
  fig: Figures | null;
  today: string;
  q: {
    business: Q;
    facts: Q;
    spy: Q;
    strength: Q;
    short: Q;
    insiders: Q;
    events: Q;
    results: Q;
    news: Q;
    reports: Q;
  };
}) {
  const what = brief.company.whatItDoes;
  const strengths = brief.checks.filter((c) => c.side === 'strength');
  const risks = brief.checks.filter((c) => c.side === 'risk');
  const news = brief.sentiment.news;
  const latest = brief.next.latestReport;
  const eightK = latest && latest.form.startsWith('8-K') ? describeEightK(latest.items) : null;
  const n = brief.next.earnings;
  const stated =
    fig?.from.kind === 'summary' && fig.row.next_earnings_date && fig.row.next_earnings_source
      ? { date: fig.row.next_earnings_date, source: fig.row.next_earnings_source }
      : null;
  return (
    <Section title={x.brief.title}>
      <div className="flex flex-col gap-0.5 py-1 text-sm">
        <span className="text-xs text-ink3">{x.brief.whatItDoes}</span>
        {busy(q.business) ? (
          <Loading />
        ) : what ? (
          <>
            <span className="text-ink">{what.sentence}</span>
            <span className="text-xs text-ink3">
              <Num>{x.brief.whatSource(dayMonthYear(what.filingDate))}</Num>
            </span>
          </>
        ) : (
          <Muted>{q.business.isSuccess ? b.noBusiness : b.na}</Muted>
        )}
      </div>
      <p className="pt-1 text-xs font-medium text-ink3">{b.checksLabel}</p>
      {busy(q.facts, q.spy, q.strength, q.short, q.insiders, q.events, q.results) ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-2 pb-1">
          <TopChecks title={b.strengths(strengths.length)} items={strengths} />
          <TopChecks title={b.risks(risks.length)} items={risks} />
        </div>
      )}
      <dl className="flex flex-col">
        <Row k={x.brief.sentiment}>
          {busy(q.news) ? (
            <Loading />
          ) : !news ? (
            <NA />
          ) : news.stories === 0 ? (
            <Muted>{b.newsNone}</Muted>
          ) : !news.stored ? (
            <Muted>{b.newsNotStored(news.stories)}</Muted>
          ) : (
            <span className="flex flex-col gap-0.5">
              <span>{b.newsCounts(news.positive, news.neutral, news.negative, news.stories)}</span>
              <span className="text-xs text-ink3">{x.brief.sentimentNote}</span>
            </span>
          )}
        </Row>
        <Row k={b.analysts}>
          <AnalystLine ticker={brief.ticker} close={brief.performance.close} />
        </Row>
        <Row k={x.brief.latest}>
          {busy(q.reports) ? (
            <Loading />
          ) : latest ? (
            x.brief.latestLine(
              eightK
                ? [
                    ...eightK.items.map((i) => i.plain),
                    ...eightK.unknown.map((u) => b.item(u)),
                  ].join('; ')
                : formLabel(latest.form),
              dayMonthYear(latest.filingDate),
            )
          ) : q.reports.isSuccess ? (
            <Muted>{b.noReport}</Muted>
          ) : (
            <NA />
          )}
        </Row>
        <Row k={x.brief.earnings}>
          {stated ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {x.brief.earningsStated(
                  `${weekdayDayMonth(stated.date)} ${stated.date.slice(0, 4)}`,
                  b.earningsAway(b.days(daysBetween(today, stated.date))),
                )}
              </span>
              <span className="text-xs text-ink3">{x.brief.earningsSource[stated.source]}</span>
            </span>
          ) : busy(q.results) ? (
            <Loading />
          ) : n ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {x.brief.earningsLine(
                  `${weekdayDayMonth(n.date)} ${n.date.slice(0, 4)}`,
                  n.daysAway >= 0
                    ? b.earningsAway(b.days(n.daysAway))
                    : b.earningsAgo(b.days(-n.daysAway)),
                )}
              </span>
              {n.overdue && <span className="text-xs text-warn">{x.overdue}</span>}
            </span>
          ) : q.results.isError ? (
            <NA />
          ) : (
            <Muted>{cik === undefined || q.results.isSuccess ? x.noEstimate : b.na}</Muted>
          )}
        </Row>
      </dl>
      <p className="text-xs text-ink3">
        <Num>{x.brief.formula(brief.formulaVersion)}</Num>
      </p>
    </Section>
  );
}
