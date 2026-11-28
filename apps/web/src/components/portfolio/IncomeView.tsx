import { useState } from 'react';
import {
  DIVIDEND_WITHHOLDING,
  CHECK_RULES,
  forwardIncome,
  mergeDividends,
  portfolioDividends,
  trailingDividends,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { StatTile } from '../journal/shared';
import { tauricDividends } from '../../lib/portfolio';
import {
  MiniTable,
  Source,
  ViewState,
  bookOf,
  longDate,
  p,
  pct1,
  price2,
  shortDate,
  usd,
  usePortfolio,
} from './shared';

const n = p.income;

/** The withholding rate as a fraction, from the percent typed in; null when it is not a number from 0 to 100. */
const rateOf = (v: string): number | null => {
  const x = v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(x) && x >= 0 && x <= 100 ? x / 100 : null;
};

/**
 * Income (ADR 0048): forward 12-month dividends by holding from stored payments, yield on cost and on price, net of
 * US withholding (30% default, `DIVIDEND_WITHHOLDING`, editable here); the trailing 12 months for comparison; and the next ex-dates. No growth assumed.
 */
export function IncomeView() {
  const x = usePortfolio();
  const [rateText, setRateText] = useState(String(DIVIDEND_WITHHOLDING * 100));
  const rate = rateOf(rateText);
  const book = bookOf(x);
  const payouts = mergeDividends(x.data?.dividends ?? [], tauricDividends(x.data?.research ?? {}));
  const asOf = (tk: string) => x.bars[tk]?.at(-1)?.date ?? x.today;
  const inc = forwardIncome(
    book.positions.map((y) => ({
      ticker: y.ticker,
      shares: y.shares,
      price: y.price,
      costBasis: y.costBasis,
      payouts: payouts.filter((d) => d.ticker === y.ticker),
    })),
    x.today,
    rate ?? DIVIDEND_WITHHOLDING,
  );
  const ttm = portfolioDividends(
    book.positions.map((y) => ({
      ticker: y.ticker,
      shares: y.shares,
      price: y.price,
      ttmPerShare: trailingDividends(
        payouts.filter((d) => d.ticker === y.ticker),
        asOf(y.ticker),
      ).perShare,
    })),
  );
  const end = new Date(Date.parse(`${x.today}T00:00:00Z`) + CHECK_RULES.comingUpDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const upcoming = payouts.filter(
    (d) => d.exDate >= x.today && d.exDate <= end && x.tickers.includes(d.ticker),
  );
  const payers = inc.rows.filter((r) => r.basis !== 'none');
  const none = inc.rows.filter((r) => r.basis === 'none').map((r) => r.ticker);
  const w = rate === null ? p.na : pct1(rate);
  return (
    <Card id="portfolio-income-h" title={n.title} aside={<Info>{n.info}</Info>}>
      <ViewState x={x}>
        <section
          aria-label={n.summaryLabel}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5"
        >
          <StatTile label={n.forwardGross} value={usd(inc.gross)} sub={n.perYear} />
          <StatTile
            label={n.forwardNet(w)}
            value={rate === null ? p.na : usd(inc.net)}
            sub={n.withholdingShort}
          />
          <StatTile
            label={n.yieldOnCost}
            value={rate === null || inc.netYieldOnCost === null ? p.na : pct1(inc.netYieldOnCost)}
            sub={n.onCost(inc.yieldOnCost === null ? p.na : pct1(inc.yieldOnCost), usd(inc.cost))}
          />
          <StatTile
            label={n.yieldOnValue}
            value={inc.yieldOnValue === null ? p.na : pct1(inc.yieldOnValue)}
            sub={n.ttmLine(usd(ttm.income))}
          />
        </section>
        <div className="flex flex-col gap-1">
          <label htmlFor="income-withholding" className="text-xs font-medium text-ink2">
            {n.withholdingLabel(`${String(DIVIDEND_WITHHOLDING * 100)}%`)}
          </label>
          <input
            id="income-withholding"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            max={100}
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            aria-invalid={rate === null}
            aria-describedby="income-withholding-note"
            className="min-h-11 max-w-40 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums"
          />
          <span id="income-withholding-note" className="text-xs text-ink3">
            {rate === null ? n.withholdingInvalid : n.withholdingUnit}
          </span>
        </div>
        {payers.length === 0 ? (
          <p className="text-sm text-ink3">{n.noPayers}</p>
        ) : (
          <MiniTable
            label={n.tableAria}
            head={[p.table.ticker, n.perShare, n.basis, n.gross, n.net, n.yoc, n.yop]}
            align={['start', 'end', 'start', 'end', 'end', 'end', 'end']}
            rows={payers.map((r) => [
              <TickerLink key="t" ticker={r.ticker} />,
              price2(r.perShare),
              r.from
                ? n.basisText[r.basis](price2(r.from.amount), shortDate(r.from.exDate))
                : n.basisNone,
              usd(r.gross),
              rate === null ? p.na : usd(r.net),
              n.yocCell(
                rate === null || r.netYieldOnCost === null ? p.na : pct1(r.netYieldOnCost),
                r.yieldOnCost === null ? p.na : pct1(r.yieldOnCost),
              ),
              r.yieldOnPrice === null ? p.na : pct1(r.yieldOnPrice),
            ])}
          />
        )}
        {none.length > 0 && <Source>{n.nonPayers(none.join(', '))}</Source>}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink3">{n.upcomingTitle}</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink3">{n.noUpcoming}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {upcoming.map((d) => (
                <li
                  key={`${d.ticker}-${d.exDate}`}
                  className="flex flex-wrap justify-between gap-2"
                >
                  <span className="flex gap-2">
                    <TickerLink ticker={d.ticker} />
                    <span className="tabular-nums">{n.amount(price2(d.amount))}</span>
                  </span>
                  <span className="text-xs text-ink3 tabular-nums">
                    {n.exLine(
                      longDate(d.exDate),
                      d.payDate ? longDate(d.payDate) : null,
                      p.table.src[d.source] ?? d.source,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Source>
          {n.withholding(w)}{' '}
          {n.source(x.data?.dividendsFetchedAt ? longDate(x.data.dividendsFetchedAt) : p.na)}
        </Source>
      </ViewState>
    </Card>
  );
}
