import { describe, expect, it } from 'vitest';
import releaseDates from '../../../fixtures/fred/fred-release-dates-2026-11-25.json';
import releases from '../../../fixtures/fred/fred-releases-2026-11-25.json';
import { HttpClient, TokenBucket, type Clock, type FetchLike } from './http.js';
import { fetchReleaseDates } from './adapters/fred.js';
import {
  FOMC_MEETINGS,
  TRACKED_RELEASES,
  economicCalendar,
  estimateNextEarnings,
  type ReleaseDate,
} from './econ-calendar.js';

const NOW = new Date('2026-11-25T23:30:00Z');
function setup(reply: (url: string) => { status: number; body: unknown }) {
  const urls: string[] = [];
  const clock: Clock = { now: () => NOW.getTime(), sleep: () => Promise.resolve() };
  const fetch: FetchLike = (url) => {
    urls.push(url);
    const r = reply(url);
    return Promise.resolve({
      status: r.status,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  };
  return {
    http: new HttpClient({ fetch, clock, bucket: new TokenBucket(100, 100, clock), maxRetries: 0 }),
    urls,
  };
}
const cfg = { apiKey: 'fred-key', now: () => NOW };
const page1 = releaseDates.body as { count: number; release_dates: unknown[] };

describe('fetchReleaseDates (real first page, 1,000 of 1,040 dates)', () => {
  it('pages by offset until the count is reached, and asks for scheduled dates too', async () => {
    const { http, urls } = setup((url) =>
      url.includes('offset=1000')
        ? { status: 200, body: { count: 1040, release_dates: page1.release_dates.slice(0, 40) } }
        : { status: 200, body: page1 },
    );
    const r = await fetchReleaseDates(http, cfg, '2026-11-25', '2027-02-03');
    expect(r.ok && r.data.value).toHaveLength(1040);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('include_release_dates_with_no_data=true');
    expect(urls[1]).toContain('offset=1000');
  });

  it('rejects a body without release_dates and never shows the key', async () => {
    const { http } = setup(() => ({ status: 500, body: {} }));
    const r = await fetchReleaseDates(http, cfg, '2026-11-25', '2027-02-03');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('fred-key');
  });
});

describe('tracked releases', () => {
  it('every tracked id carries the name FRED gives it (real release list, 2026-11-25)', () => {
    const names = new Map(
      (releases.body as { releases: { id: number; name: string }[] }).releases.map((r) => [
        r.id,
        r.name,
      ]),
    );
    for (const r of TRACKED_RELEASES) expect(names.get(r.id), r.name).toBe(r.fredName);
  });

  it('FOMC meetings are in order and two days long', () => {
    for (const [i, m] of FOMC_MEETINGS.entries()) {
      expect(Date.parse(m.end) - Date.parse(m.start)).toBe(86_400_000);
      if (i > 0) expect(m.start > (FOMC_MEETINGS[i - 1]?.end ?? '')).toBe(true);
    }
  });
});

describe('economicCalendar on the real release dates, 2026-11-25 to 2026-12-31 (listed by hand)', () => {
  const dates: ReleaseDate[] = (
    page1.release_dates as { release_id: number; release_name: string; date: string }[]
  ).map((d) => ({ releaseId: d.release_id, releaseName: d.release_name, date: d.date }));
  const events = economicCalendar(dates, '2026-11-25', '2026-12-31');

  it('lists every tracked release and the December FOMC statement', () => {
    const byDay = new Map<string, string[]>();
    for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e.name]);
    const sorted = (xs: string[] | undefined) => [...(xs ?? [])].sort();
    expect(sorted(byDay.get('2026-11-25'))).toEqual(
      ['GDP', 'Housing starts', 'Jobless claims', 'PCE and personal income'].sort(),
    );
    expect(byDay.get('2026-12-01')).toEqual(['JOLTS job openings']);
    expect(byDay.get('2026-12-04')).toEqual(['Jobs report']);
    expect(byDay.get('2026-12-09')).toEqual(['FOMC statement and projections']);
    expect(sorted(byDay.get('2026-12-10'))).toEqual(['CPI', 'Jobless claims']);
    expect(byDay.get('2026-12-15')).toEqual(['PPI']);
    expect(byDay.get('2026-12-16')).toEqual(['Retail sales']);
    expect(byDay.get('2026-12-18')).toEqual(['Consumer sentiment (University of Michigan)']);
    expect(sorted(byDay.get('2026-12-23'))).toEqual(
      ['GDP', 'Housing starts', 'PCE and personal income'].sort(),
    );
    expect(events).toHaveLength(19);
  });

  it('gives the usual time and impact, FOMC at 14:00 ET', () => {
    expect(events.find((e) => e.name === 'CPI')).toMatchObject({ timeEt: '08:30', impact: 'high' });
    expect(events.find((e) => e.kind === 'fomc')).toMatchObject({
      timeEt: '14:00',
      impact: 'high',
    });
    expect(events.find((e) => e.name === 'JOLTS job openings')).toMatchObject({ timeEt: '10:00' });
  });

  it('drops a release whose name no longer matches its id', () => {
    const renamed = [{ releaseId: 10, releaseName: 'Something else', date: '2026-12-10' }];
    expect(economicCalendar(renamed, '2026-12-01', '2026-12-31').map((e) => e.name)).toEqual([
      'FOMC statement and projections',
    ]);
  });
});

describe('estimateNextEarnings (hand-checked)', () => {
  const history = [
    '2025-02-26',
    '2025-05-28',
    '2025-08-27',
    '2025-11-19',
    '2026-02-25',
    '2026-05-27',
    '2026-08-26',
    '2026-11-17',
  ];

  it('uses the release that followed last year’s counterpart, 52 weeks on', () => {
    // Latest 2026-11-17; its counterpart 2025-11-19 (52 weeks before is 2025-11-18); next was 2026-02-25.
    expect(estimateNextEarnings(history, '2026-11-25')).toEqual({
      date: '2027-02-24',
      from: '2027-02-17',
      to: '2027-03-03',
      basis: 'same-quarter-last-year',
      lastRelease: '2026-11-17',
      overdue: false,
    });
  });

  it('falls back to 13 weeks after the latest without a year of history', () => {
    expect(estimateNextEarnings(['2026-08-26', '2026-11-17'], '2026-11-25')).toMatchObject({
      date: '2027-02-16',
      basis: 'quarterly-cadence',
    });
  });

  it('marks an estimate more than a week past as overdue', () => {
    // Latest 2026-05-27: counterpart 2025-05-28, next 2025-08-27, so expected 2026-08-26; by 2026-11-25 overdue.
    expect(estimateNextEarnings(history.slice(0, 6), '2026-11-25')).toMatchObject({
      date: '2026-08-26',
      overdue: true,
    });
  });

  it('ignores duplicates and order, and returns null with no history', () => {
    expect(estimateNextEarnings([...history].reverse().concat(history), '2026-11-25')?.date).toBe(
      '2027-02-24',
    );
    expect(estimateNextEarnings([], '2026-11-25')).toBeNull();
  });
});
