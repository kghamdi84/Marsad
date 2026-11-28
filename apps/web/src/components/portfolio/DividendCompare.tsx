import { useState, type FormEvent } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  DIVIDEND_WITHHOLDING,
  HISTORICAL_SESSIONS,
  dividendCompare,
  toFixedHalfUp,
  type DividendCompareRow,
  type HistoricalReturn,
} from '@marsad/core';
import { Card } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { saveText } from '../study/research/shared';
import {
  csvCell,
  loadCompareInputs,
  loadDividendPayers,
  type CompareInputs,
} from '../../lib/dividendCompare';
import { figuresOf, loadSummaries } from '../../lib/summary';
import { loadWatchlist } from '../../lib/watchlist';
import {
  MiniTable,
  Source,
  longDate,
  p,
  price2,
  shortDate,
  tone,
  usd,
  usePortfolio,
} from './shared';

const c = p.compare;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

/** A percent (already in percent units) with its sign and arrow. */
const arrow = (v: number) =>
  `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${toFixedHalfUp(Math.abs(v), 1)}%`;
const shares = (v: number) => toFixedHalfUp(v, 3);

function Pct({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink3">{p.na}</span>;
  return <span className={`tabular-nums ${tone(v)}`}>{arrow(v)}</span>;
}

function Historical({ h }: { h: HistoricalReturn }) {
  if (!h.available) return <span className="text-xs whitespace-normal text-ink3">{h.reason}</span>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Pct v={h.totalReturnPct} />
      <span className="text-[11px] text-ink3">
        {c.histPrice(arrow(h.priceChangePct), shortDate(h.from), shortDate(h.to))}
      </span>
    </span>
  );
}

function toCsv(rows: readonly DividendCompareRow[], method: string, taxPct: number): string {
  const head = [
    'ticker',
    'price',
    'price_date',
    'price_change_1y_pct',
    'yield_pct',
    'payouts_per_year',
    'start_shares',
    'end_shares',
    'annual_income_net',
    'dividends_net_total',
    'end_balance',
    'projection_total_return_pct',
    'historical_1y_total_return_pct',
    'historical_1y_price_change_pct',
    'historical_3y_total_return_pct',
    'historical_3y_price_change_pct',
    'unavailable',
  ];
  const h = (x: HistoricalReturn, k: 'totalReturnPct' | 'priceChangePct') =>
    x.available ? x[k] : null;
  const lines = rows.map((r) =>
    [
      r.ticker,
      r.price,
      r.priceDate,
      r.priceChange1yPct,
      r.yieldPct,
      r.payoutsPerYear,
      r.projection?.startShares ?? null,
      r.projection?.endShares ?? null,
      r.projection?.annualIncomeNet ?? null,
      r.projection?.dividendsNet ?? null,
      r.projection?.endBalance ?? null,
      r.projection?.totalReturnPct ?? null,
      h(r.historical.y1, 'totalReturnPct'),
      h(r.historical.y1, 'priceChangePct'),
      h(r.historical.y3, 'totalReturnPct'),
      h(r.historical.y3, 'priceChangePct'),
      [
        r.projectionUnavailable,
        r.historical.y1.available ? null : `1y: ${r.historical.y1.reason}`,
        r.historical.y3.available ? null : `3y: ${r.historical.y3.reason}`,
      ]
        .filter(Boolean)
        .join('; ') || null,
    ]
      .map(csvCell)
      .join(','),
  );
  return [
    `${csvCell('method')},${csvCell(method)}`,
    `${csvCell('withholding_pct')},${taxPct}`,
    '',
    head.join(','),
    ...lines,
  ].join('\n');
}

const field =
  'min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums';

/**
 * Compare dividend returns (core `dividend-compare-1`): the same amount in each ticker for N years with DRIP on
 * or off, at today's price and yield held fixed, beside the trailing 1-year price change and the historical
 * 1-year and 3-year total returns from stored closes plus dividends. The projection never shows without the
 * price change next to it. Defaults to the holdings and watchlist names that paid a dividend in the last year.
 */
export function DividendCompare() {
  const x = usePortfolio();
  const wl = useQuery({ queryKey: ['watchlist'], queryFn: loadWatchlist });
  const candidates = [...new Set([...x.tickers, ...(wl.data?.tickers ?? [])])];
  const payers = useQuery({
    queryKey: ['dividend-payers', candidates, x.today],
    queryFn: () => loadDividendPayers(candidates, x.today),
    enabled: !x.pending && !wl.isPending,
  });
  const [chosen, setChosen] = useState<string[] | null>(null);
  const tickers = chosen ?? payers.data ?? [];
  const [draft, setDraft] = useState('');
  const [amountText, setAmountText] = useState('10000');
  const [yearsText, setYearsText] = useState('10');
  const [drip, setDrip] = useState(true);
  const [taxText, setTaxText] = useState(String(DIVIDEND_WITHHOLDING * 100));
  const inputs = useQueries({
    queries: tickers.map((tk) => ({
      queryKey: ['compare-inputs', tk],
      queryFn: () => loadCompareInputs(tk),
    })),
  });
  const sq = useQuery({
    queryKey: ['summary', tickers],
    queryFn: () => loadSummaries(tickers),
    enabled: tickers.length > 0,
  });
  const loaded = tickers.flatMap((tk, i) => {
    const q = inputs[i];
    return q?.isSuccess ? [{ tk, d: q.data as CompareInputs }] : [];
  });
  const failed = tickers.flatMap((tk, i) =>
    inputs[i]?.isError ? [`${tk}: ${inputs[i]?.error?.message ?? ''}`] : [],
  );
  const loading = inputs.some((q) => q.isPending) || (tickers.length > 0 && sq.isPending);
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
  const result = dividendCompare({
    amount: num(amountText),
    years: num(yearsText),
    drip,
    taxPct: num(taxText),
    tickers: loaded.map(({ tk, d }) => {
      const last = d.bars.at(-1) ?? null;
      return {
        ticker: tk,
        price: last?.close ?? null,
        priceDate: last?.date ?? null,
        // The trailing 1-year price change: the nightly summary's when current, else the same from the bars.
        priceChange1y: figuresOf(tk, sq.data?.[tk], d.bars, null).row.return_1y,
        bars: d.bars,
        dividends: d.dividends,
        splits: d.splits,
      };
    }),
  });
  const set = (next: string[]) => setChosen(next);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const tk = draft.trim().toUpperCase();
    if (!TICKER.test(tk) || tickers.includes(tk)) return;
    set([...tickers, tk]);
    setDraft('');
  };
  const draftOk = draft.trim() === '' || TICKER.test(draft.trim().toUpperCase());
  return (
    <Card id="portfolio-compare-h" title={c.title} aside={<Info>{c.info}</Info>}>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink2">{c.tickersLabel}</span>
        {payers.isPending && chosen === null ? (
          <p className="text-sm text-ink3">{p.loading}</p>
        ) : tickers.length === 0 ? (
          <p className="text-sm text-ink3">{c.noTickers}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label={c.tickersLabel}>
            {tickers.map((tk) => (
              <li
                key={tk}
                className="flex items-center gap-1 rounded-full border border-line bg-elev ps-3 text-sm font-semibold text-ink"
              >
                {tk}
                <button
                  type="button"
                  onClick={() => set(tickers.filter((y) => y !== tk))}
                  aria-label={c.remove(tk)}
                  className="grid size-11 place-items-center rounded-full text-ink2"
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {chosen === null && payers.isSuccess && <Source>{c.defaultNote}</Source>}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink3">
            {c.addLabel}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoCapitalize="characters"
              aria-invalid={!draftOk}
              className={`${field} w-32 uppercase`}
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
          >
            {c.add}
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {c.amount}
          <input
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className={`${field} w-36`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {c.years}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            step={1}
            value={yearsText}
            onChange={(e) => setYearsText(e.target.value)}
            className={`${field} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink3">
          {c.withholding}
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="any"
            value={taxText}
            onChange={(e) => setTaxText(e.target.value)}
            className={`${field} w-24`}
          />
        </label>
        <button
          type="button"
          aria-pressed={drip}
          onClick={() => setDrip(!drip)}
          className={`min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold ${
            drip ? 'bg-accent text-accent-ink' : 'bg-surface text-ink'
          }`}
        >
          {drip ? c.dripOn : c.dripOff}
        </button>
      </div>
      <Source>{c.withholdingNote(String(DIVIDEND_WITHHOLDING * 100))}</Source>
      {failed.map((f) => (
        <p key={f} className="text-sm text-down">
          {f}
        </p>
      ))}
      {!result.ok ? (
        <p className="text-sm text-warn">{c.invalid(result.reason)}</p>
      ) : loading ? (
        <p className="text-sm text-ink3">{p.loading}</p>
      ) : result.rows.length === 0 ? null : (
        <>
          <p className="text-sm text-ink2">
            {c.method}: {result.method}
          </p>
          <MiniTable
            label={c.tableAria}
            head={[
              p.table.ticker,
              c.price,
              c.change1y,
              c.yield,
              c.payouts,
              c.startShares,
              c.endShares,
              c.annualIncome,
              c.dividendsNet,
              c.endBalance,
              c.projection,
              c.hist1y,
              c.hist3y,
            ]}
            rows={result.rows.map((r) => {
              const pr = r.projection;
              const na = (
                <span className="text-xs whitespace-normal text-ink3">
                  {r.projectionUnavailable ?? p.na}
                </span>
              );
              return [
                <TickerLink key="t" ticker={r.ticker} />,
                r.price === null ? p.na : `${price2(r.price)} (${shortDate(r.priceDate)})`,
                <Pct key="c" v={r.priceChange1yPct} />,
                r.yieldPct === null
                  ? p.na
                  : `${toFixedHalfUp(r.yieldPct, 2)}%${r.yieldPayments === null ? '' : ` (${c.payments(r.yieldPayments)})`}`,
                r.payoutsPerYear === null ? c.none : String(r.payoutsPerYear),
                pr ? shares(pr.startShares) : na,
                pr ? shares(pr.endShares) : na,
                pr ? usd(pr.annualIncomeNet) : na,
                pr ? usd(pr.dividendsNet) : na,
                pr ? usd(pr.endBalance) : na,
                pr ? (
                  <span key="p" className="flex flex-col items-end gap-0.5">
                    <Pct v={pr.totalReturnPct} />
                    <span className="text-[11px] text-ink3">
                      {c.priceBeside(
                        r.priceChange1yPct === null ? p.na : arrow(r.priceChange1yPct),
                      )}
                    </span>
                  </span>
                ) : (
                  na
                ),
                <Historical key="h1" h={r.historical.y1} />,
                <Historical key="h3" h={r.historical.y3} />,
              ];
            })}
          />
          <Source>
            {c.source(
              result.amount.toLocaleString('en-US'),
              result.years,
              result.drip,
              toFixedHalfUp(result.taxPct, 1),
              HISTORICAL_SESSIONS.y1,
              HISTORICAL_SESSIONS.y3,
            )}
          </Source>
          <Source>
            {c.formula(Object.values(result.formulaVersions).join(', '))}
            {loaded[0]?.d.bars.at(-1) && ` ${c.asOf(longDate(loaded[0].d.bars.at(-1)?.date))}`}
          </Source>
          <button
            type="button"
            onClick={() =>
              saveText(
                `marsad-dividend-compare-${x.today}.csv`,
                toCsv(result.rows, result.method, result.taxPct),
              )
            }
            className="min-h-11 self-start rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink"
          >
            {c.csv}
          </button>
        </>
      )}
    </Card>
  );
}
