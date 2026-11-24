import { describe, expect, it } from 'vitest';
import upcoming from '../../../fixtures/massive/market-status-upcoming.json';
import {
  buildCalendar,
  etDate,
  etWallToUtc,
  isTradingDay,
  lastCompletedTradingDay,
  lastRegularClose,
  nextRegularOpen,
  sessionInfo,
  type UpcomingRow,
} from './calendar.js';

const rows = upcoming.data as UpcomingRow[];
const cal = buildCalendar(rows, 'NYSE');
const at = (iso: string) => new Date(iso);

describe('etWallToUtc and etDate', () => {
  it('maps 09:30 ET to 14:30Z in winter and 13:30Z in summer', () => {
    expect(etWallToUtc('2026-11-24', 9, 30).toISOString()).toBe('2026-11-24T14:30:00.000Z');
    expect(etWallToUtc('2026-07-01', 9, 30).toISOString()).toBe('2026-07-01T13:30:00.000Z');
  });
  it('handles the weeks around both US clock changes', () => {
    // Spring forward 2026-03-08, fall back 2026-11-01.
    expect(etWallToUtc('2026-03-06', 9, 30).toISOString()).toBe('2026-03-06T14:30:00.000Z');
    expect(etWallToUtc('2026-03-09', 9, 30).toISOString()).toBe('2026-03-09T13:30:00.000Z');
    expect(etWallToUtc('2026-10-30', 9, 30).toISOString()).toBe('2026-10-30T13:30:00.000Z');
    expect(etWallToUtc('2026-11-02', 9, 30).toISOString()).toBe('2026-11-02T14:30:00.000Z');
  });
  it('uses the ET date, not the UTC date', () => {
    expect(etDate(at('2026-11-24T03:00:00Z'))).toBe('2026-11-23');
  });
});

describe('buildCalendar with recorded Massive data', () => {
  it('NYSE and Nasdaq agree on every special day in the recorded window', () => {
    const nasdaq = buildCalendar(rows, 'NASDAQ');
    expect([...nasdaq.specialDays.keys()].sort()).toEqual([...cal.specialDays.keys()].sort());
  });
  it('knows Thanksgiving is closed and the day after is an early close', () => {
    expect(isTradingDay('2026-11-26', cal)).toBe(false);
    expect(isTradingDay('2026-11-27', cal)).toBe(true);
    expect(cal.specialDays.get('2026-11-27')?.kind).toBe('early-close');
  });
  it('treats weekends as closed', () => {
    expect(isTradingDay('2026-11-28', cal)).toBe(false);
    expect(isTradingDay('2026-11-29', cal)).toBe(false);
  });
  it('records coverage through the last vendor date', () => {
    expect(cal.coveredThrough).toBe('2027-09-06');
  });
});

describe('sessionInfo', () => {
  it('walks through a normal winter day', () => {
    // Tuesday 2026-11-24, EST (UTC-5).
    expect(sessionInfo(at('2026-11-24T08:59:00Z'), cal).state).toBe('closed'); // 03:59 ET
    expect(sessionInfo(at('2026-11-24T09:00:00Z'), cal).state).toBe('pre-market'); // 04:00 ET
    expect(sessionInfo(at('2026-11-24T14:29:59Z'), cal).state).toBe('pre-market');
    expect(sessionInfo(at('2026-11-24T14:30:00Z'), cal).state).toBe('regular');
    expect(sessionInfo(at('2026-11-24T20:59:59Z'), cal).state).toBe('regular');
    expect(sessionInfo(at('2026-11-24T21:00:00Z'), cal).state).toBe('after-hours');
    expect(sessionInfo(at('2026-11-25T00:59:59Z'), cal).state).toBe('after-hours'); // 19:59 ET
    expect(sessionInfo(at('2026-11-25T01:00:00Z'), cal).state).toBe('closed'); // 20:00 ET
  });
  it('shifts by one UTC hour in summer', () => {
    expect(sessionInfo(at('2026-07-01T13:29:59Z'), cal).state).toBe('pre-market');
    expect(sessionInfo(at('2026-07-01T13:30:00Z'), cal).state).toBe('regular');
  });
  it('is closed on a holiday, with its name', () => {
    const info = sessionInfo(at('2026-11-26T15:00:00Z'), cal);
    expect(info.state).toBe('closed');
    expect(info.holidayName).toBe('Thanksgiving');
    expect(info.tradingDay).toBe(false);
  });
  it('applies the early close on the day after Thanksgiving', () => {
    expect(sessionInfo(at('2026-11-27T17:59:59Z'), cal).state).toBe('regular'); // 12:59 ET
    const info = sessionInfo(at('2026-11-27T18:00:00Z'), cal);
    expect(info.state).toBe('after-hours');
    expect(info.earlyClose).toBe(true);
    expect(info.regularClose?.toISOString()).toBe('2026-11-27T18:00:00.000Z');
    expect(sessionInfo(at('2026-11-27T22:00:00Z'), cal).state).toBe('closed'); // 17:00 ET
  });
  it('flags dates beyond vendor coverage', () => {
    expect(sessionInfo(at('2026-11-24T15:00:00Z'), cal).calendarCovered).toBe(true);
    expect(sessionInfo(at('2028-03-01T15:00:00Z'), cal).calendarCovered).toBe(false);
  });
});

describe('lastRegularClose, lastCompletedTradingDay, nextRegularOpen', () => {
  it('after the close it is the same day', () => {
    expect(lastRegularClose(at('2026-11-24T22:00:00Z'), cal)?.toISOString()).toBe(
      '2026-11-24T21:00:00.000Z',
    );
  });
  it('before the open it is the previous trading day', () => {
    expect(lastCompletedTradingDay(at('2026-11-24T12:00:00Z'), cal)).toBe('2026-11-23');
  });
  it('skips a holiday and a weekend', () => {
    // Monday 2026-11-30 morning: last close was the early close on Friday 2026-11-27.
    expect(lastRegularClose(at('2026-11-30T13:00:00Z'), cal)?.toISOString()).toBe(
      '2026-11-27T18:00:00.000Z',
    );
    // Friday 2026-11-27 evening is after its early close.
    expect(lastCompletedTradingDay(at('2026-11-27T23:00:00Z'), cal)).toBe('2026-11-27');
  });
  it('finds the next open across Thanksgiving', () => {
    expect(nextRegularOpen(at('2026-11-25T22:00:00Z'), cal)?.toISOString()).toBe(
      '2026-11-27T14:30:00.000Z',
    );
  });
});
