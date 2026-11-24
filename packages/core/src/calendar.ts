/**
 * US equity market calendar and session state.
 *
 * Holidays and early closes come from the vendor's market-status endpoint
 * (Massive `/v1/marketstatus/upcoming`); weekends are closed by rule. All wall-clock
 * arithmetic goes through the IANA time zone database via Intl, so US daylight
 * saving changes need no hand-written offsets.
 *
 * Session hours (US Eastern): pre-market 04:00 to 09:30, regular 09:30 to 16:00,
 * after-hours 16:00 to 20:00. On early-close days the regular session ends at the
 * vendor's close time (13:00) and after-hours ends at 17:00. The 17:00 end is an
 * assumption based on exchange extended-hours rules, not vendor data.
 */
import { US_EASTERN } from './time.js';

export type SessionState = 'pre-market' | 'regular' | 'after-hours' | 'closed';

export interface UpcomingRow {
  date: string; // YYYY-MM-DD, US Eastern
  exchange: string;
  name: string;
  status: 'closed' | 'early-close' | string;
  open?: string; // UTC ISO, early-close rows only
  close?: string; // UTC ISO, early-close rows only
}

export interface SpecialDay {
  date: string;
  name: string;
  kind: 'closed' | 'early-close';
  open: Date | null;
  close: Date | null;
}

export interface MarketCalendar {
  exchange: string;
  specialDays: ReadonlyMap<string, SpecialDay>;
  /** Last date the vendor data covers. Dates after it are assumed regular days and flagged. */
  coveredThrough: string | null;
}

export interface SessionInfo {
  state: SessionState;
  date: string; // US Eastern calendar date of `now`
  tradingDay: boolean;
  earlyClose: boolean;
  holidayName: string | null;
  preMarketStart: Date | null;
  regularOpen: Date | null;
  regularClose: Date | null;
  afterHoursEnd: Date | null;
  /** False when `date` is after the vendor data's last covered date, so holidays may be missing. */
  calendarCovered: boolean;
}

const PRE_START = { h: 4, m: 0 };
const REG_OPEN = { h: 9, m: 30 };
const REG_CLOSE = { h: 16, m: 0 };
const AH_END = { h: 20, m: 0 };
const AH_END_EARLY = { h: 17, m: 0 };

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: US_EASTERN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function etParts(instant: Date): EtParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out['year'] ?? Number.NaN,
    month: out['month'] ?? Number.NaN,
    day: out['day'] ?? Number.NaN,
    hour: out['hour'] ?? Number.NaN,
    minute: out['minute'] ?? Number.NaN,
    second: out['second'] ?? Number.NaN,
  };
}

/** The US Eastern calendar date (YYYY-MM-DD) of an instant. */
export function etDate(instant: Date): string {
  const p = etParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function offsetMinutes(instant: Date): number {
  const p = etParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a US Eastern wall-clock time on a given ET date. */
export function etWallToUtc(
  date: string,
  hour: number,
  minute: number,
  second = 0,
  millisecond = 0,
): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Bad date: ${date}`);
  const guess = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    hour,
    minute,
    second,
    millisecond,
  );
  let t = guess - offsetMinutes(new Date(guess)) * 60000;
  // Re-check once: the offset at the corrected instant can differ across a DST change.
  t = guess - offsetMinutes(new Date(t)) * 60000;
  return new Date(t);
}

/** Day of week of an ET date: 0 = Sunday ... 6 = Saturday. */
function weekday(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1)).getUTCDay();
}

function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

/** Builds a calendar for one exchange from vendor `upcoming` rows. */
export function buildCalendar(rows: readonly UpcomingRow[], exchange = 'NYSE'): MarketCalendar {
  const specialDays = new Map<string, SpecialDay>();
  let coveredThrough: string | null = null;
  for (const r of rows) {
    if (r.exchange !== exchange) continue;
    if (r.status !== 'closed' && r.status !== 'early-close') continue;
    specialDays.set(r.date, {
      date: r.date,
      name: r.name,
      kind: r.status,
      open: r.open ? new Date(r.open) : null,
      close: r.close ? new Date(r.close) : null,
    });
    if (coveredThrough === null || r.date > coveredThrough) coveredThrough = r.date;
  }
  return { exchange, specialDays, coveredThrough };
}

export function isTradingDay(date: string, cal: MarketCalendar): boolean {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  return cal.specialDays.get(date)?.kind !== 'closed';
}

/** Session boundaries and state at an instant. */
export function sessionInfo(now: Date, cal: MarketCalendar): SessionInfo {
  const date = etDate(now);
  const special = cal.specialDays.get(date);
  const tradingDay = isTradingDay(date, cal);
  const calendarCovered = cal.coveredThrough !== null && date <= cal.coveredThrough;
  const base = {
    date,
    tradingDay,
    holidayName: special?.kind === 'closed' ? special.name : null,
    calendarCovered,
  };
  if (!tradingDay) {
    return {
      ...base,
      state: 'closed',
      earlyClose: false,
      preMarketStart: null,
      regularOpen: null,
      regularClose: null,
      afterHoursEnd: null,
    };
  }
  const earlyClose = special?.kind === 'early-close';
  const preMarketStart = etWallToUtc(date, PRE_START.h, PRE_START.m);
  const regularOpen = special?.open ?? etWallToUtc(date, REG_OPEN.h, REG_OPEN.m);
  const regularClose = earlyClose
    ? (special.close ?? etWallToUtc(date, 13, 0))
    : etWallToUtc(date, REG_CLOSE.h, REG_CLOSE.m);
  const end = earlyClose ? AH_END_EARLY : AH_END;
  const afterHoursEnd = etWallToUtc(date, end.h, end.m);
  const t = now.getTime();
  let state: SessionState = 'closed';
  if (t >= preMarketStart.getTime() && t < regularOpen.getTime()) state = 'pre-market';
  else if (t >= regularOpen.getTime() && t < regularClose.getTime()) state = 'regular';
  else if (t >= regularClose.getTime() && t < afterHoursEnd.getTime()) state = 'after-hours';
  return {
    ...base,
    state,
    earlyClose,
    preMarketStart,
    regularOpen,
    regularClose,
    afterHoursEnd,
  };
}

/** The most recent regular-session close at or before `now`, or null within a 14-day look-back. */
export function lastRegularClose(now: Date, cal: MarketCalendar): Date | null {
  let date = etDate(now);
  for (let i = 0; i < 14; i += 1) {
    if (isTradingDay(date, cal)) {
      // Evaluate the session on that date by asking for a time late in the day.
      const noon = etWallToUtc(date, 12, 0);
      const info = sessionInfo(noon, cal);
      if (info.regularClose && info.regularClose.getTime() <= now.getTime())
        return info.regularClose;
    }
    date = addDays(date, -1);
  }
  return null;
}

/** The ET date of the last completed regular session, or null. */
export function lastCompletedTradingDay(now: Date, cal: MarketCalendar): string | null {
  const close = lastRegularClose(now, cal);
  return close ? etDate(close) : null;
}

/** The next regular-session open strictly after `now`, or null within a 14-day look-ahead. */
export function nextRegularOpen(now: Date, cal: MarketCalendar): Date | null {
  let date = etDate(now);
  for (let i = 0; i < 14; i += 1) {
    if (isTradingDay(date, cal)) {
      const info = sessionInfo(etWallToUtc(date, 12, 0), cal);
      if (info.regularOpen && info.regularOpen.getTime() > now.getTime()) return info.regularOpen;
    }
    date = addDays(date, 1);
  }
  return null;
}
