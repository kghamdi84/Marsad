/**
 * Economic and earnings calendars (ADR 0013, `calendar-1`). FOMC meetings from the Federal Reserve's published
 * calendar; US data releases from FRED's release dates with usual release times; next earnings for each watchlist
 * company estimated from its own SEC results filings (8-K item 2.02), always labelled as an estimate. Pure.
 */

export const CALENDAR_VERSION = 'calendar-1';

/**
 * FOMC meetings, from https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (read 2026-11-25). The
 * statement comes at 14:00 ET on the last day; `projections` marks a Summary of Economic Projections.
 */
export const FOMC_MEETINGS: readonly { start: string; end: string; projections: boolean }[] = [
  { start: '2026-01-27', end: '2026-01-28', projections: false },
  { start: '2026-03-17', end: '2026-03-18', projections: true },
  { start: '2026-04-28', end: '2026-04-29', projections: false },
  { start: '2026-06-16', end: '2026-06-17', projections: true },
  { start: '2026-07-28', end: '2026-07-29', projections: false },
  { start: '2026-09-15', end: '2026-09-16', projections: true },
  { start: '2026-10-27', end: '2026-10-28', projections: false },
  { start: '2026-12-08', end: '2026-12-09', projections: true },
  { start: '2027-01-26', end: '2027-01-27', projections: false },
  { start: '2027-03-16', end: '2027-03-17', projections: false },
  { start: '2027-04-27', end: '2027-04-28', projections: false },
  { start: '2027-06-08', end: '2027-06-09', projections: false },
  { start: '2027-07-27', end: '2027-07-28', projections: false },
  { start: '2027-09-14', end: '2027-09-15', projections: false },
  { start: '2027-10-26', end: '2027-10-27', projections: false },
  { start: '2027-11-16', end: '2027-11-17', projections: false },
];

export type Impact = 'high' | 'medium' | 'low';

export interface TrackedRelease {
  /** FRED release id. */
  id: number;
  /** FRED's release name, as the release-dates endpoint returns it. */
  fredName: string;
  /** Short display name. */
  name: string;
  impact: Impact;
  /** Usual release time, Eastern; FRED gives dates only. */
  timeEt: string;
}

/** The US releases Marsad shows, with their usual times (each agency's published schedule). */
export const TRACKED_RELEASES: readonly TrackedRelease[] = [
  { id: 10, fredName: 'Consumer Price Index', name: 'CPI', impact: 'high', timeEt: '08:30' },
  {
    id: 50,
    fredName: 'Employment Situation',
    name: 'Jobs report',
    impact: 'high',
    timeEt: '08:30',
  },
  { id: 53, fredName: 'Gross Domestic Product', name: 'GDP', impact: 'high', timeEt: '08:30' },
  {
    id: 54,
    fredName: 'Personal Income and Outlays',
    name: 'PCE and personal income',
    impact: 'high',
    timeEt: '08:30',
  },
  { id: 46, fredName: 'Producer Price Index', name: 'PPI', impact: 'medium', timeEt: '08:30' },
  {
    id: 9,
    fredName: 'Advance Monthly Sales for Retail and Food Services',
    name: 'Retail sales',
    impact: 'medium',
    timeEt: '08:30',
  },
  {
    id: 180,
    fredName: 'Unemployment Insurance Weekly Claims Report',
    name: 'Jobless claims',
    impact: 'medium',
    timeEt: '08:30',
  },
  {
    id: 192,
    fredName: 'Job Openings and Labor Turnover Survey',
    name: 'JOLTS job openings',
    impact: 'medium',
    timeEt: '10:00',
  },
  {
    id: 91,
    fredName: 'Surveys of Consumers',
    name: 'Consumer sentiment (University of Michigan)',
    impact: 'low',
    timeEt: '10:00',
  },
  {
    id: 27,
    fredName: 'New Residential Construction',
    name: 'Housing starts',
    impact: 'low',
    timeEt: '08:30',
  },
];

export interface ReleaseDate {
  releaseId: number;
  releaseName: string;
  date: string;
}

export interface EconEvent {
  date: string;
  timeEt: string;
  name: string;
  impact: Impact;
  kind: 'release' | 'fomc';
  source: string;
}

/**
 * The calendar between two dates (inclusive), oldest first: tracked FRED releases plus FOMC statements. A release
 * is matched by id and by name, so a renumbered release is dropped rather than mislabelled.
 */
export function economicCalendar(
  dates: readonly ReleaseDate[],
  from: string,
  to: string,
): EconEvent[] {
  const byId = new Map(TRACKED_RELEASES.map((r) => [r.id, r]));
  const out: EconEvent[] = [];
  const seen = new Set<string>();
  for (const d of dates) {
    const r = byId.get(d.releaseId);
    if (!r || r.fredName !== d.releaseName || d.date < from || d.date > to) continue;
    const key = `${r.id}:${d.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: d.date,
      timeEt: r.timeEt,
      name: r.name,
      impact: r.impact,
      kind: 'release',
      source: `FRED release ${r.id}`,
    });
  }
  for (const m of FOMC_MEETINGS)
    if (m.end >= from && m.end <= to)
      out.push({
        date: m.end,
        timeEt: '14:00',
        name: m.projections ? 'FOMC statement and projections' : 'FOMC statement',
        impact: 'high',
        kind: 'fomc',
        source: 'Federal Reserve FOMC calendar',
      });
  return out.sort((a, b) =>
    a.date === b.date ? a.timeEt.localeCompare(b.timeEt) : a.date.localeCompare(b.date),
  );
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface EarningsEstimate {
  /** The estimated day; a range of a week either side. */
  date: string;
  from: string;
  to: string;
  basis: 'same-quarter-last-year' | 'quarterly-cadence';
  /** The last results filing seen. */
  lastRelease: string;
  /** True when the estimate is more than a week past and no newer filing exists. */
  overdue: boolean;
}

/**
 * The next results release, estimated from past results filings (8-K item 2.02 dates). Companies tend to report the
 * same quarter on the same weekday a year later, so the release that followed last year's counterpart of the latest
 * one, plus 52 weeks, is the estimate. Without that history, 13 weeks after the latest. Never a confirmed date.
 */
export function estimateNextEarnings(
  releaseDates: readonly string[],
  today: string,
): EarningsEstimate | null {
  const r = [...new Set(releaseDates)].sort();
  const last = r.at(-1);
  if (!last) return null;
  const year = 364 * DAY;
  // Last year's counterpart of the latest release: within 3 weeks of 52 weeks before it.
  const counterpart = r.find((d) => Math.abs(t(d) - (t(last) - year)) <= 21 * DAY);
  const after = counterpart ? r.find((d) => d > counterpart && d < last) : undefined;
  const basis = after ? 'same-quarter-last-year' : 'quarterly-cadence';
  const est = after ? t(after) + year : t(last) + 91 * DAY;
  return {
    date: iso(est),
    from: iso(est - 7 * DAY),
    to: iso(est + 7 * DAY),
    basis,
    lastRelease: last,
    overdue: est + 7 * DAY < t(today),
  };
}
