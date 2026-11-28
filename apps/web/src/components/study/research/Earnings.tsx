import { useMemo } from 'react';
import {
  EPS_HISTORY_VERSION,
  adjustedAmount,
  buildEarningsHistory,
  epsYearOnYear,
  etDate,
  pointInTime,
  preferConcepts,
  quarterlyValues,
  summarizeFinancials,
  type DailyBar,
  type EarningsEstimate,
  type EarningsFiling,
  type FinancialFact,
  type SplitEvent,
  type StoredDividend,
  type TauricCalendar,
  type TauricThesis,
} from '@marsad/core';
import { Num } from '../../ui/kit';
import { dayMonthYear } from '../../../lib/dates';
import type { Part } from '../../../lib/research';
import { BarChart } from './charts';
import {
  Fold,
  R,
  Signed,
  SourceLine,
  Tile,
  money,
  reasonText,
  td,
  tdEnd,
  th,
  thEnd,
} from './shared';

interface Dated {
  date: string | null;
  kind: 'catalyst' | 'earnings' | 'tauric-earnings' | 'dividend';
  text: string;
}

const secFolder = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/`;

export function EarningsView({
  cik,
  bars,
  splits,
  facts,
  filings,
  estimate,
  thesis,
  calendar,
  dividends,
  onOpenEarnings,
}: {
  cik: string | undefined;
  bars: readonly DailyBar[];
  splits: readonly SplitEvent[];
  facts: readonly FinancialFact[] | null;
  filings: readonly EarningsFiling[] | null;
  estimate: EarningsEstimate | null | undefined;
  thesis: Part<TauricThesis>;
  calendar: Part<TauricCalendar>;
  dividends: readonly StoredDividend[] | null;
  onOpenEarnings: () => void;
}) {
  const x = R.earnings;
  const today = etDate(new Date());
  const eps = useMemo(() => {
    if (!facts) return null;
    const q = quarterlyValues(
      preferConcepts(pointInTime(facts, today), ['EarningsPerShareDiluted'], 'USD/shares'),
    );
    return epsYearOnYear(q.map((p) => ({ end: p.end, value: p.value, derived: p.derived, filed: p.filed })));
  }, [facts, today]);
  const history = useMemo(
    () =>
      facts && filings
        ? buildEarningsHistory({
            quarters: summarizeFinancials(facts, today).quarters,
            filings,
            bars,
            splits,
          })
        : null,
    [facts, filings, bars, splits, today],
  );
  const cal = calendar.ok ? calendar.value : null;
  const events: Dated[] = useMemo(() => {
    const out: Dated[] = [];
    if (thesis.ok)
      for (const c of thesis.value.catalysts)
        out.push({ date: c.date, kind: 'catalyst', text: c.text });
    if (estimate) out.push({ date: estimate.date, kind: 'earnings', text: x.estimateEvent });
    if (cal?.earnings?.earnings_date)
      out.push({ date: cal.earnings.earnings_date, kind: 'tauric-earnings', text: x.tauricEvent });
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
    for (const d of dividends ?? [])
      if (d.exDividendDate >= from)
        out.push({
          date: d.exDividendDate,
          kind: 'dividend',
          text: x.dividendEvent(money(adjustedAmount(d), 4), d.payDate ? dayMonthYear(d.payDate) : R.na),
        });
    return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  }, [thesis, estimate, cal, dividends, today, x]);
  const latestQ = eps?.at(-1);
  const rows = eps ? [...eps].slice(-8).reverse() : [];
  const moves = history ? [...history.rows].reverse().filter((r) => r.release) : [];
  const estimateReason = !calendar.ok
    ? reasonText(calendar.reason)
    : cal?.earnings === null
      ? reasonText(cal?.field_states['earnings']?.reason ?? 'not_published')
      : null;

  return (
    <>
      <Tile id="rs-events" title={x.eventsTitle}>
        {events.length === 0 ? (
          <p className="text-sm text-ink3">{x.noEvents}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm text-ink2">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <Num className={`w-24 flex-none ${e.date && e.date >= today ? 'font-semibold text-ink' : 'text-ink3'}`}>
                  {e.date ? dayMonthYear(e.date) : x.undated}
                </Num>
                <span>
                  <span className="text-xs text-ink3">{x.kinds[e.kind]}</span> {e.text}
                </span>
              </li>
            ))}
          </ul>
        )}
        <SourceLine>{x.eventsSource}</SourceLine>
      </Tile>

      <Tile id="rs-next" title={x.nextTitle}>
        {estimate === undefined ? (
          <p className="text-sm text-ink3">{R.loading}</p>
        ) : estimate === null ? (
          <p className="text-sm text-ink3">{x.noEstimate}</p>
        ) : (
          <p className="text-sm text-ink">
            <Num>
              {x.estimateLine(
                dayMonthYear(estimate.date),
                dayMonthYear(estimate.from),
                dayMonthYear(estimate.to),
              )}
            </Num>
            {estimate.overdue && <span className="block text-xs text-warn">{x.overdue}</span>}
          </p>
        )}
        <p className="text-sm text-ink2">
          <Num>{latestQ ? x.periodLine(dayMonthYear(latestQ.end)) : x.periodNone}</Num>
        </p>
        {cal?.earnings?.eps_estimate != null ? (
          <p className="text-sm text-ink">
            <Num>
              {x.consensusLine(
                money(cal.earnings.eps_estimate),
                cal.earnings.earnings_date ? dayMonthYear(cal.earnings.earnings_date) : R.na,
                calendar.ok && calendar.asOf ? dayMonthYear(calendar.asOf.slice(0, 10)) : R.na,
              )}
            </Num>
          </p>
        ) : (
          <p className="text-sm text-ink3">
            {x.noConsensus}
            {estimateReason ? ` (${estimateReason})` : ''}
          </p>
        )}
        <p className="text-sm text-ink3">{x.beatMiss}</p>
        <p className="text-sm text-ink3">{x.transcripts}</p>
      </Tile>

      <Tile id="rs-eps" title={x.epsTitle}>
        {!eps ? (
          <p className="text-sm text-ink3">{facts === null ? R.loading : x.noEps}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink3">{x.noEps}</p>
        ) : (
          <>
            <BarChart
              label={x.epsAria(rows.length)}
              groups={[...rows].reverse().map((r) => ({ label: r.end.slice(2, 7), values: [r.value] }))}
              series={[{ name: x.reported, className: 'text-link' }]}
              format={(v) => money(v)}
            />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">{x.epsTitle}</caption>
                <thead>
                  <tr>
                    <th className={th}>{x.cols.quarter}</th>
                    <th className={thEnd}>{x.cols.eps}</th>
                    <th className={thEnd}>{x.cols.lastYear}</th>
                    <th className={thEnd}>{x.cols.changeUsd}</th>
                    <th className={thEnd}>{x.cols.changePct}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.end}>
                      <td className={td}>
                        <Num>{dayMonthYear(r.end)}</Num>
                      </td>
                      <td className={tdEnd}>
                        {r.value === null ? R.na : money(r.value)}
                        {r.derived && <span className="ms-1 text-xs text-ink3">{x.derived}</span>}
                      </td>
                      <td className={tdEnd}>{r.prior?.value != null ? money(r.prior.value) : R.na}</td>
                      <td className={tdEnd}>{r.changeUsd === null ? R.na : money(r.changeUsd)}</td>
                      <td className={tdEnd}>{r.changePct === null ? R.na : <Signed pct={r.changePct} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink3">{x.derivedNote}</p>
          </>
        )}
        <SourceLine>{x.epsSource(EPS_HISTORY_VERSION)}</SourceLine>
      </Tile>

      <Tile id="rs-moves" title={x.movesTitle}>
        {!history ? (
          <p className="text-sm text-ink3">{R.loading}</p>
        ) : moves.length === 0 ? (
          <p className="text-sm text-ink3">{x.noMoves}</p>
        ) : (
          <Fold label={x.movesFold(moves.length)}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <caption className="sr-only">{x.movesTitle}</caption>
                <thead>
                  <tr>
                    <th className={th}>{x.cols.released}</th>
                    <th className={thEnd}>{x.cols.before}</th>
                    <th className={thEnd}>{x.cols.after}</th>
                    <th className={thEnd}>{x.cols.move}</th>
                    <th className={th}>{x.cols.release}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((r) => (
                    <tr key={r.release?.accession}>
                      <td className={td}>
                        <Num>{r.release ? dayMonthYear(r.release.date) : ''}</Num>
                      </td>
                      <td className={tdEnd}>
                        {r.move ? (
                          <Num>{`${money(r.move.baseClose)} (${dayMonthYear(r.move.baseDate)})`}</Num>
                        ) : (
                          R.na
                        )}
                      </td>
                      <td className={tdEnd}>
                        {r.move ? (
                          <Num>{`${money(r.move.reactionClose)} (${dayMonthYear(r.move.reactionDate)})`}</Num>
                        ) : (
                          R.na
                        )}
                      </td>
                      <td className={tdEnd}>{r.move ? <Signed pct={r.move.pct} /> : R.na}</td>
                      <td className={td}>
                        {cik && r.release ? (
                          <a
                            href={secFolder(cik, r.release.accession)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
                          >
                            {x.pressRelease}
                          </a>
                        ) : (
                          R.na
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        )}
        <button
          type="button"
          onClick={onOpenEarnings}
          className="inline-flex min-h-11 items-center self-start text-[13px] font-medium text-link underline-offset-4 hover:underline"
        >
          {x.openEarnings}
        </button>
        <SourceLine>{x.movesSource(history?.formulaVersion ?? R.na)}</SourceLine>
      </Tile>
    </>
  );
}
