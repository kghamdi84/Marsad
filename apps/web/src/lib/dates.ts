/** Short dates as the design writes them. Inputs are ISO calendar dates (YYYY-MM-DD), read as written. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '2026-11-25' as '25 Nov'. */
export const dayMonth = (iso: string) =>
  `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`;

/** '2026-08-31' as '31 Aug 2026'. */
export const dayMonthYear = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

/** '2026-11-25' as 'Wed 25 Nov'. The weekday comes from the calendar date, not a time zone. */
export const weekdayDayMonth = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()] ?? ''} ${dayMonth(iso)}`;
};

/** '2025-11-21' as 'Nov 2025'. */
export const monthYear = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;
