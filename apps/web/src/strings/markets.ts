/**
 * Markets strings: the page's switch, its summary card and the "See all" links from Watch.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

/** Markets (ADR 0048): regime, whole-market movers, sectors and the calendar, one view at a time. */
export const markets = {
  intro:
    'The market as a whole, end of day: the regime label and why, the movers of the last completed session, the sector funds, and the calendar of earnings, ex-dividend dates and macro releases. Marsad explains; you decide.',
  viewsLabel: 'Markets view',
  screenerLink: 'Open the screener',
  views: {
    regime: 'Regime',
    movers: 'Movers',
    sectors: 'Sectors',
    calendar: 'Calendar',
  },
  summary: {
    title: 'Markets today',
    regime: 'Regime',
    regimeValue: (label: string, sessions: number) =>
      `${label}, ${sessions} ${sessions === 1 ? 'session' : 'sessions'}`,
    regimeSub: (date: string, version: string) => `Close of ${date} · ${version}`,
    sectors: 'Sectors',
    sectorsValue: (lead: string, lag: string) => `Leading ${lead}; lagging ${lag}`,
    sectorsSub: (date: string) => `Select Sector SPDRs, day change, close of ${date}`,
    movers: 'Movers',
    moversValue: (up: string, down: string) => `Top gainer ${up}; top loser ${down}`,
    moversSub: (date: string, n: number) =>
      `Marsad universe (${n} members), last completed session ${date}`,
    calendar: 'Calendar',
    nextHigh: (name: string, when: string) => `Next high impact: ${name}, ${when}`,
    noHigh: 'No high-impact release in the next 30 days',
    calendarSub: (n: number) =>
      n === 0
        ? 'No estimated earnings in the next 30 days'
        : `${n} estimated ${n === 1 ? 'earnings date' : 'earnings dates'} in the next 30 days`,
    when: (day: string, et: string) => `${day} ${et} ET`,
    unavailable: 'Data unavailable',
    loading: 'Loading',
  },
  calendarIntro:
    'The next 30 days: macro releases with their ET and local times, estimated earnings for your tickers, and ex-dividend dates by day. Watch shows the next 14.',
  seeAll: {
    regime: 'See the regime on Markets',
    movers: 'See all movers on Markets',
    sectors: 'See all sectors on Markets',
    calendar: 'See the full calendar on Markets',
  },
} as const;
