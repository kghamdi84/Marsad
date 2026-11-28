import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import {
  currentRun,
  dualClock,
  etDate,
  etWallToUtc,
  exitSignals,
  tickerSummary,
  toFixedHalfUp,
  type EconEvent,
  type ExitSignal,
} from '@marsad/core';
import { cardClass } from '../Card';
import { zoneName } from '../Clock';
import { useDisplay } from '../../lib/display';
import { dayMonth, weekdayDayMonth } from '../../lib/dates';
import type { BarsByTicker, StoredHolding } from '../../lib/journal';
import {
  REGIME_DAYS,
  type CalendarData,
  type CockpitData,
  type StoredBrief,
  type StoredFiling,
  type WatchData,
} from '../../lib/watch';
import { Aside, pctText, u, v, w } from './shared';

const k = v.cockpit;

/** What a query hands the cockpit: the data, or why there is none. */
export interface Loaded<T> {
  data: T | undefined;
  error: Error | null;
}

function Tile({
  to,
  params,
  label,
  value,
  valueClass = 'text-ink',
  sub,
  sub2,
  sub2Class = 'text-ink3',
}: {
  /** Where the tile leads; without it the tile is plain text (nothing to open yet). */
  to?: '/regime' | '/study/$ticker' | '/alerts' | '/journal' | '/portfolio';
  params?: { ticker: string };
  label: string;
  value: ReactNode;
  valueClass?: string;
  sub?: ReactNode;
  sub2?: ReactNode;
  sub2Class?: string;
}) {
  // One compact row per topic (squeezed v2 Watch): the label, then the answer and its context on one line.
  const body = (
    <>
      <span className="pt-0.5 text-xs text-ink3">{label}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-[15px] leading-snug font-semibold ${valueClass}`}>{value}</span>
        {(sub || sub2) && (
          <span className="text-xs text-ink3">
            {sub && <span className="text-ink2">{sub}</span>}
            {sub && sub2 && ' \u00B7 '}
            {sub2 && <span className={sub2Class}>{sub2}</span>}
          </span>
        )}
      </span>
    </>
  );
  const cls =
    'grid min-h-11 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 rounded-lg px-2 py-2 text-start text-ink';
  if (!to) return <div className={cls}>{body}</div>;
  return (
    <Link to={to} {...(params ? { params } : {})} className={`${cls} hover:bg-elev`}>
      {body}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Regime

function RegimeTile({ q }: { q: Loaded<CockpitData> }) {
  const days = q.data?.regime ?? [];
  const run = currentRun(days);
  const last = days.at(-1);
  if (!q.data || !run || !last)
    return (
      <Tile
        to="/regime"
        label={k.regime}
        value={q.error || q.data ? k.notYet : v.news.loading}
        valueClass="text-ink3"
        sub={q.error ? q.error.message : q.data ? k.regimeNone : undefined}
      />
    );
  const b = q.data.breadth;
  return (
    <Tile
      to="/regime"
      label={k.regime}
      value={k.labels[run.label] ?? run.label}
      sub={k.run(
        run.sessions,
        run.sessions === days.length && days.length >= REGIME_DAYS,
        last.ruleVersion,
        dayMonth(last.date),
      )}
      sub2={[
        last.vix === null ? k.vixNone : k.vix(toFixedHalfUp(last.vix, 2)),
        b?.pctAbove50 == null ? k.breadthNone : k.breadth(toFixedHalfUp(b.pctAbove50, 0)),
      ].join(' · ')}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Last session movers (watchlist bars)

function MoversTile({ data }: { data: WatchData | undefined }) {
  const rows = (data?.tickers ?? []).flatMap((tk) => {
    const s = tickerSummary(data?.bars[tk] ?? []);
    return s && s.change1d !== null ? [{ tk, date: s.date, change: s.change1d }] : [];
  });
  const newest = rows.reduce((d, r) => (r.date > d ? r.date : d), '');
  const fresh = rows.filter((r) => r.date === newest).sort((a, b) => b.change - a.change);
  const top = fresh.slice(0, 2);
  // The biggest loser, shown only when it fell (a third riser would read as a loser).
  const tail = fresh.length > 2 ? fresh.at(-1) : undefined;
  const worst = tail && tail.change < 0 ? tail : undefined;
  const lead = top[0];
  if (!lead)
    return (
      <Tile
        label={k.movers}
        value={data ? k.notYet : v.news.loading}
        valueClass="text-ink3"
        sub={data ? k.moversNone : undefined}
      />
    );
  const one = (r: { tk: string; change: number }) => `${r.tk} ${pctText(r.change, 2)}`;
  return (
    <Tile
      to="/study/$ticker"
      params={{ ticker: lead.tk }}
      label={k.movers}
      value={top.map(one).join(' · ')}
      valueClass={lead.change > 0 ? 'text-up' : lead.change < 0 ? 'text-down' : 'text-ink'}
      sub={k.closeOf(weekdayDayMonth(newest))}
      sub2={worst ? one(worst) : undefined}
      sub2Class="text-down"
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Today: the session, today's releases and Tier 1 filings since the last close

function instantOf(e: EconEvent): Date {
  const [h, m] = e.timeEt.split(':').map(Number) as [number, number];
  return etWallToUtc(e.date, h, m);
}

/** Filings accepted after the last session's 16:00 ET close (a filing without an acceptance time: a later date). */
export function filingsSinceClose(filings: readonly StoredFiling[], lastSession: string) {
  const close = etWallToUtc(lastSession, 16, 0).getTime();
  return filings.filter((f) =>
    f.acceptedAt ? Date.parse(f.acceptedAt) > close : f.filingDate > lastSession,
  );
}

function TodayTile({
  now,
  cal,
  cockpit,
  filings,
  lastSession,
}: {
  now: Date;
  cal: Loaded<CalendarData>;
  cockpit: Loaded<CockpitData>;
  filings: Loaded<StoredFiling[]>;
  lastSession: string | undefined;
}) {
  const { zone } = useDisplay();
  const city = zoneName(zone);
  const today = etDate(now);
  const holiday = cockpit.data?.holidays.find((h) => h.date === today);
  const events = (cal.data?.econ?.events ?? [])
    .filter((e) => e.date === today)
    .map((e) => ({ e, at: instantOf(e) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = events.find((x) => x.at.getTime() > now.getTime()) ?? events.at(-1);
  let value: string;
  const sub: string[] = [];
  if (holiday && holiday.status === 'closed') value = k.closed(holiday.name);
  else if (holiday && holiday.closeAt) {
    const c = dualClock(new Date(holiday.closeAt), zone);
    value = k.earlyClose(c.et);
    sub.push(k.local(c.local, city));
  } else if (next) {
    const c = dualClock(next.at, zone);
    value = k.event(next.e.name, c.et);
    sub.push(k.local(c.local, city));
  } else value = cal.data?.econ ? k.noEvents : cal.data || cal.error ? k.calendarNone : '';
  if (holiday && next) sub.push(k.event(next.e.name, dualClock(next.at, zone).et));
  else if (events.length > 1) sub.push(k.moreToday(events.length - 1));
  let sub2: string | undefined;
  let tone = 'text-ink3';
  if (filings.error) sub2 = k.filingsUnavailable;
  else if (filings.data && lastSession) {
    const since = filingsSinceClose(filings.data, lastSession);
    const f = since[0];
    sub2 = k.filings(
      since.length,
      f
        ? `${f.tickers[0] ?? f.cik} ${f.form}${f.items.length ? ` ${f.items.join(', ')}` : ''}`
        : '',
    );
    if (since.length > 0) tone = 'text-warn';
  }
  return (
    <Tile
      to="/alerts"
      label={k.today}
      value={value || v.news.loading}
      valueClass={value ? 'text-ink' : 'text-ink3'}
      sub={sub.join(' · ') || undefined}
      sub2={sub2}
      sub2Class={tone}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Exit rules: every open holding checked at the newest close

const KIND_ORDER: ExitSignal['kind'][] = ['stop', 'trend-break', 'time-stop', 'target'];

function signalText(h: StoredHolding, s: ExitSignal): string {
  if (s.kind === 'trend-break')
    return k.signal['trend-break'](h.ticker, String(h.trendBreak?.period ?? ''));
  return k.signal[s.kind](h.ticker);
}

function ExitsTile({ q }: { q: Loaded<{ holdings: StoredHolding[]; bars: BarsByTicker }> }) {
  if (!q.data)
    return (
      <Tile
        to="/portfolio"
        label={k.exits}
        value={q.error ? k.holdingsUnavailable : v.news.loading}
        valueClass="text-ink3"
        sub={q.error?.message}
      />
    );
  const { holdings, bars } = q.data;
  if (holdings.length === 0)
    return (
      <Tile
        to="/portfolio"
        label={k.exits}
        value={k.exitsNone}
        valueClass="text-ink3"
        sub={k.exitsNoneSub}
      />
    );
  // Each flagged holding with its most urgent signal: stop, trend break, time stop, then target.
  const flagged = holdings
    .flatMap((h) => {
      const top = exitSignals(h, bars[h.ticker] ?? []).sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
      )[0];
      return top ? [{ h, top }] : [];
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.top.kind) - KIND_ORDER.indexOf(b.top.kind));
  const day = holdings
    .map((h) => bars[h.ticker]?.at(-1)?.date ?? '')
    .reduce((d, x) => (x > d ? x : d), '');
  const first = flagged[0];
  if (!first)
    return (
      <Tile
        to="/portfolio"
        label={k.exits}
        value={k.allInside}
        valueClass="text-up"
        sub={day ? k.checked(holdings.length, dayMonth(day)) : undefined}
      />
    );
  const { top } = first;
  const second = flagged[1];
  return (
    <Tile
      to="/portfolio"
      label={k.exits}
      value={signalText(first.h, top)}
      valueClass={
        top.kind === 'target' ? 'text-up' : top.kind === 'time-stop' ? 'text-warn' : 'text-down'
      }
      sub={
        second
          ? signalText(second.h, second.top)
          : day
            ? k.checked(holdings.length, dayMonth(day))
            : undefined
      }
      sub2={k.others(holdings.length - flagged.length)}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The brief

function emailState(email: string) {
  return email === 'sent' ? u.emailed : email.startsWith('failed') ? u.emailFailed : u.notEmailed;
}

function briefKind(b: StoredBrief) {
  // Stored titles read "Pre-market brief, Wed 2026-11-25"; the design writes "Pre-market brief · Wed 25 Nov".
  return b.title.split(',')[0] ?? b.title;
}

export function BriefLine({ briefs }: { briefs: StoredBrief[] | undefined }) {
  const { zone } = useDisplay();
  if (!briefs) return null;
  const b = briefs[0];
  if (!b) return <Aside>{k.noBrief}</Aside>;
  const c = dualClock(new Date(b.createdAt), zone);
  return (
    <Aside>
      {k.briefLine(
        briefKind(b),
        c.et,
        c.local,
        zoneName(zone),
        emailState(b.delivery['email'] ?? 'not-configured'),
      )}
    </Aside>
  );
}

function Brief({ briefs }: { briefs: StoredBrief[] }) {
  const b = briefs[0];
  if (!b)
    return (
      <section
        aria-label={w.brief.title}
        className="flex flex-col gap-1 rounded-[10px] border border-dashed border-line p-3.5"
      >
        <h3 className="text-sm font-semibold text-ink">{u.noBriefTitle}</h3>
        <p className="text-sm text-ink3">{w.brief.none}</p>
        <p className="text-sm text-ink3">{u.membersNote}</p>
      </section>
    );
  const created = new Date(b.createdAt);
  const email = b.delivery['email'] ?? 'not-configured';
  const chip =
    email === 'sent'
      ? 'bg-up-soft text-up'
      : email.startsWith('failed')
        ? 'bg-down-soft text-down'
        : 'bg-sub text-ink2';
  return (
    <section aria-labelledby="brief-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="brief-h" className="text-sm font-semibold text-ink">
          <span className="sr-only">{w.brief.title}: </span>
          {u.briefTitle(briefKind(b), weekdayDayMonth(b.forDate))}
        </h3>
        <span
          className={`flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${chip}`}
        >
          {email === 'sent' && <Check aria-hidden="true" size={12} strokeWidth={2.4} />}
          {emailState(email)}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5">
        {b.sections.map((sec) => (
          <div
            key={sec.heading}
            className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-line bg-elev p-3"
          >
            <h4 className="text-xs font-normal text-ink3">{sec.heading}</h4>
            <ul className="flex flex-col gap-1 text-sm leading-snug text-ink2">
              {sec.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink3">
        {w.brief.made(`${etDate(created)} ${dualClock(created).label}`)} {w.brief.email(email)}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function Cockpit({
  now,
  briefs,
  watch,
  cal,
  cockpit,
  filings,
  holdings,
}: {
  now: Date;
  briefs: Loaded<StoredBrief[]>;
  watch: WatchData | undefined;
  cal: Loaded<CalendarData>;
  cockpit: Loaded<CockpitData>;
  filings: Loaded<StoredFiling[]>;
  holdings: Loaded<{ holdings: StoredHolding[]; bars: BarsByTicker }>;
}) {
  const lastSession = watch ? tickerSummary(watch.bars['SPY'] ?? [])?.date : undefined;
  return (
    <section aria-labelledby="cockpit-h" className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cockpit-h" className="text-base font-semibold text-ink">
          {k.title}
        </h2>
        <BriefLine briefs={briefs.data} />
      </div>
      <div className="-mx-2 grid grid-cols-1 gap-x-6 tablet:grid-cols-2">
        <RegimeTile q={cockpit} />
        <MoversTile data={watch} />
        <TodayTile
          now={now}
          cal={cal}
          cockpit={cockpit}
          filings={filings}
          lastSession={lastSession}
        />
        <ExitsTile q={holdings} />
      </div>
      {briefs.data && (
        <details className="group rounded-lg border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-link select-none">
            {k.fullBrief}
          </summary>
          <div className="border-t border-line p-3">
            <Brief briefs={briefs.data} />
          </div>
        </details>
      )}
      {briefs.error && (
        <p role="alert" className="text-sm text-down">
          {briefs.error.message}
        </p>
      )}
    </section>
  );
}
