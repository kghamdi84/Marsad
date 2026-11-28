import { breadthOn, type TickerSeries } from '@marsad/core';

export interface MemberBreadth {
  date: string;
  members: number;
  /** Members with 200 stored sessions on this date (the denominator). */
  n200: number;
  above200: number;
  n50: number;
  above50: number;
}

/**
 * The breadth-1 measures for a fixed member list (for example SPY's N-PORT holdings, the S&P 500), computed by the
 * same `breadthOn` that builds Marsad universe breadth. Used only for a spot check against published index breadth
 * (checklist 3.3), so the comparison is like for like: same members, same rule, same stored closes.
 */
export function memberBreadth(
  dates: readonly string[],
  series: ReadonlyMap<string, TickerSeries>,
  members: readonly string[],
  on: readonly string[],
): MemberBreadth[] {
  const present = members.filter((m) => series.has(m));
  return on.flatMap((d) => {
    const i = dates.indexOf(d);
    if (i < 0) return [];
    const b = breadthOn(dates, series, present, i);
    return [
      {
        date: d,
        members: present.length,
        n200: b.n200,
        above200: b.above200,
        n50: b.n50,
        above50: b.above50,
      },
    ];
  });
}
