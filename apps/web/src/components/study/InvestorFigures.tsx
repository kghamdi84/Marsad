import { investorView, toFixedHalfUp, type FinancialFact, type Metric } from '@marsad/core';
import { Info } from '../Info';
import { t } from '../../strings';
import { Cell, num, td, th, thNum, usd } from './Panel';

const x = t.study.investor;
const pct1 = (v: number | null) =>
  v === null ? null : `${v > 0 ? '+' : ''}${toFixedHalfUp(v, 1)}%`;
const times = (v: number | null) => (v === null ? null : `${toFixedHalfUp(v, 1)}x`);

function Fact({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-bg/50 px-3 py-2">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

const money = (m: Metric) => <Cell m={m} text={usd(m.value)} />;

/**
 * Free cash flow, stock-based pay, dilution, net cash, market value and multiples, and ten fiscal years (council
 * batch 4). Everything comes from SEC filings as filed by `asOf`; market value uses the close on or before it.
 */
export function InvestorFigures({
  facts,
  asOf,
  price,
}: {
  facts: readonly FinancialFact[];
  asOf: string;
  price: { close: number; date: string } | null;
}) {
  const v = investorView(facts, asOf, price?.close ?? null);
  const nr = t.study.financials.notReported;
  const top = Math.max(0, ...v.annual.map((a) => a.revenue.value ?? 0));
  const years = v.annual.map((a) => Number(a.end.slice(0, 4)));
  return (
    <section aria-labelledby="investor-h" className="flex flex-col gap-2.5">
      <h3 id="investor-h" className="mt-2 text-sm font-medium">
        {x.title}
      </h3>
      <dl className="grid grid-cols-2 gap-1.5 text-sm tablet:grid-cols-4">
        <Fact
          k={x.fcf}
          v={money(v.ttm.freeCashFlow)}
          sub={v.fcfMarginPct === null ? null : x.margin(toFixedHalfUp(v.fcfMarginPct, 1))}
        />
        <Fact
          k={x.sbc}
          v={money(v.ttm.stockComp)}
          sub={
            v.stockCompPctRevenue === null
              ? null
              : x.ofRevenue(toFixedHalfUp(v.stockCompPctRevenue, 1))
          }
        />
        <Fact k={x.buybacks} v={money(v.ttm.buybacks)} />
        <Fact k={x.dilution} v={pct1(v.dilutionYoYPct) ?? nr} />
        <Fact
          k={v.balance?.netCash != null && v.balance.netCash < 0 ? x.netDebt : x.netCash}
          v={v.balance?.netCash == null ? nr : usd(Math.abs(v.balance.netCash))}
          sub={v.balance ? x.at(v.balance.end) : null}
        />
        <Fact
          k={x.marketValue}
          v={v.marketValue === null ? nr : usd(v.marketValue)}
          sub={price && v.sharesOutstanding ? x.mvSub(price.date, v.sharesOutstanding.end) : null}
        />
        <Fact k={x.ev} v={v.enterpriseValue === null ? nr : usd(v.enterpriseValue)} />
        <Fact k={x.evSales} v={times(v.evToSales) ?? nr} />
        <Fact k={x.evEbit} v={times(v.evToEbit) ?? x.notMeaningful} />
        <Fact k={x.pFcf} v={times(v.priceToFcf) ?? x.notMeaningful} />
        <Fact k={x.fcfYield} v={pct1(v.fcfYieldPct) ?? nr} />
      </dl>
      {v.annual.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-medium">{x.tenYears(v.annual.length)}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>{x.year}</th>
                  <th className={th}>{x.revenue}</th>
                  <th className={thNum}>{x.eps}</th>
                  <th className={thNum}>{x.fcfShort}</th>
                </tr>
              </thead>
              <tbody>
                {[...v.annual].reverse().map((a, i, arr) => {
                  const y = Number(a.end.slice(0, 4));
                  const next = arr[i - 1];
                  const gap = next ? Number(next.end.slice(0, 4)) - y > 1 : false;
                  return (
                    <tr key={a.end}>
                      <td className={td}>
                        {a.end.slice(0, 4)}
                        {gap && <span className="block text-xs text-warn">{x.gap}</span>}
                      </td>
                      <td className={`${td} w-1/2`}>
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="h-2.5 flex-1 rounded-sm bg-faint/15">
                            <span
                              className="block h-full rounded-sm bg-up"
                              style={{
                                width: `${top > 0 && a.revenue.value ? toFixedHalfUp((a.revenue.value / top) * 100, 1) : 0}%`,
                              }}
                            />
                          </span>
                          <span className="min-w-20 text-end tabular-nums">{money(a.revenue)}</span>
                        </span>
                      </td>
                      <td className={`${td} ${num}`}>
                        <Cell m={a.epsDiluted} text={usd(a.epsDiluted.value)} />
                      </td>
                      <td className={`${td} ${num}`}>{money(a.freeCashFlow)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {years.length > 1 && (
            <p className="sr-only">{x.range(String(years[0]), String(years.at(-1)))}</p>
          )}
        </>
      )}
      <Info>
        <p>{x.method}</p>
        <p>{x.version(v.formulaVersion)}</p>
      </Info>
    </section>
  );
}
