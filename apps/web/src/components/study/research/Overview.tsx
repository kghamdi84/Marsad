import { useMemo, useState } from 'react';
import {
  PERFORMANCE_RANGES,
  RESEARCH_TOLERANCES,
  adjustedAmount,
  companySnapshot,
  investorView,
  INVESTOR_VERSION,
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
import { Num, AutoGrid } from '../../ui/kit';
import { formatUsd } from '../../../lib/study';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { LineChart } from './charts';
import {
  Choice,
  R,
  SourceLine,
  Tile,
  Unavailable,
  etDay,
  pctText,
  plain,
  signedPctText,
  Rows,
} from './shared';

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
      return v >= 1e9
        ? `${toFixedHalfUp(v / 1e9, 2)}B`
        : v >= 1e6
          ? `${toFixedHalfUp(v / 1e6, 1)}M`
          : plain(v, 0);
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
export function KeyStats({
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
  const inv = useMemo(
    () => (facts && last ? investorView(facts, today, last.close) : null),
    [facts, last, today],
  );
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
          d?.differs
            ? x.differs(pctText(RESEARCH_TOLERANCES.marketValue.value * 100, 0))
            : x.agrees,
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
        d?.differs
          ? x.differs(x.points(plain(RESEARCH_TOLERANCES.dividendYield.value, 1)))
          : x.agrees,
      ),
    };
  };
  return (
    <Tile
      id="rs-stats"
      title={x.title}
      aside={<span className="text-xs text-ink3">{x.aside}</span>}
    >
      <AutoGrid min={260} gap="gap-x-6 gap-y-3">
        {GROUPS.map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-ink2">{x.groups[g.key]}</h3>
            <p className="text-xs text-ink3">
              <Num>{x.refreshed(asOf)}</Num>
            </p>
            <Rows
              rows={g.rows.map(([k, f]) => {
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
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-ink2">{x.groups.marsad}</h3>
          <p className="text-xs text-ink3">
            <Num>{x.marsadAsOf(dayMonthYear(today), INVESTOR_VERSION)}</Num>
          </p>
          <Rows
            rows={[
              {
                k: x.dilution,
                v: (
                  <Num>
                    {inv?.dilutionYoYPct == null ? R.na : signedPctText(inv.dilutionYoYPct, 1)}
                  </Num>
                ),
                note: x.dilutionNote,
              },
              {
                k: x.fcfMargin,
                v: <Num>{inv?.fcfMarginPct == null ? R.na : pctText(inv.fcfMarginPct, 1)}</Num>,
                note: x.fcfNote,
              },
              {
                k: x.netCash,
                v: (
                  <Num>{inv?.balance?.netCash == null ? R.na : formatUsd(inv.balance.netCash)}</Num>
                ),
                note: inv?.balance ? (
                  <Num>{x.netCashNote(dayMonthYear(inv.balance.end))}</Num>
                ) : undefined,
              },
            ]}
          />
        </div>
      </AutoGrid>
      <SourceLine>
        {x.source(asOf, p.market_cap_price_date ? dayMonthYear(p.market_cap_price_date) : R.na)}
      </SourceLine>
    </Tile>
  );
}

/** The stock and SPY as percent change from the same start, over the ranges stored bars cover. */
export function VsSpy({
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
              {
                name: 'SPY',
                values: cur.points.map((p) => p.spy),
                className: 'text-ink3',
                dashed: true,
              },
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

/** The vendor's profile description, labelled as vendor text; the 10-K business section sits beside it as filed. */
export function VendorBusiness({ profile }: { profile: Part<TauricProfile> }) {
  const x = R.business;
  return (
    <Tile id="rs-business" title={x.vendor}>
      {profile.ok && profile.value.description ? (
        <>
          <p className="text-sm whitespace-pre-line text-ink2">{profile.value.description}</p>
          <SourceLine>
            {x.vendorSource(profile.asOf ? etDay(profile.asOf) : R.na)}
            {profile.value.website ? ` · ${profile.value.website}` : ''}
          </SourceLine>
        </>
      ) : (
        <Unavailable reason={profile.ok ? null : profile.reason} />
      )}
    </Tile>
  );
}

/** Insider, institutional and other holders from the Tauric profile, or the raw figures when they overlap. */
export function OwnershipBar({ profile }: { profile: Part<TauricProfile> }) {
  const x = R.stats;
  if (!profile.ok)
    return (
      <Tile id="rs-own" title={x.ownership}>
        <Unavailable reason={profile.reason} />
      </Tile>
    );
  const ins = profile.value.insider_ownership;
  const inst = profile.value.institutional_ownership;
  const asOf = profile.asOf ? etDay(profile.asOf) : R.na;
  if (ins === null || inst === null)
    return (
      <Tile id="rs-own" title={x.ownership}>
        <Unavailable />
      </Tile>
    );
  const pc = (v: number) => pctText(v * 100, 1);
  const over = ins + inst > 1;
  const other = Math.max(0, 1 - ins - inst);
  return (
    <Tile id="rs-own" title={x.ownership}>
      {over ? (
        <p className="text-sm text-ink2">
          <Num>{x.overlap(pc(ins), pc(inst))}</Num>
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={x.ownershipAria(pc(ins), pc(inst), pc(other))}
            className="flex h-3 overflow-hidden rounded-full bg-sub"
          >
            <span className="bg-warn" style={{ width: `${ins * 100}%` }} />
            <span className="bg-link" style={{ width: `${inst * 100}%` }} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink2">
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-warn" />
              {x.insiders} <Num className="font-semibold text-ink">{pc(ins)}</Num>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-link" />
              {x.institutions} <Num className="font-semibold text-ink">{pc(inst)}</Num>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-sm bg-sub ring-1 ring-line-strong"
              />
              {x.other} <Num className="font-semibold text-ink">{pc(other)}</Num>
            </li>
          </ul>
        </>
      )}
      <SourceLine>{x.refreshed(asOf)}</SourceLine>
    </Tile>
  );
}
