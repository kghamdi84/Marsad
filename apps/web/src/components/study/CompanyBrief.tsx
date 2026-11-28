import { useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  BRIEF_RULES,
  companyBrief,
  describeEightK,
  etDate,
  formLabel,
  toFixedHalfUp,
  type AlertEvent,
  type BriefCheck,
  type DividendEvent,
  type EarningsEstimate,
  type HaltEvent,
  type PeriodReturn,
} from '@marsad/core';
import { Info } from '../Info';
import { ChangeBadge, Num } from '../ui/kit';
import { cardClass } from '../Card';
import { formatUsd, secUrl, type StudyData } from '../../lib/study';
import {
  loadBusinessSection,
  loadFacts,
  loadLatestRegime,
  loadLatestReports,
  loadNewsSentiment,
  loadRecentDailyBars,
  loadRiskFlag,
  loadSectorFund,
  loadShortData,
  loadStrengthRank,
  type InsiderData,
} from '../../lib/studyPanels';
import { dayMonthYear, weekdayDayMonth } from '../../lib/dates';
import { AnalystLine } from './research/AnalystLine';
import { t } from '../../strings';

const b = t.study.brief;
const DAY = 86_400_000;

/** Where a brief section's detail lives: a tab of the company area, or the Regime page. */
export type BriefTarget = 'overview' | 'financials' | 'news' | 'filings';

type Q<T> = Pick<UseQueryResult<T>, 'data' | 'isSuccess' | 'isError' | 'isLoading'>;

const pct = (v: number, d = 1) => `${toFixedHalfUp(Math.abs(v), d)}%`;
const signedText = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${toFixedHalfUp(Math.abs(v), d)}%`;
const price = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line: the label on the start side, the answer and its context after it. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm">
      <dt className="text-xs text-ink3">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <span className="text-ink3">{children}</span>
);
const NA = () => <Muted>{b.na}</Muted>;
const Loading = () => <Muted>{b.loading}</Muted>;

/** A titled block of the brief, with a one-tap way to its detail. */
function Block({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
        <h3 id={id} className="text-[13px] font-semibold tracking-[0.02em] text-ink2 uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center text-[13px] font-medium text-link underline-offset-4 hover:underline"
    >
      {label}
    </button>
  );
}

/** A return cell: blue up or orange down with sign and arrow, or "Not available". */
function Ret({ v }: { v: number | null | undefined }) {
  return v == null ? <NA /> : <ChangeBadge pct={v * 100} digits={1} />;
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
  const rows: { name: string; pick: (r: PeriodReturn) => number | null }[] = [
    { name: ticker, pick: (r) => r.stock },
    { name: 'SPY', pick: (r) => r.spy },
    ...(sector ? [{ name: sector, pick: (r: PeriodReturn) => r.sector }] : []),
  ];
  if (!to)
    return (
      <dl>
        <Line label={b.returns}>
          <NA />
        </Line>
      </dl>
    );
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <table className="w-full text-sm">
        <caption className="sr-only">{b.returnsCaption(dayMonthYear(to))}</caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 text-start text-xs font-normal text-ink3">
              {b.colTicker}
            </th>
            {keys.map((k) => (
              <th key={k} scope="col" className="py-1 text-end text-xs font-normal text-ink3">
                {b.periods[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <th scope="row" className="py-1.5 text-start font-medium text-ink">
                {r.name}
              </th>
              {keys.map((k) => {
                const p = returns[k];
                return (
                  <td key={k} className="py-1.5 text-end">
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
        {!sector && (
          <>
            {' '}
            {'·'} {b.noSector}
          </>
        )}
      </p>
    </div>
  );
}

/** A check in words: its rule, threshold and value with its date. The quick look lists the same lines. */
export function checkText(c: BriefCheck): string {
  const d = dayMonthYear(c.date);
  const th = c.threshold === null ? '' : pct(c.threshold, 0);
  const f = b.checks[c.id];
  if (!f) return c.id;
  switch (c.id) {
    case 'net-cash':
    case 'net-debt':
    case 'fcf-positive':
    case 'fcf-negative':
      return f(formatUsd(Math.abs(c.value)), th, d, '');
    case 'above-200':
    case 'below-200':
      return f(price(c.value), th, d, price(c.extra ?? 0));
    case 'strength-top':
    case 'strength-bottom':
      return f(toFixedHalfUp(c.value, 0), toFixedHalfUp(c.threshold ?? 0, 0), d, String(c.extra));
    case 'insider-buying':
      return f(formatUsd(c.value), th, d, b.trades(c.extra ?? 0));
    case 'insider-selling':
      return f(formatUsd(c.value), th, d, b.sales(c.extra ?? 0));
    case 'earnings-soon':
      return f(b.days(c.value), b.days(c.threshold ?? 0), d, '');
    case 'recent-halt':
      return f(b.times(c.value), th, d, '');
    case 'beats-spy':
    case 'lags-spy':
    case 'far-from-high':
      return f(pct(c.value), pct(c.threshold ?? 0, 0), d, '');
    default:
      return f(pct(c.value), th, d, '');
  }
}

function CheckList({ title, items }: { title: string; items: readonly BriefCheck[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-ink2">{title}</h4>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink3">{b.noChecks}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[13px] leading-snug text-ink">
          {items.map((c) => (
            <li key={c.id} data-check={c.id}>
              <Num>{checkText(c)}</Num>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The company brief (company-brief-1): what the company does, how it has done, rule-based strengths and risks,
 * stored sentiment, market context and what comes next, computed by code from data Marsad stores. Each block
 * links to its detail; a missing input says "Not available", never a guess.
 */
export function CompanyBrief({
  data,
  earnings,
  results,
  insiders,
  events,
  dividends,
  onOpen,
}: {
  data: StudyData;
  /** Undefined while the results filings load. */
  earnings: EarningsEstimate | null | undefined;
  results: Q<unknown>;
  insiders: Q<InsiderData>;
  events: Q<{ halts: HaltEvent[]; alerts: AlertEvent[] }>;
  dividends: Q<DividendEvent[]>;
  onOpen: (k: BriefTarget) => void;
}) {
  const ticker = data.ticker;
  const cik = data.company?.cik;
  const asOf = etDate(new Date());
  // The news window starts 31 days back so the 30 ET days are covered whatever the time zone.
  const since = useMemo(
    () => new Date(Date.parse(`${asOf}T00:00:00Z`) - 31 * DAY).toISOString(),
    [asOf],
  );
  const facts = useQuery({
    queryKey: ['facts', cik],
    queryFn: () => loadFacts(cik as string),
    enabled: cik !== undefined,
  });
  const business = useQuery({
    queryKey: ['business', cik],
    queryFn: () => loadBusinessSection(cik as string),
    enabled: cik !== undefined,
  });
  const short = useQuery({ queryKey: ['short', ticker], queryFn: () => loadShortData(ticker) });
  const news = useQuery({
    queryKey: ['news-sentiment', ticker, since],
    queryFn: () => loadNewsSentiment(ticker, since),
  });
  const regime = useQuery({ queryKey: ['brief-regime'], queryFn: loadLatestRegime });
  const sector = useQuery({
    queryKey: ['brief-sector', ticker],
    queryFn: () => loadSectorFund(ticker),
  });
  const spy = useQuery({
    queryKey: ['brief-bars', 'SPY'],
    queryFn: () => loadRecentDailyBars('SPY'),
    enabled: ticker !== 'SPY',
  });
  const strength = useQuery({
    queryKey: ['brief-strength', ticker],
    queryFn: () => loadStrengthRank(ticker),
  });
  const risk = useQuery({
    queryKey: ['risk-flag', cik],
    queryFn: () => loadRiskFlag(cik as string),
    enabled: cik !== undefined,
  });
  const reports = useQuery({
    queryKey: ['latest-reports', cik],
    queryFn: () => loadLatestReports(cik as string),
    enabled: cik !== undefined,
  });

  const ok = <T,>(q: Q<T>): T | null => (q.isSuccess ? (q.data ?? null) : null);
  const spyBars = ticker === 'SPY' ? data.bars : ok(spy);
  const brief = useMemo(
    () =>
      companyBrief({
        ticker,
        asOf,
        name: data.company?.name ?? null,
        business: ok(business),
        bars: data.bars,
        spy: spyBars,
        sector: sector.data ? { ticker: sector.data.etf, bars: sector.data.bars } : null,
        facts: ok(facts),
        strength: ok(strength),
        filings: ok(reports),
        news: news.data?.rows ?? null,
        newsCapped: news.data?.capped ?? false,
        insiders: insiders.data?.rows ?? null,
        shortInterest: short.data?.interest ?? null,
        dividends: ok(dividends),
        earnings: earnings ?? null,
        regime: ok(regime),
        riskFactors: ok(risk),
        halts: events.data?.halts ?? null,
        alerts: events.data?.alerts ?? null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ticker,
      asOf,
      data,
      business.data,
      spyBars,
      sector.data,
      facts.data,
      strength.data,
      reports.data,
      news.data,
      insiders.data,
      short.data,
      dividends.data,
      earnings,
      regime.data,
      risk.data,
      events.data,
    ],
  );

  const inputs: [string, Q<unknown>][] = [
    ['facts', facts],
    ['business', business],
    ['short', short],
    ['news', news],
    ['regime', regime],
    ['sector', sector],
    ['spy', spy],
    ['strength', strength],
    ['risk', risk],
    ['reports', reports],
    ['insiders', insiders],
    ['events', events],
    ['dividends', dividends],
    ['earnings', results],
  ];
  const failed = inputs.filter(([, q]) => q.isError).map(([k]) => b.inputs[k] ?? k);
  const busy = (...qs: Q<unknown>[]) => qs.some((q) => q.isLoading);

  const p = brief.performance;
  const s = brief.sentiment;
  const c = brief.context;
  const n = brief.next;
  const strengths = brief.checks.filter((x) => x.side === 'strength');
  const risks = brief.checks.filter((x) => x.side === 'risk');
  const latest = n.latestReport;
  const latestUrl = latest && cik ? secUrl(cik, latest) : null;
  const eightK = latest && latest.form.startsWith('8-K') ? describeEightK(latest.items) : null;

  return (
    <section aria-labelledby="brief-h" className={`${cardClass} gap-2`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="brief-h" className="text-base font-semibold text-ink">
          {b.title}
        </h2>
        <span className="text-xs text-ink3">{b.aside}</span>
      </div>
      {failed.length > 0 && (
        <p role="status" className="text-xs text-warn">
          {b.failed(failed.join(', '))}
        </p>
      )}
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 tablet:grid-cols-2">
        <Block
          id="brief-company"
          title={b.sections.company}
          action={
            <OpenButton
              label={b.open(t.study.ui.sectionNames['overview'] ?? '')}
              onClick={() => onOpen('overview')}
            />
          }
        >
          <dl className="flex flex-col">
            <Line label={b.whatItDoes}>
              {busy(business) ? (
                <Loading />
              ) : brief.company.whatItDoes ? (
                <span className="flex flex-col gap-0.5">
                  <span>{brief.company.whatItDoes.sentence}</span>
                  <span className="text-xs text-ink3">
                    <Num>
                      {b.whatSource(
                        dayMonthYear(brief.company.whatItDoes.filingDate),
                        dayMonthYear(brief.company.whatItDoes.periodEnd),
                      )}
                    </Num>
                  </span>
                </span>
              ) : (
                <Muted>{b.noBusiness}</Muted>
              )}
            </Line>
            <Line label={b.marketValue}>
              {busy(facts) ? (
                <Loading />
              ) : brief.company.marketValue && facts.data ? (
                <span className="flex flex-col gap-0.5">
                  <Num className="font-semibold">{formatUsd(brief.company.marketValue.value)}</Num>
                  <span className="text-xs text-ink3">
                    <Num>
                      {b.mvLine(
                        `${toFixedHalfUp(brief.company.marketValue.shares / 1e9, 2)}B`,
                        price(brief.company.marketValue.close),
                        dayMonthYear(brief.company.marketValue.priceDate),
                        dayMonthYear(brief.company.marketValue.sharesDate),
                      )}
                    </Num>
                  </span>
                </span>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.analysts}>
              <AnalystLine ticker={ticker} close={p.close} />
            </Line>
          </dl>
        </Block>

        <Block
          id="brief-performance"
          title={b.sections.performance}
          action={
            <OpenButton
              label={b.open(t.study.ui.sectionNames['financials'] ?? '')}
              onClick={() => onOpen('financials')}
            />
          }
        >
          {busy(spy, sector) ? (
            <Loading />
          ) : (
            <Returns ticker={ticker} returns={p.returns} sector={p.sectorTicker} />
          )}
          <dl className="flex flex-col">
            <Line label={b.revenue}>
              {busy(facts) ? (
                <Loading />
              ) : p.revenue ? (
                <Num>
                  {b.revenueLine(
                    formatUsd(p.revenue.value),
                    p.revenue.yoyPct === null ? null : signedText(p.revenue.yoyPct),
                    dayMonthYear(p.revenue.end),
                  )}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.netMargin}>
              {busy(facts) ? (
                <Loading />
              ) : p.netMargin ? (
                <Num>
                  {b.netMarginLine(
                    `${p.netMargin.pct < 0 ? '−' : ''}${pct(p.netMargin.pct)}`,
                    dayMonthYear(p.netMargin.end),
                  )}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.fcf}>
              {busy(facts) ? (
                <Loading />
              ) : p.freeCashFlow ? (
                <Num>
                  {b.fcfLine(formatUsd(p.freeCashFlow.value), dayMonthYear(p.freeCashFlow.filed))}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.dilution}>
              {busy(facts) ? (
                <Loading />
              ) : p.dilution ? (
                <Num>
                  {b.dilutionLine(signedText(p.dilution.pct), dayMonthYear(p.dilution.end))}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.strength}>
              {busy(strength) ? (
                <Loading />
              ) : p.strength ? (
                <Num>
                  {b.strengthLine(
                    toFixedHalfUp(p.strength.percentile, 0),
                    p.strength.rank,
                    p.strength.members,
                    dayMonthYear(p.strength.date),
                  )}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
          </dl>
        </Block>

        <Block id="brief-checks" title={b.sections.checks}>
          <p className="text-xs font-medium text-ink3">{b.checksLabel}</p>
          {busy(facts, spy, strength, short, insiders, events, results) ? (
            <Loading />
          ) : (
            <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
              <CheckList title={b.strengths(strengths.length)} items={strengths} />
              <CheckList title={b.risks(risks.length)} items={risks} />
            </div>
          )}
        </Block>

        <Block
          id="brief-sentiment"
          title={b.sections.sentiment}
          action={
            <OpenButton
              label={b.open(t.study.ui.sectionNames['news'] ?? '')}
              onClick={() => onOpen('news')}
            />
          }
        >
          <dl className="flex flex-col">
            <Line label={b.news}>
              {busy(news) ? (
                <Loading />
              ) : !s.news ? (
                <NA />
              ) : s.news.stories === 0 ? (
                <Muted>{b.newsNone}</Muted>
              ) : !s.news.stored ? (
                <Muted>{b.newsNotStored(s.news.stories)}</Muted>
              ) : (
                <span className="flex flex-col gap-0.5">
                  <Num>
                    {b.newsCounts(s.news.positive, s.news.neutral, s.news.negative, s.news.stories)}
                  </Num>
                  <span className="text-xs text-ink3">
                    <Num>
                      {s.news.pct
                        ? b.newsPct(
                            pct(s.news.pct.positive, 0),
                            pct(s.news.pct.neutral, 0),
                            pct(s.news.pct.negative, 0),
                          )
                        : b.newsFew(s.news.positive + s.news.neutral + s.news.negative)}
                    </Num>{' '}
                    {b.newsNote}
                    {s.news.capped && <> {b.newsCapped}</>}
                  </span>
                </span>
              )}
            </Line>
            <Line label={b.insiders}>
              {busy(insiders) ? (
                <Loading />
              ) : !s.insiders ? (
                <NA />
              ) : s.insiders.buys + s.insiders.sells === 0 ? (
                <Muted>{b.insidersNone}</Muted>
              ) : (
                <span className="flex flex-col gap-0.5">
                  <Num>
                    {b.insidersLine(
                      `${s.insiders.netUsd >= 0 ? '+' : ''}${formatUsd(s.insiders.netUsd)}`,
                      s.insiders.buys,
                      formatUsd(s.insiders.buyUsd),
                      s.insiders.sells,
                      formatUsd(s.insiders.sellUsd),
                    )}
                  </Num>
                  {s.insiders.unpriced > 0 && (
                    <span className="text-xs text-ink3">{b.unpriced(s.insiders.unpriced)}</span>
                  )}
                </span>
              )}
            </Line>
            <Line label={b.shortLabel}>
              {busy(short) ? (
                <Loading />
              ) : !s.short ? (
                short.isSuccess ? (
                  <Muted>{t.study.ui.noShort}</Muted>
                ) : (
                  <NA />
                )
              ) : (
                <span className="flex flex-col gap-0.5">
                  <Num className="font-semibold">
                    {t.study.ui.shortShares(toFixedHalfUp(s.short.shares / 1e6, 1))}
                  </Num>
                  <span className="text-xs text-ink3">
                    <Num>
                      {[
                        s.short.pctOfShares === null ? null : b.shortPct(pct(s.short.pctOfShares)),
                        s.short.prior
                          ? b.shortTrend(
                              signedText(s.short.prior.changePct),
                              dayMonthYear(s.short.prior.date),
                            )
                          : null,
                        s.short.daysToCover === null
                          ? null
                          : b.daysToCover(toFixedHalfUp(s.short.daysToCover, 1)),
                        b.shortDate(dayMonthYear(s.short.date)),
                      ]
                        .filter((x) => x !== null)
                        .join(' · ')}
                    </Num>
                  </span>
                </span>
              )}
            </Line>
          </dl>
        </Block>

        <Block
          id="brief-context"
          title={b.sections.context}
          action={
            <Link
              to="/regime"
              className="inline-flex min-h-11 items-center text-[13px] font-medium text-link underline-offset-4 hover:underline"
            >
              {b.regimePage}
            </Link>
          }
        >
          <dl className="flex flex-col">
            <Line label={b.regime}>
              {busy(regime) ? (
                <Loading />
              ) : c.regime ? (
                <Num>
                  {b.regimeLine(
                    b.regimeLabels[c.regime.label] ?? c.regime.label,
                    dayMonthYear(c.regime.date),
                    c.regime.ruleVersion,
                  )}
                </Num>
              ) : regime.isSuccess ? (
                <Muted>{b.noRegime}</Muted>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.sectorVsSpy(c.sector ? c.sector.ticker : b.sectorFund)}>
              {busy(sector, spy) ? (
                <Loading />
              ) : c.sector ? (
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <Ret v={c.sector.rs1m} />
                  <span className="text-xs text-ink3">{b.periods['m1']}</span>
                  <Ret v={c.sector.rs3m} />
                  <span className="text-xs text-ink3">
                    {b.periods['m3']}{' '}
                    <Num>
                      {b.sectorTo(
                        dayMonthYear(c.sector.date),
                        b.sectorSource(sector.data?.source ?? ''),
                      )}
                    </Num>
                  </span>
                </span>
              ) : sector.isSuccess ? (
                <Muted>{b.noSector}</Muted>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.recession}>
              {busy(regime) ? (
                <Loading />
              ) : c.recession ? (
                <Num>
                  {b.recessionLine(
                    c.recession.triggered,
                    c.recession.available,
                    c.recession.level,
                    dayMonthYear(c.recession.date),
                  )}
                </Num>
              ) : (
                <NA />
              )}
            </Line>
          </dl>
          <p className="text-xs text-ink3">{b.noForecast}</p>
        </Block>

        <Block
          id="brief-next"
          title={b.sections.next}
          action={
            <OpenButton
              label={b.open(t.study.ui.sectionNames['filings'] ?? '')}
              onClick={() => onOpen('filings')}
            />
          }
        >
          <dl className="flex flex-col">
            <Line label={b.latest}>
              {busy(reports) ? (
                <Loading />
              ) : latest ? (
                <span className="flex flex-col gap-0.5">
                  <Num>
                    {b.latestLine(
                      eightK
                        ? [
                            ...eightK.items.map((i) => i.plain),
                            ...eightK.unknown.map((u) => b.item(u)),
                          ].join('; ')
                        : formLabel(latest.form),
                      latest.form,
                      dayMonthYear(latest.filingDate),
                    )}
                  </Num>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink3">
                    {eightK && (
                      <span>{b.materialityOf(t.study.materiality[eightK.materiality])}</span>
                    )}
                    {latestUrl && (
                      <a
                        href={latestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
                      >
                        {b.onSec}
                      </a>
                    )}
                  </span>
                </span>
              ) : reports.isSuccess ? (
                <Muted>{b.noReport}</Muted>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.riskFactors}>
              {busy(risk) ? (
                <Loading />
              ) : n.riskFactors ? (
                <span className={n.riskFactors.changed ? 'text-warn' : ''}>
                  <Num>
                    {n.riskFactors.changed
                      ? b.riskChanged(dayMonthYear(n.riskFactors.filingDate))
                      : b.riskSame(dayMonthYear(n.riskFactors.filingDate))}
                  </Num>
                </span>
              ) : risk.isSuccess ? (
                <Muted>{b.riskNone}</Muted>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.nextEarnings}>
              {earnings === undefined && busy(results) ? (
                <Loading />
              ) : n.earnings ? (
                <span className="flex flex-col gap-0.5">
                  <Num>
                    {b.earningsLine(
                      `${weekdayDayMonth(n.earnings.date)} ${n.earnings.date.slice(0, 4)}`,
                      n.earnings.daysAway >= 0
                        ? b.earningsAway(b.days(n.earnings.daysAway))
                        : b.earningsAgo(b.days(-n.earnings.daysAway)),
                    )}
                  </Num>
                  {n.earnings.overdue && (
                    <span className="text-xs text-warn">{t.study.ui.earningsOverdue}</span>
                  )}
                </span>
              ) : (
                <Muted>{results.isError ? b.na : t.study.ui.noEarnings}</Muted>
              )}
            </Line>
            <Line label={b.exDividend}>
              {busy(dividends) ? (
                <Loading />
              ) : n.exDividend ? (
                <Num>
                  {b.exDividendLine(
                    dayMonthYear(n.exDividend.date),
                    `${n.exDividend.currency === 'USD' ? '$' : `${n.exDividend.currency} `}${toFixedHalfUp(n.exDividend.cashAmount, 2)}`,
                  )}
                </Num>
              ) : dividends.isSuccess ? (
                <Muted>{b.noExDividend}</Muted>
              ) : (
                <NA />
              )}
            </Line>
            <Line label={b.events}>
              {busy(events) ? (
                <Loading />
              ) : n.halts && n.alerts ? (
                <span className="flex flex-col gap-0.5">
                  <Num>{b.eventsLine(n.halts.count, n.alerts.count)}</Num>
                  {n.halts.newest && (
                    <span className="text-xs text-ink3">
                      <Num>
                        {b.newestHalt(
                          dayMonthYear(etDate(new Date(n.halts.newest.haltedAt))),
                          n.halts.newest.reason,
                        )}
                      </Num>
                    </span>
                  )}
                  {n.alerts.newest && (
                    <span className="text-xs text-ink3">
                      <Num>
                        {b.newestAlert(
                          dayMonthYear(etDate(new Date(n.alerts.newest.createdAt))),
                          n.alerts.newest.headline,
                        )}
                      </Num>
                    </span>
                  )}
                </span>
              ) : (
                <NA />
              )}
            </Line>
          </dl>
        </Block>
      </div>
      <p className="text-xs text-ink3">
        <Num>
          {b.provenance(
            dayMonthYear(asOf),
            p.close ? dayMonthYear(p.close.date) : b.na,
            brief.formulaVersion,
            Object.values(brief.versions).join(', '),
          )}
        </Num>
      </p>
      <Info>
        <p>{b.method}</p>
        <p>
          <Num>
            {b.thresholds(
              BRIEF_RULES.revenueGrowthPct,
              BRIEF_RULES.netMarginPct,
              BRIEF_RULES.dilutionPct,
              BRIEF_RULES.shortInterestPct,
              BRIEF_RULES.rsSpyPct,
              BRIEF_RULES.strengthTop,
              BRIEF_RULES.strengthBottom,
              Math.abs(BRIEF_RULES.fromHighPct),
              BRIEF_RULES.earningsDays,
            )}
          </Num>
        </p>
      </Info>
    </section>
  );
}
