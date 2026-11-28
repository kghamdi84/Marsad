import { useQuery } from '@tanstack/react-query';
import {
  CHECK_RULES,
  comingUp,
  mergeDividends,
  toFixedHalfUp,
  weeklyMoves,
  type ReviewRow,
} from '@marsad/core';
import { Card, Segmented, useRemembered } from '../Card';
import { Info } from '../Info';
import { TickerLink } from '../QuickLook';
import { Pill } from '../ui/kit';
import { loadHoldingAlerts, tauricDividends } from '../../lib/portfolio';
import {
  LimitsList,
  Source,
  checkOf,
  useLimits,
  ViewState,
  arrowPct,
  longDate,
  p,
  pct1,
  price2,
  shortDate,
  tone,
  usd,
  usePortfolio,
  type Portfolio,
} from './shared';

const r = p.review;
const SUB = ['exits', 'coming', 'moves'] as const;
type Sub = (typeof SUB)[number];

/** One lot against its own exit plan: what is met or missing, then the numbers, each labelled. */
function ReviewItem({ row }: { row: ReviewRow }) {
  const state = !row.hasRules ? (
    <Pill tone="down">{r.missing}</Pill>
  ) : row.signals.length > 0 ? (
    <Pill tone="warn">{r.met(row.signals.length)}</Pill>
  ) : (
    <Pill tone="neutral">{r.noneMet}</Pill>
  );
  const sizer =
    row.sizer === null
      ? r.sizerNone
      : 'error' in row.sizer
        ? r.sizerError(row.sizer.error)
        : r.sizer(row.sizer.shares, row.shares, row.sizer.capped);
  return (
    <li className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <TickerLink ticker={row.ticker} className="text-base font-semibold" />
          <span className="text-xs text-ink3 tabular-nums">
            {r.lot(
              row.shares,
              row.price === null ? p.na : price2(row.price),
              shortDate(row.priceDate),
            )}
          </span>
        </span>
        {state}
      </div>
      {row.signals.map((s) => (
        <p key={s.kind} className="text-sm text-ink">
          {s.detail}
        </p>
      ))}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-x-3 gap-y-1.5 text-sm">
        {(
          [
            [
              r.stopDistance,
              row.stop === null
                ? r.noStop
                : row.stopGap === null
                  ? p.na
                  : `${pct1(row.stopGap)} ${r.toStop(price2(row.stop))}`,
            ],
            [r.atrs, row.stopAtrs === null ? p.na : r.atrValue(toFixedHalfUp(row.stopAtrs, 1))],
            [r.atRisk, row.riskUsd === null ? r.unbounded : usd(row.riskUsd)],
            [r.vsCap, row.sizeVsCap === null ? p.na : r.capValue(pct1(row.sizeVsCap))],
            [r.sessions, String(row.sessions)],
            [
              r.earnings,
              row.nextEarnings
                ? `${shortDate(row.nextEarnings.date)}${row.nextEarnings.estimated ? ` ${p.table.estimated}` : ''}`
                : r.noEarnings,
            ],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-xs text-ink3">{k}</dt>
            <dd className="font-semibold text-ink tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink2">{sizer}</p>
    </li>
  );
}

function Exits({ x }: { x: Portfolio }) {
  const limits = useLimits();
  if (!limits) return <p className="text-sm text-ink3">{p.loading}</p>;
  const { review: rev, check } = checkOf(x, limits, null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-elev p-3">
        <span className="text-xs text-ink3">{r.openRisk}</span>
        <span className="text-lg font-semibold text-ink tabular-nums">
          {rev.openRiskPct === null ? p.na : pct1(rev.openRiskPct)}
          {rev.noStop.length > 0 && (
            <span className="ms-2 text-sm font-medium text-down">
              {r.riskUnknown(rev.noStop.length)}
            </span>
          )}
        </span>
        <span className="text-xs text-ink2">
          {r.openRiskSub(usd(rev.openRisk), usd(rev.equity))}
          {rev.noStop.length > 0 && ` ${r.openRiskNoStop(rev.noStop.join(', '))}`}
        </span>
      </div>
      <LimitsList check={check} limits={limits} />
      <ul className="flex flex-col gap-2.5" aria-label={r.rowsLabel}>
        {rev.rows.map((row) => (
          <ReviewItem key={row.id} row={row} />
        ))}
      </ul>
      <Source>{r.source(pct1(CHECK_RULES.sizerRisk), pct1(CHECK_RULES.sizerCap))}</Source>
    </div>
  );
}

function Coming({ x }: { x: Portfolio }) {
  const research = x.data?.research ?? {};
  const c = comingUp({
    today: x.today,
    earnings: x.tickers.flatMap((tk) => {
      const out: {
        ticker: string;
        date: string;
        eps: number | null;
        source: 'tauric-calendar' | 'marsad-estimate';
      }[] = [];
      const cal = research[tk]?.calendar?.earnings;
      if (cal?.earnings_date)
        out.push({
          ticker: tk,
          date: cal.earnings_date,
          eps: cal.eps_estimate,
          source: 'tauric-calendar',
        });
      const est = x.calendar?.earnings?.estimates.find((e) => e.ticker === tk);
      if (est) out.push({ ticker: tk, date: est.date, eps: null, source: 'marsad-estimate' });
      return out;
    }),
    dividends: mergeDividends(x.data?.dividends ?? [], tauricDividends(research)),
    catalysts: x.tickers.flatMap((tk) =>
      (research[tk]?.thesis?.catalysts ?? []).map((k) => ({
        ticker: tk,
        date: k.date,
        text: k.text,
        timing: k.timing_stated ?? k.timing_status,
      })),
    ),
  });
  return (
    <div className="flex flex-col gap-2">
      {c.events.length === 0 ? (
        <p className="text-sm text-ink3">{r.coming.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {c.events.map((e) => (
            <li
              key={`${e.date}-${e.ticker}-${e.kind}-${e.text ?? ''}`}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-[10px] border border-line bg-elev px-3 py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  <Pill tone="neutral">{r.coming.kind[e.kind]}</Pill>
                  <TickerLink ticker={e.ticker} />
                  {e.kind === 'earnings' &&
                    (e.amount === null ? r.coming.noEps : r.coming.eps(toFixedHalfUp(e.amount, 2)))}
                  {e.kind === 'ex-dividend' &&
                    e.amount !== null &&
                    r.coming.amount(price2(e.amount))}
                  {e.kind === 'catalyst' && <span>{e.text}</span>}
                </span>
                <span className="text-xs text-ink3">
                  {r.coming.source[e.source]}
                  {e.estimated && ` · ${r.coming.estimated}`}
                  {e.timing && ` · ${r.coming.timing(e.timing)}`}
                </span>
              </span>
              <span className="text-xs whitespace-nowrap text-ink2 tabular-nums">
                {longDate(e.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Source>
        {r.coming.window(longDate(x.today), longDate(c.to))}
        {c.undatedCatalysts > 0 && ` ${r.coming.undated(c.undatedCatalysts)}`}
      </Source>
    </div>
  );
}

function Moves({ x }: { x: Portfolio }) {
  const since = new Date(Date.parse(`${x.today}T00:00:00Z`) - 7 * 86_400_000).toISOString();
  const aq = useQuery({
    queryKey: ['holding-alerts', x.tickers, since],
    queryFn: () => loadHoldingAlerts(x.tickers, since),
  });
  const moves = weeklyMoves(x.tickers, x.bars);
  return (
    <div className="flex flex-col gap-3">
      {moves.length === 0 ? (
        <p className="text-sm text-ink3">{r.moves.none(pct1(CHECK_RULES.weeklyMove))}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {moves.map((m) => (
            <li
              key={m.ticker}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-1.5 text-sm last:border-b-0"
            >
              <TickerLink ticker={m.ticker} />
              <span className="text-xs text-ink3 tabular-nums">
                {r.moves.span(
                  price2(m.fromClose),
                  shortDate(m.from),
                  price2(m.toClose),
                  shortDate(m.to),
                )}
              </span>
              <span className={`font-semibold tabular-nums ${tone(m.change)}`}>
                {arrowPct(m.change)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-[13px] font-semibold text-ink3">{r.moves.alertsTitle}</h3>
      {aq.isError && <p className="text-sm text-down">{aq.error.message}</p>}
      {aq.data &&
        (aq.data.length === 0 ? (
          <p className="text-sm text-ink3">{r.moves.noAlerts}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {aq.data.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="flex gap-2">
                  <TickerLink ticker={a.ticker} />
                  <span className="text-ink">{a.headline}</span>
                </span>
                <span className="text-xs text-ink3 tabular-nums">{longDate(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ))}
      <Source>{r.moves.source(pct1(CHECK_RULES.weeklyMove))}</Source>
    </div>
  );
}

/**
 * Review (ADR 0048, the Portfolio page's first view): total open risk to the stops, the book against Marsad's
 * default limits, then each lot against its own exit plan, lots without exit rules first. Coming up (next 8 weeks)
 * and Weekly moves sit one tap away. Facts and rules only: Marsad never says what to do with a position.
 */
export function ReviewView() {
  const x = usePortfolio();
  const [sub, setSub] = useRemembered<Sub>('marsad.portfolio.review', SUB, 'exits');
  return (
    <Card id="portfolio-review-h" title={r.title} aside={<Info>{r.info}</Info>}>
      <ViewState x={x}>
        <Segmented
          label={r.subLabel}
          options={SUB.map((k) => ({ key: k, label: r.sub[k] }))}
          value={sub}
          onChange={setSub}
        />
        {sub === 'exits' && <Exits x={x} />}
        {sub === 'coming' && <Coming x={x} />}
        {sub === 'moves' && <Moves x={x} />}
      </ViewState>
    </Card>
  );
}
