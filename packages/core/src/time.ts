/**
 * Time helpers shared by the web app, Edge Functions and batch jobs.
 * All instants are UTC; zones come from the IANA database through Intl,
 * so US daylight-saving changes are handled without hand-written offsets.
 */

export const US_EASTERN = 'America/New_York';
export const DEFAULT_LOCAL_ZONE = 'Asia/Riyadh';

const formatters = new Map<string, Intl.DateTimeFormat>();

function hhmmFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time "HH:MM" (24-hour) of an instant in an IANA zone. */
export function formatClock(instant: Date, timeZone: string): string {
  return hhmmFormatter(timeZone).format(instant);
}

/** Throws on an unknown IANA zone, so a typo in settings fails loudly. */
export function assertTimeZone(timeZone: string): void {
  hhmmFormatter(timeZone);
}

/** The pair every Marsad time display shows: US Eastern and the user's local zone. */
export function dualClock(
  instant: Date,
  localZone: string = DEFAULT_LOCAL_ZONE,
): { et: string; local: string; label: string } {
  const et = formatClock(instant, US_EASTERN);
  const local = formatClock(instant, localZone);
  return { et, local, label: `${et} ET (${local} local)` };
}
