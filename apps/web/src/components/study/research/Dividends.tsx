import { useMemo, useState } from 'react';
import {
  DIVIDEND_CALC_VERSION,
  DIVIDENDS_VERSION,
  PAYOUT_FREQUENCIES,
  adjustedAmount,
  dividendCalc,
  dividendCalcCsv,
  dividendSummary,
  etDate,
  pointInTime,
  preferConcepts,
  quarterlyValues,
  sessionReturn,
  trailingFourQuarters,
  type DailyBar,
  type DividendCalcPlan,
  type FinancialFact,
  type StoredDividend,
  type TauricAnalyst,
  type TauricProfile,
} from '@marsad/core';
import { Segmented } from '../../Card';
import { AutoGrid, Num, RowList } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { BarChart } from './charts';
import {
  Fold,
  R,
  SourceLine,
  Tile,
  etDay,
  money,
  pctText,
  plain,
  saveText,
  signedPctText,
  td,
  tdEnd,
  th,
  thEnd,
} from './shared';

const freqName = (n: number | null) =>
  n === null ? R.na : (R.dividends.freq[String(n)] ?? R.dividends.freqN(n));

export function DividendsView({
  ticker,
  bars,
  dividends,
  dividendsError,
  facts,
  profile,
  analyst,
}: {
  ticker: string;
  bars: readonly DailyBar[];
  dividends: readonly StoredDividend[] | null;
  dividendsError: string | null;
  facts: readonly FinancialFact[] | null;
  profile: Part<TauricProfile>;
  analyst: Part<TauricAnalyst>;
}) {
  const x = R.dividends;
  const today = etDate(new Date());
  const last = bars.at(-1) ?? null;
  const epsTtm = useMemo(() => {
    if (!facts) return null;
    const q = quarterlyValues(
      preferConcepts(pointInTime(facts, today), ['EarningsPerShareDiluted'], 'USD/shares'),
    );
    return trailingFourQuarters(q)?.value ?? null;
  }, [facts, today]);
  const s = useMemo(
    () =>
      dividends
        ? dividendSummary({
            dividends,
            close: last?.close ?? null,
            closeDate: last?.date ?? null,
            today,
            epsTtm,
          })
        : null,
    [dividends, last, today, epsTtm],
  );
  const word =
    analyst.ok && analyst.value.recommendation
      ? R.analyst.words[analyst.value.recommendation]
      : null;
  const vendorPayout = profile.ok ? profile.value.payout_ratio : null;
  if (dividendsError)
    return (
      <p role="alert" className="text-sm text-crit">
        {dividendsError}
      </p>
    );
  if (!s) return <p className="text-sm text-ink3">{R.loading}</p>;
  const n = s.next;
  const recent = s.annual.length ? [...(dividends ?? [])].slice(-20) : [];
  return (
    <>
      <Tile
        id="rs-div"
        title={x.title}
        aside={word ? <span className="text-xs text-ink3">{x.consensus(word)}</span> : undefined}
      >
        {(dividends ?? []).length === 0 ? (
          <p className="text-sm text-ink3">{x.none(ticker)}</p>
        ) : (
          <RowList
            rows={[
              {
                k: x.next,
                v: n ? <Num>{dayMonthYear(n.exDividendDate)}</Num> : x.noNext,
                note: n ? (
                  <Num>
                    {x.nextNote(
                      n.recordDate ? dayMonthYear(n.recordDate) : R.na,
                      n.payDate ? dayMonthYear(n.payDate) : R.na,
                      money(n.cashAmount, 4),
                    )}
                  </Num>
                ) : undefined,
              },
              {
                k: x.amount,
                v: s.latest ? <Num>{money(adjustedAmount(s.latest), 4)}</Num> : R.na,
                note: s.latest ? (
                  <Num>
                    {x.amountNote(
                      dayMonthYear(s.latest.exDividendDate),
                      freqName(s.frequency),
                      s.frequencySource === 'inferred' ? x.inferred : x.stated,
                    )}
                  </Num>
                ) : undefined,
              },
              {
                k: x.yield,
                v: s.yield ? <Num>{pctText(s.yield.pct, 2)}</Num> : R.na,
                note: s.yield ? (
                  <Num>
                    {x.yieldNote(
                      money(s.yield.total, 4),
                      s.yield.count,
                      dayMonthYear(s.yield.closeDate),
                    )}
                  </Num>
                ) : undefined,
              },
              {
                k: x.payout,
                v: s.payoutPct === null ? R.na : <Num>{pctText(s.payoutPct, 1)}</Num>,
                note: (
                  <Num>
                    {x.payoutNote(
                      epsTtm === null ? R.na : money(epsTtm),
                      vendorPayout === null ? R.na : pctText(vendorPayout * 100, 1),
                    )}
                  </Num>
                ),
              },
              {
                k: x.cuts,
                v: <Num>{s.cuts.length === 0 ? x.noCuts : x.cutCount(s.cuts.length)}</Num>,
                note:
                  s.cuts.length > 0 ? (
                    <Num>
                      {s.cuts
                        .slice(-3)
                        .map((k) =>
                          x.cutLine(
                            dayMonthYear(k.exDividendDate),
                            money(k.previous, 4),
                            money(k.amount, 4),
                            signedPctText(k.changePct, 1),
                          ),
                        )
                        .join(' · ')}
                    </Num>
                  ) : (
                    x.cutsRule
                  ),
              },
              {
                k: x.growth,
                v: (
                  <Num>
                    {s.growth.atLeast ? x.atLeast(s.growth.years) : x.years(s.growth.years)}
                  </Num>
                ),
                note: <Num>{x.growthNote(s.historyFrom ? dayMonthYear(s.historyFrom) : R.na)}</Num>,
              },
            ]}
          />
        )}
        {recent.length > 0 && (
          <BarChart
            label={x.chartAria(recent.length)}
            groups={recent.map((d) => ({
              label: d.exDividendDate.slice(2, 7),
              values: [adjustedAmount(d)],
            }))}
            series={[{ name: x.perPayment, className: 'text-link' }]}
            format={(v) => money(v, 4)}
          />
        )}
        {recent.length > 0 && (
          <Fold label={x.history((dividends ?? []).length)}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">{x.history((dividends ?? []).length)}</caption>
                <thead>
                  <tr>
                    <th className={th}>{x.cols.ex}</th>
                    <th className={th}>{x.cols.record}</th>
                    <th className={th}>{x.cols.pay}</th>
                    <th className={th}>{x.cols.declared}</th>
                    <th className={th}>{x.cols.freq}</th>
                    <th className={thEnd}>{x.cols.amount}</th>
                    <th className={thEnd}>{x.cols.adjusted}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(dividends ?? [])].reverse().map((d) => (
                    <tr key={d.exDividendDate}>
                      <td className={td}>
                        <Num>{dayMonthYear(d.exDividendDate)}</Num>
                      </td>
                      <td className={td}>
                        <Num>{d.recordDate ? dayMonthYear(d.recordDate) : R.na}</Num>
                      </td>
                      <td className={td}>
                        <Num>{d.payDate ? dayMonthYear(d.payDate) : R.na}</Num>
                      </td>
                      <td className={td}>
                        <Num>{d.declarationDate ? dayMonthYear(d.declarationDate) : R.na}</Num>
                      </td>
                      <td className={td}>{freqName(d.frequency)}</td>
                      <td className={tdEnd}>
                        {d.currency === 'USD'
                          ? money(d.cashAmount, 4)
                          : `${d.currency} ${plain(d.cashAmount, 4)}`}
                      </td>
                      <td className={tdEnd}>
                        {d.splitAdjustedAmount === null ? R.na : money(d.splitAdjustedAmount, 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        )}
        <SourceLine>{x.source(DIVIDENDS_VERSION)}</SourceLine>
      </Tile>
      <Calculator bars={bars} dividends={dividends ?? []} profile={profile} ticker={ticker} />
    </>
  );
}

const num = (s: string): number | null => {
  if (s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const nearestFreq = (n: number) =>
  PAYOUT_FREQUENCIES.reduce(
    (best, f) => (Math.abs(f - n) < Math.abs(best - n) ? f : best),
    4 as number,
  );

function Field({
  id,
  label,
  value,
  onChange,
  source,
  step = 'any',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  source?: string;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink2">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums"
      />
      {source && <span className="text-xs text-ink3">{source}</span>}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  source,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  source?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
      >
        <option value="">{R.na}</option>
        {PAYOUT_FREQUENCIES.map((f) => (
          <option key={f} value={String(f)}>
            {freqName(f)}
          </option>
        ))}
      </select>
      {source && <span className="text-xs text-ink3">{source}</span>}
    </div>
  );
}

function PlanCard({
  id,
  title,
  p,
  drip,
}: {
  id: string;
  title: string;
  p: DividendCalcPlan;
  drip: boolean;
}) {
  const c = R.calc;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3"
    >
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      <RowList
        rows={[
          { k: c.monthly, v: <Num>{money(p.monthlyIncome)}</Num> },
          {
            k: c.finalYear,
            v: <Num>{money(p.finalYearNet)}</Num>,
            note: <Num>{c.gross(money(p.finalYearGross))}</Num>,
          },
          {
            k: c.value,
            v: <Num>{money(p.endValue)}</Num>,
            note: <Num>{c.deposits(money(p.deposits))}</Num>,
          },
          {
            k: drip ? c.reinvested : c.totalDividends,
            v: <Num>{money(p.dividendsNet)}</Num>,
            note: <Num>{c.taxLine(money(p.dividendsGross), money(p.tax))}</Num>,
          },
          { k: c.totalReturn, v: <Num>{pctText(p.totalReturnPct, 2)}</Num> },
          { k: c.annual, v: <Num>{pctText(p.averageAnnualPct, 2)}</Num> },
        ]}
      />
    </section>
  );
}

/** Dividend calculator (dividend-calc-1): a projection from the person's inputs, prefilled from stored data. */
function Calculator({
  ticker,
  bars,
  dividends,
  profile,
}: {
  ticker: string;
  bars: readonly DailyBar[];
  dividends: readonly StoredDividend[];
  profile: Part<TauricProfile>;
}) {
  const c = R.calc;
  const last = bars.at(-1) ?? null;
  const pre = useMemo(() => {
    const s = last
      ? dividendSummary({
          dividends,
          close: last.close,
          closeDate: last.date,
          today: last.date,
          epsTtm: null,
        })
      : null;
    const marsadYield = s?.yield && s.yield.count > 0 ? s.yield : null;
    const vendorYield = profile.ok ? profile.value.dividend_yield : null;
    return {
      price: last ? String(last.close) : '',
      priceSource: last ? c.priceFrom(dayMonthYear(last.date)) : R.na,
      yieldPct: marsadYield
        ? String(Number(marsadYield.pct.toFixed(6)))
        : vendorYield !== null
          ? String(Number((vendorYield * 100).toFixed(6)))
          : '',
      yieldSource: marsadYield
        ? c.yieldMarsad(marsadYield.count, dayMonthYear(marsadYield.closeDate))
        : vendorYield !== null && profile.ok
          ? c.yieldTauric(profile.asOf ? etDay(profile.asOf) : R.na)
          : R.na,
      freq: marsadYield ? String(nearestFreq(marsadYield.count)) : '',
      freqSource: marsadYield ? c.freqFrom(marsadYield.count) : R.na,
    };
  }, [last, dividends, profile, c]);
  const [price, setPrice] = useState(pre.price);
  const [shares, setShares] = useState('100');
  const [amount, setAmount] = useState(() => {
    const p = num(pre.price);
    return p === null ? '' : String(Number((p * 100).toFixed(2)));
  });
  const [years, setYears] = useState('5');
  const [yieldPct, setYieldPct] = useState(pre.yieldPct);
  const [freq, setFreq] = useState(pre.freq);
  const [contrib, setContrib] = useState('0');
  const [contribFreq, setContribFreq] = useState('12');
  const [tax, setTax] = useState('30');
  const [divGrowth, setDivGrowth] = useState('0');
  const [priceGrowth, setPriceGrowth] = useState('0');
  const [mode, setMode] = useState<'cash' | 'drip'>('cash');
  const y1 = useMemo(() => sessionReturn(bars, 252), [bars]);

  const onShares = (v: string) => {
    setShares(v);
    const p = num(price);
    const s = num(v);
    if (p !== null && s !== null) setAmount(String(Number((p * s).toFixed(2))));
  };
  const onAmount = (v: string) => {
    setAmount(v);
    const p = num(price);
    const a = num(v);
    if (p !== null && p > 0 && a !== null) setShares(String(Number((a / p).toFixed(6))));
  };
  const onPrice = (v: string) => {
    setPrice(v);
    const p = num(v);
    const s = num(shares);
    if (p !== null && s !== null) setAmount(String(Number((p * s).toFixed(2))));
  };

  const inputs = [price, shares, years, yieldPct, freq].map(num);
  const missing = inputs.some((v) => v === null);
  const r = missing
    ? null
    : dividendCalc({
        price: inputs[0] as number,
        shares: inputs[1] as number,
        years: inputs[2] as number,
        yieldPct: inputs[3] as number,
        payoutsPerYear: inputs[4] as number,
        yearlyContribution: num(contrib) ?? 0,
        contributionsPerYear: num(contribFreq) ?? 12,
        taxPct: num(tax) ?? 0,
        dividendGrowthPct: num(divGrowth) ?? 0,
        priceGrowthPct: num(priceGrowth) ?? 0,
      });
  const plan = r?.ok ? (mode === 'cash' ? r.cash : r.drip) : null;
  return (
    <Tile id="rs-calc" title={c.title}>
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <AutoGrid min={170} gap="gap-3">
          <Field
            id="calc-price"
            label={c.price}
            value={price}
            onChange={onPrice}
            source={pre.priceSource}
          />
          <Field id="calc-shares" label={c.shares} value={shares} onChange={onShares} />
          <Field id="calc-amount" label={c.amount} value={amount} onChange={onAmount} />
          <Field id="calc-years" label={c.years} value={years} onChange={setYears} step="1" />
          <Field
            id="calc-yield"
            label={c.yield}
            value={yieldPct}
            onChange={setYieldPct}
            source={pre.yieldSource}
          />
          <Select
            id="calc-freq"
            label={c.freq}
            value={freq}
            onChange={setFreq}
            source={pre.freqSource}
          />
        </AutoGrid>
        <Fold label={c.advanced}>
          <AutoGrid min={170} gap="gap-3">
            <Field id="calc-contrib" label={c.contrib} value={contrib} onChange={setContrib} />
            <Select
              id="calc-contrib-freq"
              label={c.contribFreq}
              value={contribFreq}
              onChange={setContribFreq}
            />
            <Field id="calc-tax" label={c.tax} value={tax} onChange={setTax} source={c.taxNote} />
            <Field
              id="calc-div-growth"
              label={c.divGrowth}
              value={divGrowth}
              onChange={setDivGrowth}
            />
            <Field
              id="calc-price-growth"
              label={c.priceGrowth}
              value={priceGrowth}
              onChange={setPriceGrowth}
              source={
                y1 === null
                  ? c.priceChangeNone
                  : c.priceChange(signedPctText(y1, 1), last ? dayMonthYear(last.date) : R.na)
              }
            />
          </AutoGrid>
        </Fold>
      </form>
      {missing ? (
        <p className="text-sm text-ink3">{c.needInputs}</p>
      ) : r && !r.ok ? (
        <p role="alert" className="text-sm text-crit">
          {c.invalid(r.reason)}
        </p>
      ) : r?.ok ? (
        <>
          <div aria-live="polite" className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <PlanCard id="calc-cash" title={c.cash} p={r.cash} drip={false} />
            <PlanCard id="calc-drip" title={c.drip} p={r.drip} drip />
          </div>
          <p className="text-xs text-ink3">{c.monthlyNote}</p>
          <p className="text-sm font-medium text-ink2">{c.disclaimer}</p>
          <Fold label={c.yearly}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label={c.yearlyMode}
                options={[
                  { key: 'cash', label: c.cash },
                  { key: 'drip', label: c.drip },
                ]}
                value={mode}
                onChange={setMode}
              />
              <button
                type="button"
                onClick={() =>
                  plan && saveText(`marsad-${ticker}-dividend-${mode}.csv`, dividendCalcCsv(plan))
                }
                className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
              >
                {c.csv}
              </button>
            </div>
            {plan && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <caption className="sr-only">{c.yearly}</caption>
                  <thead>
                    <tr>
                      {c.cols.map((h, i) => (
                        <th key={h} className={i === 0 ? th : thEnd}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.years.map((y) => (
                      <tr key={y.year}>
                        <td className={td}>{y.year}</td>
                        <td className={tdEnd}>{plain(y.sharesStart, 4)}</td>
                        <td className={tdEnd}>{money(y.dividendPerShare)}</td>
                        <td className={tdEnd}>{money(y.dividendsNet)}</td>
                        <td className={tdEnd}>{y.payouts}</td>
                        <td className={tdEnd}>{money(y.contributions)}</td>
                        <td className={tdEnd}>{plain(y.sharesEnd, 4)}</td>
                        <td className={tdEnd}>{money(y.priceEnd)}</td>
                        <td className={tdEnd}>{money(y.valueEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Fold>
          <SourceLine>{c.source(DIVIDEND_CALC_VERSION)}</SourceLine>
        </>
      ) : null}
    </Tile>
  );
}
