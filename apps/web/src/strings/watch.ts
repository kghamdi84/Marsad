/**
 * Watch strings: brief, strip, watchlist, trader columns and the economic calendar.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const watch = {
  title: 'Watch',
  intro:
    'Today and the days ahead. Marsad watches and explains; you decide and place every order in Sahm.',
  endOfDay:
    'End-of-day data (free plans): every number is from the last completed session, with its date. Real-time quotes need a paid plan.',
  strip: {
    title: 'Market strip',
    names: {
      SPY: 'SPY',
      QQQ: 'QQQ',
      IWM: 'IWM',
      DIA: 'DIA',
      GLD: 'GLD',
      VIXCLS: 'VIX',
      DGS10: '10-year yield',
      DCOILWTICO: 'WTI oil',
      DTWEXBGS: 'Broad dollar',
    } as Record<string, string>,
    points: (v: string) => `${v} pts`,
    aria: (name: string, value: string) => `${name} ${value}`,
    source: 'Sources: Massive daily bars (ETFs); FRED (VIX, 10-year yield, WTI oil, broad dollar).',
  },
  list: {
    title: 'Watchlist',
    defaultNote: 'Showing the starting tickers; no saved watchlist yet.',
    colTicker: 'Ticker',
    colClose: 'Close',
    col1d: '1 day',
    col5d: '1 week',
    col1m: '1 month',
    colHigh: 'From 52-week high',
    colVolume: 'Volume against 20-day average',
    colDate: 'As of',
    times: (v: string) => `${v}\u00D7`,
    source: 'Source: Massive daily bars, split-adjusted. Click a ticker to study it.',
  },
  sectors: {
    title: 'US sectors',
    aside: (n: number, day: string) => `${n} SPDR ETFs \u00B7 close of ${day}`,
    none: 'No sector data yet. It comes from the breadth job (after its first full run).',
    asOf: (date: string) => `Day change of the Select Sector SPDRs on ${date}.`,
    source: 'Source: Massive grouped daily (end of day), splits applied by Marsad.',
  },
  movers: {
    title: 'Movers in the Marsad universe',
    none: 'No movers yet. They come from the breadth job (after its first full run).',
    asOf: (date: string, n: number) =>
      `${date}, among ${n.toLocaleString('en-US')} members of the Marsad universe (the 1,000 most traded US stocks and ETFs). Moves over 50% are left out as likely bad prints.`,
    gainers: 'Biggest gainers',
    losers: 'Biggest losers',
    dollarVolume: (v: string) => `USD ${v} traded`,
    marketTitle: 'Whole-market movers',
    scopeLabel: 'Movers scope',
    scope: { market: 'Whole market', universe: 'Marsad universe' },
    viewLabel: 'Movers list',
    views: {
      gainers: 'Gainers',
      losers: 'Losers',
      active: 'Active',
      unusual: 'Unusual volume',
      highs: '52-week high',
      lows: '52-week low',
    },
    header: (day: string, source: string) =>
      `Last completed session (end of day): ${day}, from ${source}. Not live.`,
    sourceMarket: 'Massive grouped daily',
    sourceMine: 'Massive daily bars for your watchlist and holdings',
    floorLabel: 'Minimum traded',
    floor: (v: string) => `USD ${v}`,
    mineLabel: 'On my list',
    mineNote: (n: number) =>
      `Your watchlist and holdings (${n.toLocaleString('en-US')} ${n === 1 ? 'ticker' : 'tickers'}), by the same rules, from their stored daily bars.`,
    noBars: (list: string) => `No stored daily bars: ${list}.`,
    afterHours: 'After hours: Not available: Marsad stores end-of-day prices only.',
    unusualRule: (ratio: string, usd: string, sessions: number, long: number) =>
      `Rule: volume at least ${ratio} its average of the previous ${sessions} sessions, and at least USD ${usd} traded. The ${long}-session ratio is shown beside it for context.`,
    highLowRule: (n: number) =>
      `By close: the session closed at or beyond the highest (or lowest) close of the last ${n} stored sessions, the session included.`,
    count: (shown: number, of: number) =>
      `Top ${shown.toLocaleString('en-US')} of ${of.toLocaleString('en-US')}.`,
    empty: 'No ticker qualifies at this minimum.',
    unavailable: (have: number, need: number) =>
      `Unavailable: ${need.toLocaleString('en-US')} stored sessions are needed and ${have.toLocaleString('en-US')} are stored.`,
    notComputed:
      'Whole-market movers are not computed yet. They come from the breadth job (movers-1), on its next run after the close.',
    ownerOnly:
      'Whole market: Available to the owner only. Massive’s data plans are for individual use, so whole-market lists are not shared. Marsad universe movers stay available.',
    cols: {
      ticker: 'Ticker',
      change: '1-session change',
      close: 'Close',
      volume: 'Volume',
      ratio: 'Against 20-session average (50-session)',
      prior: { highs: 'Prior 52-week high close', lows: 'Prior 52-week low close' },
      traded: 'Traded',
      catalyst: 'Latest stored headline, not a verified cause',
    },
    ratio: (r20: string, r50: string | null) => (r50 === null ? r20 : `${r20} (${r50})`),
    times: (v: string) => `${v}\u00D7`,
    volumeShort: (v: string) => `${v} shares`,
    noCatalyst: 'No stored news or filing for this ticker',
    catalystAt: (title: string, source: string, when: string) => `${title} (${source}, ${when})`,
    filedOn: (day: string) => `filed ${day}`,
    checks: (n: number) => `Check corporate action (${n.toLocaleString('en-US')})`,
    checksIntro:
      'Not ranked as plain movers: each needs a check against splits, ticker changes and other corporate actions first.',
    checkPill: 'Check corporate action',
    reasons: {
      'move-over-25': 'Moved more than 25% in one session',
      'split-on-session': 'A split takes effect on this session',
      'split-in-volume-window':
        'A split took effect inside the 20 sessions behind the volume average',
      'ticker-change-on-session': 'A ticker change takes effect on this session',
      'ticker-change-in-volume-window':
        'A ticker change took effect inside the 20 sessions behind the volume average',
    } as Record<string, string>,
    /** Massive's split_from and split_to: 1 and 2 is a 2-for-1 split. */
    split: (from: number, to: number, day: string) => `Split ${to}-for-${from} on ${day}`,
    about: {
      what: 'Gainers and losers by change from the previous session’s close; most active by dollar volume (close times volume); unusual volume, and new 52-week highs and lows by close. End-of-day data, never live.',
      eligible: (asOf: string | null) =>
        asOf
          ? `Common stocks and ETFs only, from Marsad’s quarterly Massive ticker lists (latest as of ${asOf}); a ticker listed since then is left out until the next list.`
          : 'Common stocks and ETFs only, from Marsad’s quarterly Massive ticker lists.',
      liquidity: (price: string, usd: string) =>
        `Liquidity floor: a close of at least USD ${price} and at least USD ${usd} traded. Marsad does not store market capitalisation for the whole market, so the filter is by dollar volume instead.`,
      guard:
        'Prices are put on the current share basis from the stored splits. A move over 25%, or a move or volume jump that lines up with a stored split or ticker change, is listed under Check corporate action, never ranked. Marsad stores no whole-market ticker-change feed, so a renamed ticker has no previous close under its new symbol and is left out.',
      counts: (s: {
        traded: number;
        withChange: number;
        zero: number;
        noPrev: number;
        price: number;
        dv: number;
      }) =>
        `This session: ${s.traded.toLocaleString('en-US')} eligible tickers stored; ${s.withChange.toLocaleString('en-US')} ranked. Left out: ${s.zero.toLocaleString('en-US')} bad prints (zero price), ${s.noPrev.toLocaleString('en-US')} with no previous close stored, ${s.price.toLocaleString('en-US')} under the minimum price, ${s.dv.toLocaleString('en-US')} under the minimum dollar volume.`,
      history: (vol: number, year: number) =>
        `${vol.toLocaleString('en-US')} tickers have all 20 previous sessions stored (unusual volume) and ${year.toLocaleString('en-US')} have all 252 (52-week views). Sessions under USD 1 million traded are not stored, so a ticker with such a session is left out of those two views.`,
      catalyst:
        'Latest stored headline: the newest stored news article or SEC filing for the ticker since the start of the previous session, with its source and time, matched by code. It is not a verified cause, and Marsad never writes why a stock moved. Marsad stores news and filings mainly for the watchlist and holdings, so most tickers show none.',
      noAlerts: 'Movers never send a push alert and never feed an alert rule.',
      formula: (version: string, at: string) => `Formula ${version}, computed ${at}.`,
    },
  },
  gaps: {
    title: 'Gap scanner',
    intro:
      'Opening gaps at the last session (open against the previous close), for the watchlist and the strip ETFs, largest first. Pre-market gaps in real time need a paid plan.',
    none: 'No gaps to show: no daily bars stored yet.',
  },
  brief: {
    title: 'Latest brief',
    none: 'The pre-market brief is built about 60 minutes before the open, the close recap after the close (trading days).',
    made: (at: string) => `Built ${at}, by templates from stored data (no AI).`,
    email: (state: string) =>
      state === 'sent'
        ? 'Emailed.'
        : state === 'not-configured'
          ? 'Not emailed: no email channel set up yet (docs/SETUP.md, step 9).'
          : `Email failed: ${state.replace(/^failed: /, '')}.`,
  },
  news: {
    title: 'Latest news',
    none: 'No news stored for the watchlist yet.',
  },
  v2: {
    switch: {
      feedLabel: 'News, calendar or dividends',
      feed: { news: 'Latest news', calendar: 'Calendar', dividends: 'Dividends' },
      marketLabel: 'Sectors, movers or gaps',
      market: { sectors: 'US sectors', movers: 'Movers', gaps: 'Gaps' },
    },
    noData: 'No data stored',
    sourceChip: (day: string) => `Massive \u00B7 end of day \u00B7 close of ${day}`,
    cockpit: {
      title: 'Morning decision cockpit',
      regime: 'Regime',
      movers: 'Last session movers',
      today: 'Today',
      exits: 'Exit rules',
      notYet: 'Not available yet',
      regimeNone: 'The regime job has not stored a day yet.',
      labels: {
        stress: 'Stress',
        bear: 'Bear',
        recovery: 'Recovery',
        'bull-calm': 'Bull calm',
        'bull-correction': 'Bull correction',
        'insufficient-data': 'Insufficient data',
      } as Record<string, string>,
      run: (n: number, atLeast: boolean, version: string, day: string) =>
        `${atLeast ? 'At least ' : ''}${n} session${n === 1 ? '' : 's'} \u00B7 ${version} \u00B7 ${day}`,
      vix: (v: string) => `VIX ${v}`,
      vixNone: 'VIX not stored',
      breadth: (p: string) => `breadth ${p}% above 50-day`,
      breadthNone: 'breadth not stored',
      moversNone: 'No watchlist bars stored yet.',
      closeOf: (day: string) => `Close of ${day}`,
      closed: (name: string) => `Market closed: ${name}`,
      earlyClose: (et: string) => `Early close ${et} ET`,
      event: (name: string, et: string) => `${name} ${et} ET`,
      local: (time: string, city: string) => `${time} ${city}`,
      moreToday: (n: number) => `${n} more today`,
      noEvents: 'No scheduled releases today',
      calendarNone: 'Calendar not stored yet',
      filings: (n: number, first: string) =>
        n === 0
          ? 'No Tier 1 filing since the last close'
          : `${n} Tier 1 filing${n === 1 ? '' : 's'}: ${first}`,
      filingsUnavailable: 'Filings unavailable',
      exitsNone: 'No holdings recorded',
      exitsNoneSub: 'Add holdings in the Journal to check their exit rules.',
      allInside: 'Every holding inside its plan',
      checked: (n: number, day: string) =>
        `${n} holding${n === 1 ? '' : 's'} checked at the close of ${day}`,
      others: (n: number) =>
        n === 0
          ? 'No other holding flagged'
          : `${n} other holding${n === 1 ? '' : 's'} inside plan`,
      signal: {
        stop: (tk: string) => `${tk} closed under its stop`,
        'trend-break': (tk: string, period: string) => `${tk} under its ${period}-day average`,
        'time-stop': (tk: string) => `${tk} reached its time stop`,
        target: (tk: string) => `${tk} reached a target`,
      },
      holdingsUnavailable: 'Holdings unavailable',
      briefLine: (kind: string, et: string, local: string, city: string, state: string) =>
        `${kind} \u00B7 ${et} ET \u00B7 ${local} ${city} \u00B7 ${state}`,
      noBrief: 'No brief yet',
      fullBrief: 'Read the full brief',
    },
    list: {
      hint: 'Tap a row to open Study \u00B7 volume against the 20-day average \u00B7 earnings dates are estimated',
      colCompany: 'Company',
      colRange: '52-week position',
      colVolume: 'Volume',
      held: 'Held',
      showTrader: 'Show trader columns',
      hideTrader: 'Hide trader columns',
      position: (p: string) => `${p}%`,
      open: (tk: string) => `Open ${tk} in Study`,
    },
    news: {
      asOf: (et: string) => `Read ${et} ET \u00B7 refreshes when the page loads`,
      live: (et: string) =>
        `Live \u00B7 new stories appear as they are stored \u00B7 read ${et} ET`,
      newTag: 'New',
      highlight: 'Highlight of the day',
      impact: { high: 'High impact', medium: 'Medium', low: 'Low' } as Record<string, string>,
      secEdgar: 'SEC EDGAR',
      tier: (n: number) => `Tier ${n}`,
      opinion: 'Opinion',
      loading: 'Loading',
      filingTitle: (tk: string, form: string, items: string, plain: string) =>
        `${tk} files ${form}${items ? `, item ${items}` : ''}${plain ? `: ${plain}` : ''}`,
      why: {
        held: (tks: string) => `Touches your holdings: ${tks}.`,
        watched: (tks: string) => `Names watchlist tickers: ${tks}.`,
        topic: (topic: string, ratio: string) =>
          `${topic} headlines are running at ${ratio}\u00D7 the weekly norm.`,
        filing: (plain: string) => `SEC filing: ${plain}.`,
        tier: (tier: number) => `Tier ${tier} source.`,
        score: (score: number, version: string) => `Impact score ${score} (${version}).`,
      },
      topics: {
        conflict: 'Conflict',
        sanctions: 'Sanctions and export control',
        tariffs: 'Tariff and trade',
        elections: 'Election',
        centralBanks: 'Central bank',
        energy: 'Energy',
      } as Record<string, string>,
      more: (n: number) => `${n} more stor${n === 1 ? 'y' : 'ies'}`,
      about:
        'Ranked by impact (impact-1): source tier, the filing item, whether it names your holdings or watchlist, and how busy its topic is against the 4-week norm. The price move since the story is left out: it needs prices after the story, and Marsad stores end-of-day bars. Realtime updates: new stories and filings appear when the jobs store them (news three times each weekday, filings twice an hour on weekdays), marked New for a minute; if the live connection is down, the card says when it read the list. Filings: SEC EDGAR 8-K, 10-Q and 10-K of the watchlist and holdings, last 10 days.',
    },
    calendar: {
      title: 'Economic and earnings calendar',
      zones: (city: string) => `ET \u00B7 ${city}`,
      pill: { high: 'HIGH', medium: 'MED', low: 'LOW', earn: 'EARN' } as Record<string, string>,
      source: (src: string) => `Source: ${src}`,
      earnSource: 'SEC 8-K dates',
      legend:
        'HIGH, MED and LOW: expected market impact of the release \u00B7 EARN: watchlist earnings, estimated from past filing dates',
    },
  },
  ui: {
    lastSession: (date: string) => `Last completed session ${date}`,
    emailed: 'Emailed',
    notEmailed: 'Not emailed',
    emailFailed: 'Email failed',
    briefTitle: (kind: string, day: string) => `${kind} · ${day}`,
    briefWhen: (et: string, local: string, city: string) =>
      `${et} ET · ${local} ${city} · template`,
    noBriefTitle: 'No brief yet',
    membersNote:
      'Daily briefs and alerts go to the account owner. Markets, regime and company pages are shared.',
    period: 'Change period',
    periods: { '1d': '1D', '5d': '5D', '1m': '1M' } as Record<string, string>,
    periodLong: { '1d': '1 day', '5d': '1 week', '1m': '1 month' } as Record<string, string>,
    sortByChange: 'Sort by change',
    colSpark: '30 sessions',
    colChange: (period: string) => `Change, ${period}`,
    colRange: '52-week range',
    colVolume: 'Volume vs 20-day',
    rangeAria: (low: string, high: string, pos: string, fromHigh: string) =>
      `52-week closing range ${low} to ${high}; the last close sits at ${pos}% of it, ${fromHigh} from the high.`,
    rangeNone: 'Needs a year of bars',
    olderDate: (date: string) => `as of ${date}`,
    latestCol: 'Latest (Tauric)',
    latestNone: 'No Tauric quote yet',
    latestNotCovered: 'Not covered by Tauric',
    latestPhone: (price: string) => `Tauric ${price}`,
    latestFooter:
      'Latest prices: Tauric, delay not confirmed (choose the source on the Status page). Close, change and charts: Massive.',
    footer: (date: string) =>
      `Massive daily bars, split-adjusted \u00B7 close of ${date} \u00B7 click a ticker to study it`,
    dayChange: (v: string) => `day ${v}`,
    gapLegend: 'Light bar: the gap. Solid bar: how much of it the close kept.',
    moversGaps: 'Movers and gaps',
    tabUp: 'Up',
    tabDown: 'Down',
    tabGaps: 'Gaps',
    studyTicker: (tk: string) => `Study ${tk}`,
    periodChips: { '1d': '1 day', '5d': '1 week', '1m': '1 month' } as Record<string, string>,
    calendar: 'Agenda',
    agendaLegend: 'Red: high impact · yellow: medium · blue: watchlist earnings, estimated',
    tagMacro: 'Macro',
    tagWatchlist: 'Watchlist',
    eventTime: (et: string, local: string, city: string) => `${et} ET · ${local} ${city}`,
    earningsName: (ticker: string) => `${ticker} earnings`,
    earningsWord: 'earnings',
    earningsWhen: (from: string, to: string) => `Estimated, ${from} to ${to}`,
    calType: 'Calendar type',
    calAll: 'All',
    calEconomy: 'Economy',
    calEarnings: 'Earnings',
    legendHigh: 'High impact',
    legendMedium: 'Medium impact',
    legendEarnings: 'Watchlist earnings (estimated from past filing dates)',
  },
} as const;

export const watchlist = {
  edit: 'Edit list',
  editTitle: 'Edit the watchlist',
  addLabel: 'Add a ticker',
  add: 'Add',
  up: (t: string) => `Move ${t} up`,
  down: (t: string) => `Move ${t} down`,
  remove: (t: string) => `Remove ${t}`,
  invalid: (t: string) => `"${t}" is not a ticker symbol.`,
  full: (n: number) => `The list holds at most ${n} tickers.`,
  barsNote:
    'A new ticker gets prices after the next nightly bars run (about 22:15 UTC on trading days).',
  saving: 'Saving…',
  saved: 'Saved.',
  done: 'Done',
  addTo: 'Add to watchlist',
  onList: 'On your watchlist',
  sectorFor: (t: string) => `Sector fund for ${t}`,
  noSector: 'Sector',
} as const;

export const trader = {
  toggle: 'Trader columns',
  atrPct: 'ATR %',
  stretch50: 'Stretch, 50-day',
  stretch20: 'Stretch, 20-day',
  rsSpy: 'vs SPY, 3 months',
  rsSector: 'vs sector, 3 months',
  noSector: 'No sector set',
  rank: 'Universe rank',
  rankValue: (p: number) => `Beats ${p}%`,
  notRanked: 'Not in universe',
  rankFact: 'Strength rank, 3 months',
  rankSub: (rank: number, members: number, day: string) => `${rank} of ${members} · ${day}`,
  fromHigh: 'From high',
  earnings: 'Earnings',
  atrs: (v: string) => `${v} ATR`,
  inDays: (n: number) => (n <= 0 ? 'due' : `${n} d`),
} as const;

export const calendar = {
  title: 'Economic calendar',
  none: 'No calendar yet. The calendar job runs after the FRED job each evening (23:30 UTC).',
  todayHeading: (date: string) => `Today, ${date}`,
  range: (from: string, to: string) => `${from} to ${to}`,
  impact: { high: 'High impact', medium: 'Medium impact', low: 'Low impact' } as Record<
    string,
    string
  >,
  time: (et: string, local: string) => `${et} ET (${local} local)`,
  countdownIn: (h: number, m: number) => (h > 0 ? `in ${h} h ${m} min` : `in ${m} min`),
  released: 'Released',
  daysAhead: (n: number) => `Next ${n} days.`,
  source: (at: string) =>
    `Sources: FRED release calendar (dates) with each agency's usual release time; FOMC dates from the Federal Reserve. Updated ${at}.`,
  earningsTitle: 'Watchlist earnings (estimated)',
  earningsIntro:
    'Estimated from each company\u2019s own results filings (SEC 8-K item 2.02): companies usually report a quarter on the same weekday a year later. Not a confirmed date; check the company\u2019s investor relations page.',
  earningsNone: 'No estimates yet. They need stored SEC results filings and the calendar job.',
  colTicker: 'Ticker',
  colExpected: 'Expected around',
  colRange: 'Range',
  colBasis: 'Basis',
  colLast: 'Last results filing',
  basis: {
    'same-quarter-last-year': 'Same quarter last year, 52 weeks on',
    'quarterly-cadence': 'About 13 weeks after the last one (less than a year of history)',
  } as Record<string, string>,
  overdue: 'Overdue: no newer results filing yet',
} as const;
