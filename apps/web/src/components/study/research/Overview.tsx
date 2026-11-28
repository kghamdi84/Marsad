import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PERFORMANCE_RANGES,
  RESEARCH_TOLERANCES,
  adjustedAmount,
  companySnapshot,
  dailyBeta,
  differsBeyond,
  etDate,
  relativePerformance,
  toFixedHalfUp,
  trailingDividendYield,
  type DailyBar,
  type FinancialFact,
  type PerformanceRange,
  type StoredDividend,
  type TauricProfile,
  BETA_VERSION,
  DIVIDEND_YIELD_VERSION,
} from '@marsad/core';
import { RowList, Num, AutoGrid, type Row } from '../../ui/kit';
import { formatUsd } from '../../../lib/study';
import { loadBusinessSection } from '../../../lib/studyPanels';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { LineChart } from './charts';
import { Choice, Fold, R, SourceLine, Tile, Unavailable, etDay, pctText, plain, signedPctText } from './shared';

type Fmt = 'usd' | 'ratio' | 'frac' | 'count' | 'days' | 'price';
const fmt = (v: number | null, f: Fmt): string => {
  if (v === null) return R.na;
  switch (f) {
    case 'usd':
      return formatUsd(v);
    case 'ratio':
      return plain(v, 2);
    case 'frac':
      return pctText(v * 100, 2);
    case 'count':
      return v >= 1e9 ? `${toFixedHalfUp(v / 1e9, 2)}B` : v >= 1e6 ? `${toFixedHalfUp(v / 1e6, 1)}M` : plain(v, 0);
    case 'days':
      return R.stats.days(toFixedHalfUp(v, 2));
    case 'price':
      return `$${plain(v, 2)}`;
  }
};

const GROUPS: { key: keyof typeof R.stats.groups; rows: [keyof TauricProfile, Fmt][] }[] = [
  {
    key: 'valuation',
    rows: [
      ['market_cap', 'usd'],
      ['enterprise_value', 'usd'],
      ['pe_ratio', 'ratio'],
      ['forward_pe', 'ratio'],
      ['peg_ratio', 'ratio'],
      ['price_to_book', 'ratio'],
      ['price_to_sales', 'ratio'],
    ],
  },
  {
    key: 'profitability',
    rows: [
      ['profit_margin', 'frac'],
      ['operating_margin', 'frac'],
      ['return_on_assets', 'frac'],
      ['return_on_equity', 'frac'],
      ['revenue_growth', 'frac'],
      ['earnings_growth', 'frac'],
    ],
  },
  {
    key: 'balance',
    rows: [
      ['total_cash', 'usd'],
      ['total_debt', 'usd'],
      ['debt_to_equity', 'ratio'],
      ['current_ratio', 'ratio'],
      ['quick_ratio', 'ratio'],
    ],
  },
  {
    key: 'dividends',
    rows: [
      ['dividend_rate', 'price'],
      ['dividend_yield', 'frac'],
      ['payout_ratio', 'frac'],
    ],
  },
  {
    key: 'shares',
    rows: [
      ['beta', 'ratio'],
      ['shares_outstanding', 'count'],
      ['float_shares', 'count'],
      ['shares_short', 'count'],
      ['short_interest_of_float', 'frac'],
      ['days_to_cover', 'days'],
      ['institutional_ownership', 'frac'],
      ['insider_ownership', 'frac'],
      ['employees', 'count'],
    ],
  },
];

/** Key statistics from the Tauric profile; market value, beta and dividend yield also computed by Marsad. */
function KeyStats({
  profile,
  bars,
  spy,
  facts,
  dividends,
}: {
  profile: Part<TauricProfile>;
  bars: readonly DailyBar[];
  spy: readonly DailyBar[] | null;
  facts: readonly FinancialFact[] | null;
  dividends: readonly StoredDividend[] | null;
}) {
  const x = R.stats;
  const last = bars.at(-1) ?? null;
  const today = etDate(new Date());
  const snap = useMemo(
    () => (facts && last ? companySnapshot(facts, today, last.close) : null),
    [facts, last, today],
  );
  const beta = useMemo(() => (spy ? dailyBeta(bars, spy) : null), [bars, spy]);
  const dy = useMemo(
    () =>
      dividends && last
        ? trailingDividendYield(
            dividends.map((d) => ({ ...d, cashAmount: adjustedAmount(d) })),
            last.close,
            last.date,
          )
        : null,
    [dividends, last],
  );
  if (!profile.ok)
    return (
      <Tile id="rs-stats" title={x.title}>
        <Unavailable reason={profile.reason} />
      </Tile>
    );
  const p = profile.value;
  const asOf = profile.asOf ? etDay(profile.asOf) : R.na;
  const compare = (
    key: 'market_cap' | 'beta' | 'dividend_yield',
  ): { marsad: string; note: string } | null => {
    if (key === 'market_cap') {
      if (!snap?.marketValue || !snap.sharesOutstanding || !last) return null;
      const d = differsBeyond(snap.marketValue, p.market_cap, RESEARCH_TOLERANCES.marketValue);
      return {
        marsad: formatUsd(snap.marketValue),
        note: x.mvMarsad(
          formatUsd(snap.marketValue),
          dayMonthYear(last.date),
          dayMonthYear(snap.sharesOutstanding.end),
          d?.differs ? x.differs(pctText(RESEARCH_TOLERANCES.marketValue.value * 100, 0)) : x.agrees,
        ),
      };
    }
    if (key === 'beta') {
      if (!beta) return null;
      const d = differsBeyond(beta.value, p.beta, RESEARCH_TOLERANCES.beta);
      return {
        marsad: plain(beta.value, 2),
        note: x.betaMarsad(
          plain(beta.value, 2),
          beta.returns,
          dayMonthYear(beta.to),
          BETA_VERSION,
          d?.differs ? x.differs(plain(RESEARCH_TOLERANCES.beta.value, 1)) : x.agrees,
        ),
      };
    }
    if (!dy || !last) return null;
    const d = differsBeyond(
      dy.pct,
      p.dividend_yield === null ? null : p.dividend_yield * 100,
      RESEARCH_TOLERANCES.dividendYield,
    );
    return {
      marsad: pctText(dy.pct, 2),
      note: x.yieldMarsad(
        pctText(dy.pct, 2),
        dy.count,
        dayMonthYear(last.date),
        DIVIDEND_YIELD_VERSION,
        d?.differs ? x.differs(x.points(plain(RESEARCH_TOLERANCES.dividendYield.value, 1))) : x.agrees,
      ),
    };
  };
  return (
    <Tile id="rs-stats" title={x.title} aside={<span className="text-xs text-ink3">{x.aside}</span>}>
      <AutoGrid min={260} gap="gap-x-6 gap-y-3">
        {GROUPS.map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-ink2">{x.groups[g.key]}</h3>
            <p className="text-xs text-ink3">
              <Num>{x.refreshed(asOf)}</Num>
            </p>
            <RowList
              rows={g.rows.map(([k, f]): Row => {
                const c =
                  k === 'market_cap' || k === 'beta' || k === 'dividend_yield' ? compare(k) : null;
                return {
                  k: x.labels[k] ?? k,
                  v: <Num>{fmt(p[k] as number | null, f)}</Num>,
                  note: c ? <Num>{c.note}</Num> : undefined,
                };
              })}
            />
          </div>
        ))}
      </AutoGrid>
      <SourceLine>
        {x.source(asOf, p.market_cap_price_date ? dayMonthYear(p.market_cap_price_date) : R.na)}
      </SourceLine>
    </Tile>
  );
}

/** The stock and SPY as percent change from the same start, over the ranges stored bars cover. */
function VsSpy({
  ticker,
  bars,
  spy,
}: {
  ticker: string;
  bars: readonly DailyBar[];
  spy: readonly DailyBar[] | null;
}) {
  const x = R.perf;
  const all = useMemo(
    () =>
      Object.fromEntries(
        PERFORMANCE_RANGES.map((r) => [r, relativePerformance(bars, spy ?? [], r)]),
      ) as Record<PerformanceRange, ReturnType<typeof relativePerformance>>,
    [bars, spy],
  );
  const firstOk = PERFORMANCE_RANGES.find((r) => all[r].available) ?? '1y';
  const [range, setRange] = useState<PerformanceRange>(all['1y'].available ? '1y' : firstOk);
  const cur = all[range];
  return (
    <Tile id="rs-perf" title={x.title(ticker)}>
      <Choice
        label={x.ranges}
        value={range}
        onChange={setRange}
        options={PERFORMANCE_RANGES.map((r) => {
          const v = all[r];
          return {
            key: r,
            label: x.rangeNames[r] ?? r,
            disabled: v.available ? null : x.short(v.needs, v.have),
          };
        })}
      />
      {spy === null && <p className="text-xs text-warn">{x.noSpy}</p>}
      {cur.available ? (
        <>
          <LineChart
            label={x.aria(ticker, cur.start, cur.end)}
            zero
            format={(v) => signedPctText(v, 1)}
            series={[
              { name: ticker, values: cur.points.map((p) => p.stock), className: 'text-link' },
              { name: 'SPY', values: cur.points.map((p) => p.spy), className: 'text-ink3', dashed: true },
            ]}
          />
          <p className="text-sm text-ink">
            <Num>
              {x.end(
                ticker,
                signedPctText(cur.stockPct, 1),
                cur.spyPct === null ? R.na : signedPctText(cur.spyPct, 1),
                dayMonthYear(cur.start),
                dayMonthYear(cur.end),
              )}
            </Num>
          </p>
        </>
      ) : (
        <Unavailable />
      )}
      <SourceLine>{x.source}</SourceLine>
    </Tile>
  );
}

/** The vendor's profile description and the first paragraphs of the 10-K business section, as filed. */
function Business({
  profile,
  cik,
  onOpen,
}: {
  profile: Part<TauricProfile>;
  cik: string | undefined;
  onOpen: () => void;
}) {
  const x = R.business;
  const q = useQuery({
    queryKey: ['business', cik],
    queryFn: () => loadBusinessSection(cik as string),
    enabled: cik !== undefined,
  });
  const paras = useMemo(
    () =>
      q.data
        ? q.data.text
            .split(/\n+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 120)
            .slice(0, 3)
        : [],
    [q.data],
  );
  return (
    <Tile id="rs-business" title={x.title}>
      <h3 className="text-xs font-semibold text-ink2">{x.vendor}</h3>
      {profile.ok && profile.value.description ? (
        <>
          <p className="text-sm text-ink2 whitespace-pre-line">{profile.value.description}</p>
          <SourceLine>
            {x.vendorSource(profile.asOf ? etDay(profile.asOf) : R.na)}
            {profile.value.website ? ` · ${profile.value.website}` : ''}
          </SourceLine>
        </>
      ) : (
        <Unavailable reason={profile.ok ? null : profile.reason} />
      )}
      <h3 className="text-xs font-semibold text-ink2">{x.filed}</h3>
      {cik === undefined ? (
        <Unavailable />
      ) : q.isPending ? (
        <p className="text-sm text-ink3">{R.loading}</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-crit">{q.error.message}</p>
      ) : !q.data ? (
        <Unavailable />
      ) : (
        <>
          {paras.map((p, i) => (
            <p key={i} className="text-sm text-ink2">
              {p}
            </p>
          ))}
          <SourceLine>{x.filedSource(dayMonthYear(q.data.periodEnd), dayMonthYear(q.data.filingDate))}</SourceLine>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-11 items-center self-start text-[13px] font-medium text-link underline-offset-4 hover:underline"
          >
            {x.openFull}
          </button>
        </>
      )}
    </Tile>
  );
}

export function OverviewView(props: {
  ticker: string;
  bars: readonly DailyBar[];
  spy: readonly DailyBar[] | null;
  facts: readonly FinancialFact[] | null;
  dividends: readonly StoredDividend[] | null;
  profile: Part<TauricProfile>;
  cik: string | undefined;
  onOpenBusiness: () => void;
}) {
  return (
    <>
      <VsSpy ticker={props.ticker} bars={props.bars} spy={props.spy} />
      <KeyStats
        profile={props.profile}
        bars={props.bars}
        spy={props.spy}
        facts={props.facts}
        dividends={props.dividends}
      />
      <Fold label={R.business.title}>
        <Business profile={props.profile} cik={props.cik} onOpen={props.onOpenBusiness} />
      </Fold>
    </>
  );
}
