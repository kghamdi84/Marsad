import { useState } from 'react';
import { Info } from '../Info';
import { Card, Details, ScrollX, Segmented } from '../Card';
import { td, th } from '../study/Panel';
import { HORIZONS, arrowPct, pct, toneClass, width } from './format';
import { monthYear } from '../../lib/dates';
import type { RegimeData, StoredEventStat } from '../../lib/regime';
import { t } from '../../strings';

const r = t.regime;
const u = r.ui;
const s = r.study;

/** Every stored condition, in the details table. */
const CONDITIONS = [
  'stress',
  'bear',
  'recovery',
  'bull-calm',
  'bull-correction',
  'vix-30',
  'vix-30-recession-not-high',
  'all-days',
];

type Sufficient = StoredEventStat & { median: number; q1: number; q3: number };

const ok = (x: StoredEventStat | undefined): x is Sufficient =>
  !!x && x.sufficient && x.median !== null && x.q1 !== null && x.q3 !== null;

/** event-study-2 stores a 90% bootstrap interval of the median; older rows fall back to the middle half. */
const band = (x: Sufficient) =>
  x.ciLow !== null && x.ciHigh !== null
    ? { lo: x.ciLow, hi: x.ciHigh, ci: true }
    : { lo: x.q1, hi: x.q3, ci: false };

/** Full condition names, for the details table. */
const fullName = (c: string) =>
  c === 'vix-30'
    ? s.vix30
    : c === 'vix-30-recession-not-high'
      ? s.proxy
      : c === 'all-days'
        ? s.allDays
        : (r.labels[c] ?? c);

/**
 * What the S&P did next: today's label, VIX 30+, Bear and all sessions; 21, 63 and 126 sessions; the median and
 * the 90% bootstrap interval bar, or a 30-tick bar under 30 cases.
 */
export function EventStudy({ data }: { data: RegimeData }) {
  const today = data.days.at(-1)?.label;
  const picks = [
    ...new Set([
      ...(today && CONDITIONS.includes(today) ? [today] : []),
      'vix-30',
      'bear',
      'all-days',
    ]),
  ];
  const [cond, setCond] = useState<string>(picks[0] ?? 'all-days');
  if (data.stats.length === 0)
    return (
      <Card id="study" title={s.title}>
        <p className="text-sm text-ink3">{s.none}</p>
      </Card>
    );
  const at = (c: string, h: number): StoredEventStat | undefined =>
    data.stats.find((x) => x.condition === c && x.horizon === h);
  const any = data.stats[0] as StoredEventStat;
  const short = (c: string) =>
    c === 'vix-30' ? u.condVix30 : c === 'all-days' ? u.condAll : (r.labels[c] ?? c);
  const rows = HORIZONS.map((h) => ({ h, x: at(cond, h) }));
  const hasCi = rows.some(({ x }) => ok(x) && x.ciLow !== null && x.ciHigh !== null);
  // A symmetric scale around zero, wide enough for every bar shown, in steps of 5 percentage points.
  const span = Math.max(
    0.05,
    ...rows.flatMap(({ x }) =>
      ok(x) ? [Math.abs(band(x).lo), Math.abs(band(x).hi), Math.abs(x.median)] : [],
    ),
  );
  const M = Math.ceil(span * 20) / 20;
  const pos = (v: number) => width((v + M) / (2 * M));
  return (
    <Card
      id="study"
      title={s.title}
      subtitle={(hasCi ? u.studySub90 : u.studySub)(monthYear(any.dataFrom))}
      aside={
        <Segmented
          label={s.colCondition}
          options={picks.map((c) => ({
            key: c,
            label: c === today ? u.today(short(c)) : short(c),
          }))}
          value={cond}
          onChange={setCond}
        />
      }
    >
      <ul className="flex flex-col gap-2.5">
        {rows.map(({ h, x }) => (
          <li
            key={h}
            className="flex flex-col gap-2 rounded-[10px] border border-line bg-elev px-3.5 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{u.horizonSessions(h)}</span>
              <span className="text-[13px] text-ink2">
                {u.median}{' '}
                <strong className={ok(x) ? toneClass(x.median) : 'text-ink3'}>
                  {ok(x) ? arrowPct(x.median) : u.notEnough}
                </strong>{' '}
                <span className="text-ink3">
                  {'· '}
                  {ok(x) ? (
                    <span>
                      {band(x).ci
                        ? u.interval90(pct(band(x).lo), pct(band(x).hi))
                        : u.middleHalf(pct(x.q1), pct(x.q3))}
                    </span>
                  ) : (
                    <span>{x ? u.insufficientOf(x.n) : r.noData}</span>
                  )}
                  {` · ${u.nEquals(x?.n ?? 0)}`}
                </span>
              </span>
            </div>
            {ok(x) ? (
              <div aria-hidden="true" className="relative h-3 rounded-md bg-sub">
                <span className="absolute inset-y-0 start-1/2 w-px bg-ink3" />
                <span
                  className="absolute top-0.5 h-2 rounded border border-up bg-up-soft"
                  style={{
                    insetInlineStart: pos(band(x).lo),
                    width: width((band(x).hi - band(x).lo) / (2 * M)),
                  }}
                />
                <span
                  className="absolute -top-0.5 h-4 w-1 -ms-0.5 rounded-sm bg-ink"
                  style={{ insetInlineStart: pos(x.median) }}
                />
              </div>
            ) : (
              x && (
                <span aria-hidden="true" className="flex gap-0.5">
                  {Array.from({ length: 30 }, (_, i) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded-[1px] ${i < x.n ? 'bg-ink3' : 'bg-sub'}`}
                    />
                  ))}
                </span>
              )
            )}
          </li>
        ))}
      </ul>
      <Info>
        <p>{s.note(any.dataFrom, any.dataTo)}</p>
        <p>{hasCi ? u.scaleNote90(M * 100) : u.scaleNote(M * 100)}</p>
      </Info>
      <Details>
        <ScrollX label={u.tables.study}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>{s.colCondition}</th>
                {HORIZONS.map((h) => (
                  <th key={h} className={th}>
                    {s.horizon(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONDITIONS.map((c) => (
                <tr key={c}>
                  <td className={td}>{fullName(c)}</td>
                  {HORIZONS.map((h) => {
                    const x = at(c, h);
                    return (
                      <td key={h} className={td}>
                        {!x
                          ? r.noData
                          : ok(x)
                            ? s.cell(pct(x.median), pct(x.q1), pct(x.q3), x.n)
                            : s.insufficient(x.n)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
        <p className="text-xs text-ink3">{s.depth}</p>
      </Details>
    </Card>
  );
}
