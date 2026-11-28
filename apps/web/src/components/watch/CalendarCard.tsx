import { dualClock, etDate, etWallToUtc, type EconEvent } from '@marsad/core';
import { Card } from '../Card';
import { zoneName } from '../Clock';
import { TickerLink } from '../QuickLook';
import { Pill, type Tone } from '../ui/kit';
import { useDisplay } from '../../lib/display';
import { dayMonth, weekdayDayMonth } from '../../lib/dates';
import type { CalendarData } from '../../lib/watch';
import { t } from '../../strings';
import { Aside, u, v } from './shared';

const c = t.calendar;
const k = v.calendar;

function instantOf(e: EconEvent): Date {
  const [h, m] = e.timeEt.split(':').map(Number) as [number, number];
  return etWallToUtc(e.date, h, m);
}

const DAYS_AHEAD = 14;

const PILL_TONE: Record<string, Tone> = {
  high: 'crit',
  medium: 'warn',
  low: 'neutral',
  earn: 'up',
};

interface AgendaItem {
  key: string;
  date: string;
  /** Sort order within a day: minutes after midnight ET; estimates go last. */
  order: number;
  pill: 'high' | 'medium' | 'low' | 'earn';
  name: string;
  /** The ticker of an earnings item, shown as a quick-look button. */
  ticker?: string;
  source: string;
  when: string;
  /** Read out with the pill (the pill alone says HIGH). */
  extra: string | null;
  late: boolean;
  countdown: string | null;
}

/**
 * Economic events for the next 14 days and the watchlist's estimated earnings, by day, with ET and the second
 * time zone chosen in Settings.
 */
export function CalendarCard({
  data,
  now,
  days: ahead = DAYS_AHEAD,
}: {
  data: CalendarData;
  now: Date;
  /** How many days ahead to list: 14 on Watch, 30 on the Markets calendar. */
  days?: number;
}) {
  const { zone } = useDisplay();
  const city = zoneName(zone);
  const today = etDate(now);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + ahead * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const items: AgendaItem[] = [];
  for (const e of data.econ?.events ?? []) {
    if (e.date < today || e.date > last) continue;
    const at = instantOf(e);
    const clock = dualClock(at, zone);
    const ms = at.getTime() - now.getTime();
    items.push({
      key: `${e.date}-${e.name}`,
      date: e.date,
      order: Number(clock.et.slice(0, 2)) * 60 + Number(clock.et.slice(3, 5)),
      pill: e.impact,
      name: e.name,
      source: k.source(e.source),
      when: u.eventTime(clock.et, clock.local, city),
      extra: c.impact[e.impact] ?? null,
      late: false,
      countdown:
        e.date !== today
          ? null
          : ms <= 0
            ? c.released
            : c.countdownIn(Math.floor(ms / 3_600_000), Math.floor((ms % 3_600_000) / 60_000)),
    });
  }
  for (const e of data.earnings?.estimates ?? [])
    items.push({
      key: `earn-${e.ticker}`,
      date: e.date,
      order: 24 * 60,
      pill: 'earn',
      name: u.earningsName(e.ticker),
      ticker: e.ticker,
      source: `${k.source(k.earnSource)} · ${c.basis[e.basis] ?? e.basis}`,
      when: e.overdue ? c.overdue : u.earningsWhen(dayMonth(e.from), dayMonth(e.to)),
      extra: null,
      late: e.overdue,
      countdown: null,
    });
  items.sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
  const days = [...new Set(items.map((i) => i.date))];
  return (
    <Card id="calendar-h" title={k.title} aside={<Aside>{k.zones(city)}</Aside>}>
      {!data.econ && <p className="text-sm text-ink3">{c.none}</p>}
      {(data.earnings?.estimates ?? []).length === 0 && (
        <p className="text-sm text-ink3">{c.earningsNone}</p>
      )}
      {days.map((d) => (
        <div key={d} className="flex flex-col gap-2">
          <h3 className={`text-[13px] font-semibold ${d === today ? 'text-up' : 'text-ink3'}`}>
            {d === today ? c.todayHeading(weekdayDayMonth(d)) : weekdayDayMonth(d)}
          </h3>
          <ul className="flex flex-col gap-2">
            {items
              .filter((i) => i.date === d)
              .map((i) => (
                <li
                  key={i.key}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-[10px] border border-line bg-elev px-3 py-2.5"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      {i.pill === 'high' ? (
                        // Solid: the soft crit tint on an inner tile is below 4.5:1 at 11 px.
                        <span className="inline-flex items-center rounded-full bg-crit px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-canvas">
                          {k.pill[i.pill]}
                        </span>
                      ) : (
                        <Pill
                          tone={PILL_TONE[i.pill] ?? 'neutral'}
                          className="text-[11px] font-semibold"
                        >
                          {k.pill[i.pill]}
                        </Pill>
                      )}
                      <span className="text-sm font-medium text-ink">
                        {i.ticker ? (
                          <>
                            <TickerLink ticker={i.ticker} /> {u.earningsWord}
                          </>
                        ) : (
                          i.name
                        )}
                      </span>
                      {i.extra && <span className="sr-only">{i.extra}</span>}
                    </span>
                    <span className="text-xs text-ink3">{i.source}</span>
                  </span>
                  <span
                    className={`text-xs whitespace-nowrap tabular-nums ${i.late ? 'text-down' : 'text-ink2'}`}
                  >
                    {i.when}
                    {i.countdown && (
                      <>
                        {' '}
                        {'·'} {i.countdown}
                      </>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-ink3">{k.legend}</p>
      {data.econ && (
        <p className="text-xs text-ink3">
          {c.source(data.econ.fetchedAt.slice(0, 16).replace('T', ' ') + ' UTC')}
        </p>
      )}
    </Card>
  );
}
