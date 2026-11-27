import { useQuery } from '@tanstack/react-query';
import { etfOverlap, lookThrough, toFixedHalfUp } from '@marsad/core';
import { ErrorText } from '../ui';
import { loadEtfHoldings } from '../../lib/etf';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import { dayMonthYear } from '../../lib/dates';
import { TickerLink } from '../QuickLook';
import { t } from '../../strings';

const x = t.journal.etf;
const pct = (v: number) => `${toFixedHalfUp(v * 100, 1)}%`;
/** Fund colours after light blue (direct), in the design's order. */
const VIA_FILL = ['bg-fill', 'bg-muted', 'bg-faint'];
const box = 'flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4';

/** What you hold directly and through SPY, QQQ and DIA, and how much those funds overlap, as the design draws it. */
export function EtfLookThrough({
  holdings,
  bars,
}: {
  holdings: StoredHolding[];
  bars: BarsByTicker;
}) {
  const q = useQuery({ queryKey: ['etf-holdings'], queryFn: loadEtfHoldings });
  if (q.isError) return <ErrorText message={q.error.message} />;
  if (!q.data) return null;
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
  const top = Math.max(0, ...rows.map((r) => r.total));
  const width = (usd: number) => `${top > 0 ? toFixedHalfUp((usd / top) * 100, 2) : 0}%`;
  const share = (usd: number) => pct(portfolio > 0 ? usd / portfolio : 0);
  const dateOf = new Map(reports.map((r) => [r.etf, r.reportDate]));
  const pairs = reports.flatMap((a, i) =>
    reports.slice(i + 1).map((b) => ({
      a: a.etf,
      b: b.etf,
      overlap: etfOverlap(byEtf[a.etf] ?? [], byEtf[b.etf] ?? []),
      dates: [...new Set([a.reportDate, b.reportDate])].map(dayMonthYear),
    })),
  );
  return (
    <section aria-labelledby="etf-look-through" className="flex flex-col gap-3">
      <h2 id="etf-look-through" className="sr-only">
        {x.title}
      </h2>
      {reports.length === 0 ? (
        <p className={`${box} text-muted`}>{x.none}</p>
      ) : (
        <>
          <div className={box}>
            <h3 className="flex flex-col gap-0.5">
              <span className="font-semibold">{x.ownTitle}</span>
              {heldFunds.length > 0 && (
                <span className="text-[0.8125rem] font-normal text-muted">
                  {x.ownSub(x.join(heldFunds))}
                </span>
              )}
            </h3>
            {heldFunds.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">{x.noFunds}</p>
            ) : rows.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">{x.noShared(heldFunds.join(', '))}</p>
            ) : (
              <>
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
                    return (
                      <li
                        key={r.ticker}
                        aria-label={x.rowAria(r.ticker, share(r.total), parts)}
                        className="grid min-h-8 grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-2.5"
                      >
                        <TickerLink ticker={r.ticker} />
                        <span
                          aria-hidden="true"
                          className="flex h-3.5 overflow-hidden rounded-sm bg-faint/10"
                        >
                          <span className="bg-up" style={{ width: width(r.direct) }} />
                          {via.map((v, i) => (
                            <span
                              key={v.etf}
                              className={VIA_FILL[i % VIA_FILL.length]}
                              style={{ width: width(v.usd) }}
                            />
                          ))}
                        </span>
                        <span className="text-end font-semibold tabular-nums">
                          {share(r.total)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[0.8125rem] text-muted">
                  {[
                    x.legendDirect,
                    ...heldFunds.map((f, i) =>
                      x.legendVia(x.colours[i % x.colours.length] ?? '', f),
                    ),
                  ].join(' · ')}
                </p>
              </>
            )}
          </div>
          <div className={`${box} gap-3!`}>
            <h3 className="font-semibold">{x.overlapTitle}</h3>
            <ul className="flex flex-col gap-3">
              {pairs.map((p) => (
                <li
                  key={`${p.a}-${p.b}`}
                  aria-label={x.pairAria(p.a, p.b, pct(p.overlap))}
                  className="flex flex-col gap-1.5"
                >
                  <span className="flex justify-between">
                    <span className="font-bold">{x.pair(p.a, p.b)}</span>
                    <span
                      className={`font-bold tabular-nums ${p.overlap >= 0.5 ? 'text-warn' : 'text-up'}`}
                    >
                      {pct(p.overlap)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="h-2.5 rounded-[5px] bg-faint/16">
                    <span
                      className={`block h-full rounded-[5px] ${p.overlap >= 0.5 ? 'bg-warn' : 'bg-up'}`}
                      style={{ width: pct(Math.min(1, p.overlap)) }}
                    />
                  </span>
                  <span className="text-[0.8125rem] text-muted">{x.nport(x.join(p.dates))}</span>
                </li>
              ))}
              {pairs.length === 0 &&
                reports.map((r) => (
                  <li key={r.etf} className="text-[0.8125rem] text-muted">
                    {r.etf}: {x.nport(dayMonthYear(dateOf.get(r.etf) ?? r.reportDate))}
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
      <p className="text-xs text-muted">{x.footnote}</p>
    </section>
  );
}
