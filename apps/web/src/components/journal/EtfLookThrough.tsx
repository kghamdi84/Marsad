import { useQuery } from '@tanstack/react-query';
import { etfOverlap, lookThrough, toFixedHalfUp } from '@marsad/core';
import { ErrorText } from '../ui';
import { cardClass } from '../Card';
import { loadEtfHoldings } from '../../lib/etf';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import { dayMonthYear } from '../../lib/dates';
import { TickerLink } from '../QuickLook';
import { CardHead, lineRowClass } from './shared';
import { t } from '../../strings';

const x = t.journal.etf;
const pct = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;

/**
 * What you hold directly and through SPY, QQQ and DIA (SEC N-PORT, formula etf-2). Shared by the look-through card
 * and the position cards' rules line; undefined while loading.
 */
export function useLookThrough(holdings: StoredHolding[], bars: BarsByTicker) {
  const q = useQuery({ queryKey: ['etf-holdings'], queryFn: loadEtfHoldings });
  if (!q.data) return { q, data: undefined };
  const { reports, holdings: byEtf } = q.data;
  const weights = new Map<string, Map<string, number>>();
  for (const r of reports) {
    const m = new Map<string, number>();
    for (const h of byEtf[r.etf] ?? [])
      if (h.ticker) m.set(h.ticker, (m.get(h.ticker) ?? 0) + h.weight);
    weights.set(r.etf, m);
  }
  const positions = holdings.flatMap((h) => {
    const last = (bars[h.ticker] ?? []).at(-1);
    return last ? [{ ticker: h.ticker, value: h.shares * last.close }] : [];
  });
  const portfolio = positions.reduce((a, p) => a + p.value, 0);
  const heldFunds = [...new Set(positions.map((p) => p.ticker).filter((tk) => weights.has(tk)))];
  const rows = lookThrough(positions, weights);
  return { q, data: { reports, byEtf, portfolio, heldFunds, rows } };
}

/** The look-through and the overlap of the funds, as the design's "ETF look-through (SEC N-PORT)" card. */
export function EtfLookThrough({
  holdings,
  bars,
}: {
  holdings: StoredHolding[];
  bars: BarsByTicker;
}) {
  const { q, data } = useLookThrough(holdings, bars);
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!data) return null;
  const { reports, byEtf, portfolio, heldFunds, rows } = data;
  const share = (usd: number) => pct(portfolio > 0 ? usd / portfolio : 0);
  const dates = [...new Set(reports.map((r) => r.reportDate))].map(dayMonthYear);
  const pairs = reports.flatMap((a, i) =>
    reports.slice(i + 1).map((b) => ({
      a: a.etf,
      b: b.etf,
      overlap: etfOverlap(byEtf[a.etf] ?? [], byEtf[b.etf] ?? []),
      dates: [...new Set([a.reportDate, b.reportDate])].map(dayMonthYear),
    })),
  );
  return (
    <section aria-labelledby="etf-look-through" className={cardClass}>
      <CardHead
        id="etf-look-through"
        title={x.title}
        aside={
          reports.length > 0 && (
            <span className="text-xs text-ink3">
              {x.aside(reports.map((r) => r.etf).join(', '), x.join(dates))}
            </span>
          )
        }
      />
      {reports.length === 0 ? (
        <p className="text-sm text-ink3">{x.none}</p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[13px] font-semibold text-ink">{x.ownTitle}</h3>
            {heldFunds.length > 0 && (
              <span className="text-xs text-ink3">{x.ownSub(x.join(heldFunds))}</span>
            )}
          </div>
          {heldFunds.length === 0 ? (
            <p className="text-sm text-ink3">{x.noFunds}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink3">{x.noShared(heldFunds.join(', '))}</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((r) => {
                const via = heldFunds.map((f) => ({
                  etf: f,
                  usd: r.viaEtfs.find((v) => v.etf === f)?.usd ?? 0,
                }));
                const parts = [
                  x.direct(share(r.direct)),
                  ...via.map((v) => x.via(v.etf, share(v.usd))),
                ].join(', ');
                const note =
                  r.direct > 0
                    ? x.note([
                        x.directCap(share(r.direct)),
                        ...via.filter((v) => v.usd > 0).map((v) => x.via(v.etf, share(v.usd))),
                      ])
                    : x.indirectOnly;
                return (
                  <li
                    key={r.ticker}
                    aria-label={x.rowAria(r.ticker, share(r.total), parts)}
                    className={lineRowClass}
                  >
                    <span className="text-sm">
                      <TickerLink ticker={r.ticker} />
                    </span>
                    <span className="text-end text-sm font-semibold text-ink tabular-nums">
                      {share(r.total)}
                    </span>
                    <span className="col-span-2 text-xs text-ink3">{note}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-0.5 pt-1">
            <h3 className="text-[13px] font-semibold text-ink">{x.overlapTitle}</h3>
          </div>
          <ul className="flex flex-col">
            {pairs.map((p) => (
              <li
                key={`${p.a}-${p.b}`}
                aria-label={x.pairAria(p.a, p.b, pct(p.overlap))}
                className={lineRowClass}
              >
                <span className="text-sm text-ink2">{x.pair(p.a, p.b)}</span>
                <span
                  className={`text-end text-sm font-semibold tabular-nums ${p.overlap >= 0.5 ? 'text-warn' : 'text-ink'}`}
                >
                  {pct(p.overlap)}
                </span>
                <span className="col-span-2 text-xs text-ink3">{x.nport(x.join(p.dates))}</span>
              </li>
            ))}
            {pairs.length === 0 &&
              reports.map((r) => (
                <li key={r.etf} className={`${lineRowClass} text-xs text-ink3`}>
                  <span className="col-span-2">
                    {r.etf}: {x.nport(dayMonthYear(r.reportDate))}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
      <p className="text-xs text-ink3">{x.footnote}</p>
    </section>
  );
}
