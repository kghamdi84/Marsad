import { useQuery } from '@tanstack/react-query';
import { heldWeekReturn, toFixedHalfUp, weekReturn } from '@marsad/core';
import { ErrorText } from '../ui';
import { cardClass } from '../Card';
import { loadHoldings, loadHoldingsSpan, loadWeeklyReview } from '../../lib/journal';
import { dayMonth, weekdayDayMonth } from '../../lib/dates';
import { StatTile, signedPct1 } from './shared';
import { t } from '../../strings';

const x = t.journal.review;

/**
 * The newest stored weekly review (template text, AI off) with the design's four tiles. Trades closed, plan followed
 * and the mean result come from the stored inputs; SPY's week is close to close from the stored bars; the
 * portfolio's week (held-week-1) values the holdings held over the same two closes, leaving out buys and sales
 * inside the week, and says so when a close is missing.
 */
export function WeeklyReview() {
  const q = useQuery({ queryKey: ['weekly-review'], queryFn: loadWeeklyReview });
  const h = useQuery({ queryKey: ['holdings'], queryFn: loadHoldings });
  const spy = q.data && h.data ? weekReturn(h.data.bars['SPY'] ?? [], q.data.forDate) : null;
  const span = useQuery({
    queryKey: ['holdings-span', spy?.from, spy?.to],
    queryFn: () => loadHoldingsSpan(spy?.from ?? '', spy?.to ?? ''),
    enabled: spy !== null,
  });
  const held =
    spy && span.data ? heldWeekReturn(span.data.holdings, span.data.bars, spy.from, spy.to) : null;
  const portfolioTile: [string, string, string, string] =
    held && held.pct !== null
      ? [
          x.tilePortfolio,
          `${held.pct >= 0 ? '▲ ' : '▼ '}${signedPct1(held.pct)}`,
          x.portfolioNote(held.held, held.leftOut),
          held.pct >= 0 ? 'text-up' : 'text-down',
        ]
      : [
          x.tilePortfolio,
          x.portfolioNa,
          held === null
            ? spy
              ? x.portfolioNone
              : x.spyNaNote
            : x.portfolioMissing(held.missing.join(', ')),
          'text-ink3',
        ];
  const tiles = q.data?.tiles;
  const meanR = tiles?.meanR ?? null;
  // Lines are numbered across the sections, 01 onwards.
  const firstLine = (q.data?.sections ?? []).map((_s, i, all) =>
    all.slice(0, i).reduce((a, s) => a + s.lines.length, 0),
  );
  return (
    <section aria-labelledby="weekly-review" className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="weekly-review" className="text-base font-semibold text-ink">
          {q.data ? q.data.title : x.title}
        </h2>
        {q.data && (
          <span className="text-xs text-ink3">{x.written(weekdayDayMonth(q.data.forDate))}</span>
        )}
      </div>
      {q.isError && <ErrorText message={q.error.message} />}
      {q.data === null && <p className="text-sm text-ink3">{x.none}</p>}
      {q.data && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2.5">
          {(
            [
              portfolioTile,
              spy
                ? [
                    x.tileSpy,
                    `${spy.pct >= 0 ? '▲ ' : '▼ '}${signedPct1(spy.pct)}`,
                    x.spyNote(dayMonth(spy.from), dayMonth(spy.to)),
                    spy.pct >= 0 ? 'text-up' : 'text-down',
                  ]
                : [x.tileSpy, x.spyNa, x.spyNaNote, 'text-ink3'],
              ...(tiles
                ? [
                    [x.tileClosed, String(tiles.closed), '', 'text-ink'],
                    [x.tileFollowed, x.tileOf(tiles.followed, tiles.touched), '', 'text-ink'],
                    [
                      x.tileMeanR,
                      meanR === null
                        ? t.regime.noData
                        : `${meanR >= 0 ? '▲ +' : '▼ −'}${toFixedHalfUp(Math.abs(meanR), 2)}R`,
                      '',
                      meanR === null ? 'text-ink3' : meanR >= 0 ? 'text-up' : 'text-down',
                    ],
                  ]
                : []),
            ] as [string, string, string, string][]
          ).map(([k, v, sub, tone]) => (
            <StatTile key={k} label={k} value={v} sub={sub || undefined} tone={tone} />
          ))}
        </div>
      )}
      {q.data?.sections.map((sec, si) => (
        <div key={sec.heading} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-normal text-ink3">{sec.heading}</h3>
          {sec.lines.map((l, li) => (
            <p key={l} className="flex gap-2.5 text-[13px] leading-[1.55] text-ink2">
              <span aria-hidden="true" className="font-semibold text-ink3">
                {String((firstLine[si] ?? 0) + li + 1).padStart(2, '0')}
              </span>
              {l}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
