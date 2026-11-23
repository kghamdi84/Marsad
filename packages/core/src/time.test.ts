import { describe, expect, it } from 'vitest';
import { assertTimeZone, dualClock, formatClock, US_EASTERN } from './time.js';

describe('formatClock', () => {
  it('uses daylight time in summer (ET = UTC-4)', () => {
    // 2026-07-01 13:30 UTC is the regular-session open, 09:30 EDT.
    expect(formatClock(new Date('2026-07-01T13:30:00Z'), US_EASTERN)).toBe('09:30');
  });

  it('uses standard time in winter (ET = UTC-5)', () => {
    // US daylight saving ended 2026-11-01; the open is 14:30 UTC.
    expect(formatClock(new Date('2026-12-01T14:30:00Z'), US_EASTERN)).toBe('09:30');
  });

  it('switches on the US change date, not the Riyadh calendar', () => {
    // 2026-11-01 06:00 UTC is after the 02:00 EDT fall-back (06:00 UTC).
    expect(formatClock(new Date('2026-11-01T05:59:00Z'), US_EASTERN)).toBe('01:59');
    expect(formatClock(new Date('2026-11-01T06:00:00Z'), US_EASTERN)).toBe('01:00');
  });

  it('keeps Riyadh at UTC+3 all year', () => {
    expect(formatClock(new Date('2026-07-01T13:30:00Z'), 'Asia/Riyadh')).toBe('16:30');
    expect(formatClock(new Date('2026-12-01T14:30:00Z'), 'Asia/Riyadh')).toBe('17:30');
  });
});

describe('dualClock', () => {
  it('renders ET with local time in parentheses', () => {
    expect(dualClock(new Date('2026-12-01T19:05:00Z')).label).toBe('14:05 ET (22:05 local)');
  });
});

describe('assertTimeZone', () => {
  it('rejects unknown zones', () => {
    expect(() => assertTimeZone('Mars/Olympus')).toThrow();
  });
});
