/**
 * Every user-visible string lives here, so an Arabic (right-to-left) option
 * can be added later by swapping this module.
 */
export const t = {
  appName: 'Marsad',
  configMissing: {
    title: 'Configuration missing',
    body: 'This build has no Supabase address or publishable key. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Netlify, then redeploy.',
  },
  loading: 'Loading',
  signIn: {
    title: 'Sign in to Marsad',
    emailLabel: 'Email',
    sendLink: 'Email me a sign-in link',
    sending: 'Sending',
    linkSent: (email: string) =>
      `We sent a sign-in email to ${email}. Tap Sign in in that email. You are then signed in wherever the link opens.`,
    pasteHelp:
      'To sign in here instead (for example, in the Home Screen app): in the email, touch and hold Sign in, choose Copy Link, then paste it below. A 6-digit code also works if the email has one.',
    codeLabel: 'Sign-in link or code',
    verify: 'Sign in',
    verifying: 'Signing in',
    notALinkOrCode:
      'That is not the sign-in link from the email or a 6-digit code. Copy the whole Sign in link and try again.',
    linkFailed: (reason: string) =>
      `The sign-in link did not work (${reason}). Each link works once and expires after a short time. Request a new one.`,
    useDifferentEmail: 'Use a different email',
    noAccount: 'Sign-ups are closed. Only the existing account can sign in.',
  },
  mfa: {
    enrollTitle: 'Set up two-factor authentication',
    enrollBody:
      'Marsad requires an authenticator app. Scan the QR code with your authenticator app (for example, iOS Passwords, 1Password or Google Authenticator), then enter the 6-digit code it shows.',
    secretLabel: 'Or enter this setup key by hand',
    qrAlt: 'QR code for your authenticator app',
    verifyTitle: 'Two-factor check',
    verifyBody: 'Enter the 6-digit code from your authenticator app.',
    codeLabel: 'Authenticator code',
    confirm: 'Confirm',
    confirming: 'Checking',
  },
  nav: {
    watch: 'Watch',
    study: 'Study',
    regime: 'Regime',
    alerts: 'Alerts',
    journal: 'Journal',
    status: 'Status',
    lab: 'Lab',
    signOut: 'Sign out',
    primary: 'Main sections',
  },
  clock: { et: 'ET', local: 'local' },
  watch: {
    title: 'Watch',
    intro:
      'Today and the days ahead. Marsad watches and explains; you decide and place every order in Sahm.',
    endOfDay:
      'End-of-day data (free plans): every number is from the last completed session, with its date. Real-time quotes need a paid plan.',
    strip: {
      title: 'Market strip',
      names: {
        SPY: 'S&P 500 (SPY)',
        QQQ: 'Nasdaq 100 (QQQ)',
        IWM: 'Russell 2000 (IWM)',
        DIA: 'Dow (DIA)',
        GLD: 'Gold (GLD)',
        VIXCLS: 'VIX',
        DGS10: '10-year yield',
        DCOILWTICO: 'WTI oil',
        DTWEXBGS: 'Dollar (broad)',
      } as Record<string, string>,
      points: (v: string) => `${v} points`,
      source:
        'Sources: Massive daily bars (ETFs); FRED (VIX, 10-year yield, WTI oil, broad dollar).',
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
      times: (v: string) => `${v}x`,
      source: 'Source: Massive daily bars, split-adjusted. Click a ticker to study it.',
    },
    sectors: {
      title: 'Sector heatmap',
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
    },
    gaps: {
      title: 'Gap scanner',
      intro:
        'Opening gaps at the last session (open against the previous close), for the watchlist and the strip ETFs, largest first. Pre-market gaps in real time need a paid plan.',
      none: 'No gaps to show: no daily bars stored yet.',
    },
    brief: {
      title: 'Latest brief',
      none: 'No brief yet. The pre-market brief is built about 60 minutes before the open, the close recap after the close (trading days).',
      made: (at: string) => `Built ${at}, by templates from stored data (no AI).`,
      email: (state: string) =>
        state === 'sent'
          ? 'Emailed.'
          : state === 'not-configured'
            ? 'Not emailed: no email channel set up yet (docs/SETUP.md, step 9).'
            : `Email failed: ${state.replace(/^failed: /, '')}.`,
    },
    news: {
      title: 'Watchlist news',
      none: 'No news stored for the watchlist yet.',
    },
  },
  journal: {
    title: 'Journal',
    intro:
      'Size a trade before you place it in Sahm, and keep every holding\u2019s exit conditions in view. Marsad never places orders; holding is never the default.',
    sizer: {
      title: 'Pre-trade checklist and position sizer',
      ticker: 'Ticker',
      account: 'Account size (USD)',
      risk: 'Risk per trade (%)',
      entry: 'Limit price',
      stop: 'Stop',
      targets: 'Targets (separate with spaces)',
      tif: 'Time in force',
      result: (shares: number, risk: string, value: string, pct: string) =>
        `${shares} shares; risk USD ${risk} if the stop fills; position USD ${value} (${pct} of the account).`,
      capped: 'Capped at 25% of the account, not by the risk.',
      rr: (list: string) => `Reward to risk: ${list}.`,
      checklist: 'Checklist (all five before the ticket)',
      ticket: 'Sahm order ticket',
      copy: 'Copy Sahm order ticket',
      copied: 'Copied. Paste it into Sahm and check it there before you send it.',
      incomplete: 'Tick all five checklist items to copy the ticket.',
    },
    holdings: {
      title: 'Holdings and exit conditions',
      none: 'No open holdings. Add one below or paste a CSV.',
      colTicker: 'Ticker',
      colShares: 'Shares',
      colCost: 'Cost',
      colLast: 'Last close',
      colResult: 'Unrealized',
      colExits: 'Exit conditions',
      rules: (stop: string, targets: string, trend: string, time: string) =>
        `Stop ${stop}; targets ${targets}; trend break ${trend}; time stop ${time}.`,
      none2: 'none',
      noRules: 'No exit conditions set: add a stop and a target.',
      triggered: 'Triggered',
      close: 'Mark closed',
      add: 'Add holding',
      csvTitle: 'Add from CSV',
      csvHelp:
        'Paste rows with the header ticker,shares,cost_basis,opened_on,stop,targets,trend_break,time_stop_sessions. Targets separated by ;. Trend break like sma50.',
      csvButton: 'Add these holdings',
      csvAdded: (n: number) => `${n} holding${n === 1 ? '' : 's'} added.`,
      opened: 'Opened (YYYY-MM-DD)',
      trend: 'Trend break (like sma50)',
      timeStop: 'Time stop (sessions)',
    },
  },
  alerts: {
    title: 'Alerts',
    intro:
      'Every signal Marsad judged, with the decision and its reasons. Few, clean, complete: each alert keeps its inputs, rule version and delivery log.',
    showSuppressed: 'Show suppressed signals too',
    none: 'No alerts yet. Halt alerts for watched tickers start with the next halts run; rule alerts start when rules go live.',
    decision: {
      push: 'Pushed',
      digest: 'Held for the digest',
      shadow: 'Shadow (logged, not delivered)',
      suppress: 'Suppressed',
    } as Record<string, string>,
    why: 'Why',
    latency: (seconds: string) => `End-to-end latency ${seconds} s.`,
    delivery: (push: string) => `Delivery: ${push}.`,
    feedback: 'Feedback',
    verdicts: { useful: 'Useful', noise: 'Noise', acted: 'Acted on' } as Record<string, string>,
    saved: 'Saved.',
    at: (when: string) => `Created ${when}.`,
  },
  lab: {
    title: 'Backtest lab',
    intro:
      'The seeded playbooks, each with its evidence and sources, tested by Marsad on stored data. A playbook earns live status only through these tests, never through its citation: published anomalies tend to weaken (McLean and Pontiff, 2016).',
    rating: {
      strong: 'Strong',
      moderate: 'Moderate',
      weak: 'Weak',
      'weak-to-moderate': 'Weak to moderate',
    } as Record<string, string>,
    horizon: {
      scalp: 'Scalp',
      swing: 'Swing',
      'swing-to-long': 'Swing to long term',
      long: 'Long term',
    } as Record<string, string>,
    status: {
      draft: 'Draft',
      backtested: 'Backtested',
      shadow: 'Shadow',
      live: 'Live',
      demoted: 'Demoted',
      none: 'Not run yet',
    } as Record<string, string>,
    meta: (n: number, rating: string, horizon: string, status: string) =>
      `Playbook ${n}. Evidence: ${rating}. Horizon: ${horizon}. Status: ${status}.`,
    notTestable: (why: string) => `Not testable yet: ${why}`,
    sources: 'Sources',
    rule: 'Rule (JSON, version stored with a content hash)',
    lastRun: (at: string, tickers: string) => `Last run ${at} on ${tickers}.`,
    noRun: 'Not run yet. The backtest lab runs each Sunday and by hand.',
    trades: (all: number, oos: number) =>
      `${all} trades in all; ${oos} out of sample (walk-forward, holdout untouched).`,
    expectancy: (v: string, lo: string, hi: string) =>
      `Out-of-sample expectancy ${v} per trade (90% interval ${lo} to ${hi}).`,
    insufficient: (n: number) =>
      `Insufficient history: ${n} out-of-sample trades, 30 needed for any percentage.`,
    winRate: (v: string) => `Win rate ${v}.`,
    drawdown: (dd: string, mc: string) => `Maximum drawdown ${dd}; Monte Carlo worst 5% ${mc}.`,
    benchmark: (t: string, v: string) => `${t} over the same dates: ${v}.`,
    gate: (reason: string) => `Gate to backtested: ${reason}.`,
    costs: (c: number, s: number, f: number) =>
      `Costs per side: commission ${c}, slippage ${s}, currency ${f} basis points.`,
    leftOut: 'Left out, and why',
  },
  calendar: {
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
  },
  study: {
    title: 'Study',
    intro: 'Pick a company to study. Prices are end-of-day, never a live quote.',
    etfs: 'Benchmark ETFs',
    openLabel: 'Open any ticker',
    open: 'Open',
    badTicker: (t: string) => `"${t}" is not a valid ticker.`,
    back: 'All companies',
    noBars:
      'No daily bars stored for this ticker yet. The bars job runs each weekday after the close.',
    noCompany: 'No company record yet for this ticker (the SEC job covers the starting stocks).',
    chart: 'Price chart',
    chartLabel: (ticker: string, asOf: string) =>
      `Daily candlestick chart for ${ticker}, last bar ${asOf}`,
    indicators: 'Indicators',
    sma50: 'SMA 50',
    sma200: 'SMA 200',
    ema20: 'EMA 20',
    rsi: 'RSI 14',
    volume: 'Volume',
    markers: 'Chart markers',
    panelError: (name: string, msg: string) => `${name} could not be loaded: ${msg}`,
    financials: {
      title: 'Financials, as filed',
      asOfLabel: 'Known as of',
      note: (filed: string) =>
        `From SEC filings, using only what had been filed by the date chosen. Latest filing used: ${filed}. A figure marked "derived" is a quarter the filing does not report directly (year-to-date totals subtracted).`,
      none: 'No financial statements were filed by this date.',
      quarter: 'Quarter ended',
      revenue: 'Revenue',
      grossMargin: 'Gross margin',
      operatingMargin: 'Operating margin',
      netMargin: 'Net margin',
      eps: 'Diluted EPS',
      yoy: 'Revenue vs a year earlier',
      derived: 'derived',
      notReported: 'Not reported',
      ttm: 'Trailing four quarters',
      ttmNote:
        'Sum of the last four quarters. Diluted EPS is the sum of quarterly EPS, so it is approximate when a quarter is derived.',
      ttmNone: 'Needs four consecutive quarters of filings.',
      netIncome: 'Net income',
      opCash: 'Operating cash flow',
      pe: 'Price to earnings',
      peNote: (price: string, date: string) =>
        `Close of ${price} on ${date} over trailing diluted EPS.`,
      peNone: 'Not meaningful: trailing earnings are zero, negative or missing.',
      balance: (end: string) => `Balance sheet at ${end}`,
      assets: 'Total assets',
      liabilities: 'Total liabilities',
      equity: 'Shareholders equity',
      cash: 'Cash and equivalents',
      debt: 'Long-term debt',
      annual: 'Fiscal years',
      yearEnded: 'Year ended',
      source: (filed: string, acc: string) => `Filed ${filed}, accession ${acc}`,
      valuation:
        "Valuation against the company's own 5-year history needs 5 years of prices; the free plan gives 2 years.",
    },
    earnings: {
      title: 'Earnings history',
      note: 'The release time is when the SEC accepted the 8-K that carries the results (Item 2.02), shown in ET. The move compares the close of the first session that could trade on the news with the close before it. Prices are end-of-day and split-adjusted.',
      none: 'No earnings releases or reported quarters are stored for this company.',
      colQuarter: 'Quarter ended',
      colReleased: 'Results released',
      colRevenue: 'Revenue',
      colYoY: 'Revenue vs a year earlier',
      colEps: 'Diluted EPS',
      colMove: 'Stock move',
      timing: {
        'before-open': 'before the open',
        'during-session': 'during the session',
        'after-close': 'after the close',
      },
      noTiming: 'time not recorded',
      pending: 'Results not yet in a filed 10-Q or 10-K',
      derived: 'derived',
      notReported: 'Not reported',
      moveText: (pct: string, base: string, baseClose: string, at: string, atClose: string) =>
        `${pct} (${base} close ${baseClose}, ${at} close ${atClose})`,
      large: 'Over 25%: no split in the window, so check the news before trusting it.',
      gaps: {
        'no-release': 'No results 8-K stored for this quarter',
        'no-time': 'The filing has no recorded time, so the reacting session is unknown',
        'outside-bars': 'Before the first stored price (the free plan keeps 2 years)',
        'not-yet': 'The reacting session has no price bar yet',
        'missing-bars': 'Price bars are missing around this date',
        split: 'A split falls in this window, so the move is not computed',
      },
      summary: (n: number, mean: string, up: number, down: number) =>
        `Average size of the move over ${n} report${n === 1 ? '' : 's'}: ${mean} (${up} up, ${down} down). This is too few reports to say how often the stock rises or falls.`,
      summaryNone: 'No report has a computed move yet.',
      missingTitle: 'Needs more than the free plan',
      missingEstimates:
        'Estimates, surprise against estimates and guidance changes: requires a higher Massive plan (Benzinga data).',
      missingImplied:
        'Move against the options-implied move: needs options data, which is built in a later phase.',
    },
    risk: {
      title: 'Risk factors, year over year (10-K)',
      open: 'Show the comparison',
      intro:
        'Compares the wording of the Risk Factors section (Item 1A) of the two newest annual reports, sentence by sentence, by computer rules and not by a model. It shows what the text says, not whether a risk got worse or better.',
      loading: 'Loading two annual reports',
      none: 'No annual report text is stored for this company (ETFs file none).',
      oneReport: 'Only one annual report is stored, so there is nothing to compare yet.',
      gap: (newer: string, older: string) =>
        `The two newest stored reports are for years ending ${newer} and ${older}, which are not a year apart, so a comparison would not be fair.`,
      reports: (newer: string, newerFiled: string, older: string, olderFiled: string) =>
        `Newer: year ended ${newer}, filed ${newerFiled}. Older: year ended ${older}, filed ${olderFiled}.`,
      viewNewer: 'Newer 10-K on SEC',
      viewOlder: 'Older 10-K on SEC',
      counts: (added: number, removed: number, changed: number, unchanged: number) =>
        `${added} new, ${removed} removed, ${changed} edited, ${unchanged} unchanged sentences.`,
      summaryNote:
        'The list at the top of the section repeats each risk title, so a new risk can appear there and again in the text.',
      cutoff: (score: string) =>
        `A sentence counts as edited when it shares enough word pairs with one from the other year (score ${score} or more of 1, a Marsad default). Moving that cut-off moves the edited count, not the unchanged one.`,
      added: 'New in the newer report',
      removed: 'In the older report only',
      changed: 'Edited',
      under: (heading: string) => `Under: ${heading}`,
      showAll: (n: number) => `Show all ${n}`,
      showFewer: 'Show fewer',
      wordAdded: 'added',
      wordRemoved: 'removed',
      similarity: (score: string) => `Similarity ${score}`,
      nothing: 'Nothing in this group.',
      provenance: (version: string) =>
        `Source: Massive 10-K sections (plain text of Item 1A, free plan). Rules: ${version}.`,
    },
    insiders: {
      title: 'Insider filings (Forms 3, 4 and 5)',
      note: "Insiders report within two business days of a trade, so recent trades may not be here yet. The 10b5-1 flag is the checkbox on the filing: a pre-arranged plan, so the trade date does not show the insider's view on that day.",
      none: 'No insider transactions stored for this company.',
      summary: (sold: string, soldN: string, bought: string, boughtN: string) =>
        `Last 90 days, open market: sold ${soldN} shares (${sold}); bought ${boughtN} shares (${bought}).`,
      colDate: 'Trade date',
      colWho: 'Insider',
      colCode: 'Transaction',
      colShares: 'Shares',
      colPrice: 'Price',
      colValue: 'Value',
      colAfter: 'Owned after',
      colPlan: '10b5-1 plan',
      planYes: 'Plan box checked',
      planNo: 'Not under a plan',
      planUnknown: 'Not stated',
      unreadable: (n: number) =>
        `${n} insider filing${n === 1 ? '' : 's'} could not be read and ${n === 1 ? 'is' : 'are'} not included.`,
      colForm: 'Form',
      colFiled: 'Filed (ET)',
      form: (f: string) => `Form ${f}`,
      amendment: 'amendment',
      amendmentLines: (n: number) =>
        `${n} open-market line${n === 1 ? '' : 's'} from amendments ${n === 1 ? 'is' : 'are'} listed but not added to these totals, because an amendment can repeat an earlier filing.`,
      lagNote:
        'The trade date is when the trade happened and the filed date is when the SEC accepted the report. A Form 5 can report trades made long before it was filed, so check both dates.',
      holdings: {
        title: 'Initial holdings (Form 3)',
        note: 'A Form 3 lists what a person already holds when they become an insider (an officer, director or 10% owner). It reports holdings, not trades.',
        none: 'No initial-holdings reports (Form 3) are stored for this company so far. The insiders job reads them a batch at a time.',
        eventDate: (d: string) => `Became an insider ${d}`,
        filed: (d: string, days: number | null) =>
          days === null ? `filed ${d}` : `filed ${d}, ${days} day${days === 1 ? '' : 's'} later`,
        coOwners: (n: number) => `and ${n} other reporting owner${n === 1 ? '' : 's'}`,
        amends: (d: string | null) =>
          d ? `Amendment of a report submitted ${d}` : 'Amendment of an earlier report',
        noSecurities: 'The filing states that this person owns no securities.',
        noRows: 'The filing lists no holdings.',
        colSecurity: 'Security',
        colAmount: 'Amount',
        colOwnership: 'Ownership',
        colPrice: 'Exercise price',
        colExpires: 'Expires',
        shares: (n: string) => `${n} shares`,
        convertsInto: (n: string, title: string) => `converts into ${n} ${title}`,
        direct: 'Direct',
        indirect: (nature: string | null) => (nature ? `Indirect: ${nature}` : 'Indirect'),
        priceNotStated: 'Not stated, see the filing notes',
        noDate: 'Not stated',
        derivative: 'derivative',
        showAll: (n: number) => `Show all ${n}`,
        showFewer: 'Show fewer',
      },
      acquired: 'acquired',
      disposed: 'disposed',
      derivative: 'derivative',
      director: 'Director',
      officer: 'Officer',
      tenPercent: '10% owner',
      zeroPrice: 'no price',
    },
    shortData: {
      title: 'Short interest and short volume',
      interestDef:
        'Short interest: shares sold short and not yet covered, reported by brokers to FINRA twice a month and published with a lag.',
      volumeDef:
        'Short volume: shares sold short during a day, reported daily from off-exchange venues. It is not short interest, and it includes short sales by market makers.',
      none: 'No short data stored for this ticker (ETFs often have none).',
      colSettle: 'Settlement date',
      colShort: 'Shares short',
      colAdv: 'Average daily volume',
      colDtc: 'Days to cover',
      colDay: 'Day',
      colTotal: 'Total volume',
      colShortVol: 'Short volume',
      colRatio: 'Short share of volume',
      lag: 'Short interest settles on the 15th and the last business day, and is published about a week later.',
    },
    news: {
      title: 'News',
      note: 'Grouped so one story from several outlets counts once, shown at its earliest time. Source tier and opinion are labelled. Free-plan news comes from three publishers only.',
      none: 'No news stored for this ticker.',
      outlets: (n: number) => (n === 1 ? '1 outlet' : `${n} outlets`),
      opinion: 'Analysis or opinion',
      reporting: 'Reporting',
      tier: (n: number) => `Tier ${n}`,
    },
    dividends: {
      title: 'Dividends',
      none: 'No dividends stored for this ticker.',
      row: (ex: string, amount: string, pay: string | null) =>
        `Ex-dividend ${ex}: ${amount}${pay ? `, paid ${pay}` : ''}`,
      upcoming: 'upcoming',
    },

    markersNote:
      'Markers show 8-Ks of high or medium materiality, splits and ex-dividend dates. A filing accepted after the 4:00 pm ET close sits on the next trading day. Form 4s stay in the filings list.',
    noMarkers: 'No high or medium materiality 8-Ks or splits in this period.',
    summary: 'Summary',
    lastClose: 'Last close',
    change: 'Change',
    range: (n: number) => (n >= 252 ? '52-week range' : `Range over ${n} sessions`),
    trend: 'Trend',
    unavailable: 'Not enough history',
    trendLabels: {
      'above-both': 'Above the 50- and 200-day averages',
      'above-50-below-200': 'Above the 50-day, below the 200-day average',
      'below-50-above-200': 'Below the 50-day, above the 200-day average',
      'below-both': 'Below the 50- and 200-day averages',
      unknown: 'Needs 200 sessions of history',
    },
    provenance: (asOf: string, sessions: number, version: string) =>
      `Source: Massive daily bars, end-of-day, split-adjusted. Last bar ${asOf}, ${sessions} sessions. Indicators: ${version}.`,
    current: 'Current: the latest completed session is stored',
    stale: (have: string, want: string) => `STALE: latest bar is ${have}, expected ${want}`,
    filings: 'Filings',
    filingsNote: 'Filing times are when the SEC accepted them, shown in ET.',
    noFilings: 'No filings stored for this company.',
    colWhen: 'Accepted (ET)',
    colForm: 'Filing',
    colWhat: 'What it says',
    colLag: 'Reporting lag',
    viewOnSec: 'View on SEC',
    materiality: { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unrated' },
    marsadDefault: 'Marsad default rating',
    missing: 'Not available on the free plan',
    placeholdersTitle: 'More on this company',
    placeholders: [
      {
        name: 'Earnings against estimates, surprise and implied move',
        state: 'Requires a higher Massive plan',
        why: 'Estimates come from Benzinga data, which the free plan does not include. Reported results and the price move after each release are in Earnings history above; the implied move needs options data.',
      },
      {
        name: 'Analyst actions (opinion)',
        state: 'Requires a higher Massive plan',
        why: 'Ratings and price targets are partner data.',
      },
      {
        name: 'Valuation percentiles against the 5-year history',
        state: 'Requires a higher Massive plan',
        why: 'A 5-year price history is beyond the free plan, which allows 2 years of daily bars. Statements come from SEC filings instead.',
      },
      {
        name: '10-Q sections and quarter-to-quarter risk changes',
        state: 'Not built',
        why: 'The annual-report comparison above uses the vendor’s 10-K sections. That feed covers 10-Ks only, so quarterly reports would need the filing documents themselves.',
      },
      {
        name: '13F holders',
        state: 'Not built',
        why: 'Funds report holdings up to 45 days after quarter end. The vendor serves 13F filings by the fund that filed them, not by the stock, so a list of holders of this company needs the SEC quarterly 13F data sets, which are not loaded.',
      },
    ],
  },

  regime: {
    title: 'Regime',
    intro:
      'What kind of market this is, from documented rules (ADR 0009), computed at the end of each day from stored data. It describes the market; it does not forecast it.',
    none: 'No regime has been computed yet. The regime job runs after the FRED job.',
    labelTitle: 'Market regime',
    labels: {
      stress: 'Stress',
      bear: 'Bear',
      recovery: 'Recovery',
      'bull-calm': 'Bull, calm',
      'bull-correction': 'Bull, correction',
      'insufficient-data': 'Insufficient data',
    } as Record<string, string>,
    reasons: {
      'vix-high': 'VIX is at or above 30.',
      backwardation:
        'VIX is at or above VIX3M (backwardation) and the S&P 500 is below its 50-day average.',
      'below-falling-200': 'The S&P 500 is below a falling 200-day average.',
      recovering:
        'Within 63 sessions of stress or a bear, above the 50-day average, and still at least 5% below the high.',
      calm: 'Above both averages, less than 5% below the high, and VIX below 20.',
      pullback: 'An uptrend with a pullback or higher volatility.',
      insufficient: "Needs 252 sessions of S&P 500 history and the day's VIX.",
    } as Record<string, string>,
    asOf: (date: string, version: string) => `As of the close on ${date}. Rules ${version}.`,
    since: (date: string, n: number) =>
      `This label since ${date} (${n} session${n === 1 ? '' : 's'}).`,
    pastYear: 'Past year, sessions per label',
    inputs: {
      sp500: 'S&P 500 close',
      sma50: '50-day average',
      sma200: '200-day average',
      rising: 'rising',
      falling: 'falling',
      drawdown: 'From the 252-day high',
      vix: 'VIX',
      vix3m: 'VIX3M',
      ratio: 'VIX over VIX3M',
    },
    inputsSource:
      'Source: FRED (S&P 500, VIXCLS, VXVCLS). The S&P 500 on FRED goes back 10 years, so labels start in November 2017.',
    recession: {
      title: 'Recession filter',
      level: {
        low: 'Low',
        elevated: 'Elevated',
        high: 'High',
        unavailable: 'Not enough data',
      } as Record<string, string>,
      summary: (available: number, triggered: number) =>
        `${triggered} of ${available} available signals triggered (5 signals in total).`,
      rule: 'High when the Sahm rule triggers or three signals do; elevated with one or two; low with none. Each value is used only from the day it was published.',
      colSignal: 'Signal',
      colState: 'State',
      colValue: 'Value',
      colRule: 'Triggers when',
      colAsOf: 'Data for',
      states: { triggered: 'Triggered', clear: 'Clear', unavailable: 'No data' } as Record<
        string,
        string
      >,
      names: {
        sahm: 'Sahm rule (real time)',
        curve: 'Yield curve, 10-year minus 3-month',
        credit: 'High-yield spread',
        claims: 'Jobless claims, 4-week average',
        nfci: 'Financial conditions (NFCI)',
      } as Record<string, string>,
      rules: {
        sahm: 'at or above 0.50',
        curve: 'below zero now, or on 20 of the last 378 sessions',
        credit: 'at or above 6.0 points, or up 1.5 points over 63 sessions',
        claims: 'at least 20% above the lowest 4-week average of the previous 52 weeks',
        nfci: 'above zero (tighter than average)',
      } as Record<string, string>,
      curveDetail: (n: number) => `inverted on ${n} of the last 378 sessions`,
      creditDetail: (change: string) => `${change} points over 63 sessions`,
      claimsDetail: (low: string) => `lowest 4-week average in the previous year ${low}`,
      creditNote:
        'FRED keeps the high-yield spread for 3 years only, so before November 2023 this signal has no data.',
    },
    study: {
      title: 'What happened next (event study)',
      note: (from: string, to: string) =>
        `S&P 500 return after each episode: the first day of a run of the label, with new episodes at least 63 sessions apart so they do not overlap. Data ${from} to ${to}. "All days" is the benchmark.`,
      colCondition: 'Condition',
      horizon: (n: number) =>
        n === 21
          ? '1 month (21 sessions)'
          : n === 63
            ? '3 months (63 sessions)'
            : n === 126
              ? '6 months (126 sessions)'
              : `${n} sessions`,
      cell: (median: string, q1: string, q3: string, n: number) =>
        `median ${median}, middle half ${q1} to ${q3}, n ${n}`,
      insufficient: (n: number) =>
        `Insufficient history: ${n} episode${n === 1 ? '' : 's'}, 30 needed`,
      vix30: 'VIX at or above 30',
      proxy: 'VIX at or above 30, recession filter not high',
      allDays: 'All days (benchmark)',
      depth:
        'With 10 years of S&P 500 data most labels have fewer than 30 independent episodes. A longer price history would need a paid data plan or a proxy index; see ADR 0009.',
    },
    breadth: {
      title: 'Marsad universe breadth',
      intro:
        'The 1,000 most traded US common stocks and ETFs (by 20-day dollar volume), rebuilt at the start of each month from data before it. This is Marsad\u2019s own universe, not official index breadth.',
      none: 'No breadth has been computed yet. The first run of the breadth job fills 2 years of history.',
      asOf: (date: string, members: number) => `As of the close on ${date}, ${members} members.`,
      above50: 'Above their 50-day average',
      above200: 'Above their 200-day average',
      outOf: (n: number) => `out of ${n.toLocaleString('en-US')} with enough history`,
      netHighs: 'New 52-week highs minus lows',
      highsLows: (h: number, l: number) => `${h} highs, ${l} lows`,
      advDec: 'Advancers and decliners',
      advDecValue: (a: number, d: number) => `${a} up, ${d} down`,
      upVolume: 'Share of volume in advancing names',
      avg10: '10-day average advancing share',
      mcclellan: 'McClellan volume oscillator (summation)',
      zweig: 'Zweig breadth thrust',
      zweigLast: (date: string) => `Last fired ${date}.`,
      zweigNone: 'Not fired in the stored history.',
      zweigRule:
        'Fires when the 10-day average advancing share rises from below 0.40 to above 0.615 within 10 sessions.',
      monthAgo: (pct: string) => `a month ago ${pct}`,
      warmup:
        'The free plan gives 2 years of history, so the 200-day and 52-week measures need most of the first year to warm up; the counts show how many members they rest on.',
      source: (versions: string) =>
        `Source: Massive grouped daily (end of day, unadjusted, splits applied by Marsad). Rules ${versions}.`,
      suspect: (n: number) =>
        `${n} member${n === 1 ? '' : 's'} left out today: a one-day move over 50% with no split.`,
    },
    fearGreed: {
      title: 'Fear and Greed composite',
      intro:
        'Marsad\u2019s own reading, after CNN\u2019s published method: seven components, each scored 0 to 100 by where today\u2019s value sits among its last 504 sessions (2 years), then averaged. High is greed, low is fear.',
      none: 'No day has enough components yet (4 of 7 are needed). It fills in after the breadth backfill and two years of SPY and IEF bars.',
      headline: (value: number, label: string) => `${value}, ${label}`,
      count: (available: number) => `${available} of 7 components available`,
      asOf: (date: string, version: string) => `As of the close on ${date}. Rules ${version}.`,
      newer: (date: string, available: number) =>
        `${date} has only ${available} of 7 components so far; it fills in when its sources update.`,
      monthAgo: (value: number, date: string) => `A month ago (${date}): ${value}.`,
      labels: {
        'extreme-fear': 'Extreme fear',
        fear: 'Fear',
        neutral: 'Neutral',
        greed: 'Greed',
        'extreme-greed': 'Extreme greed',
      } as Record<string, string>,
      bands:
        'Bands: 0 to 24 extreme fear, 25 to 44 fear, 45 to 55 neutral, 56 to 75 greed, 76 to 100 extreme greed.',
      colComponent: 'Component',
      colValue: 'Value today',
      colScore: 'Score (0 to 100)',
      colSource: 'Source',
      names: {
        momentum: 'Market momentum: S&P 500 against its 125-day average',
        strength: 'Stock price strength: net new 52-week highs',
        breadth: 'Breadth: McClellan volume summation',
        putCall: 'Put/call ratio, 5-day average',
        junk: 'Junk bond demand: high-yield minus investment-grade spread',
        volatility: 'Volatility: VIX against its 50-day average',
        safeHaven: 'Safe-haven demand: SPY minus IEF, 20-day returns',
      } as Record<string, string>,
      reasons: {
        'no-source': 'Not available: needs an options data plan.',
        'no-data': 'No value for this day.',
        'short-history': 'Not counted: fewer than 252 sessions of history.',
      } as Record<string, string>,
      windowNote: (n: number) => `percentile over ${n} sessions`,
      method:
        'A component counts only with a value for that day; nothing is carried forward. Prices are price returns. Stock price strength needs a 52-week measure plus a year of its own history, so it joins about two years after breadth starts (around December 2026).',
    },
    capitulation: {
      title: 'Capitulation watch',
      intro:
        'Fires at the close when all four conditions hold. It is context for a long-term decision, not a signal to act on alone. Marsad never places orders.',
      state: {
        on: 'On',
        off: 'Off',
        unavailable: 'Not enough data',
      } as Record<string, string>,
      none: 'Not computed yet. The sentiment job runs after the FRED and breadth jobs.',
      asOf: (date: string, version: string) => `As of the close on ${date}. Rules ${version}.`,
      lastOn: (date: string) => `Last on: ${date}.`,
      neverOn: 'Not on in the stored history.',
      colCondition: 'Condition',
      colValue: 'Value',
      colRule: 'Needs',
      colMet: 'Met',
      needs: (key: string, vix: number, pct: number, composite: number) =>
        ({
          vix: `at or above ${vix}`,
          breadth: `at most ${pct}%`,
          composite: `at most ${composite}`,
          recession: 'not high',
        })[key] ?? key,
      met: { true: 'Yes', false: 'No', null: 'No data' } as Record<string, string>,
      names: {
        vix: 'VIX close',
        breadth: 'Marsad universe above its 50-day average',
        composite: 'Fear and Greed composite',
        recession: 'Recession filter',
      } as Record<string, string>,
      planTitle: (date: string) => `Staged-entry plan for index ETFs (episode from ${date})`,
      planIntro:
        'Conditions for adding in thirds. You decide whether and when to act, and place any order yourself in Sahm.',
      steps: {
        1: (level: string) => `One third at the trigger close (SPY ${level}).`,
        2: (level: string) =>
          `One third on a successful retest: SPY comes back within 2% of the selloff low (${level}) at least 5 sessions after it and closes at or above it.`,
        3: (level: string) => `One third on a SPY close above its 50-day average (now ${level}).`,
      } as Record<number, (level: string) => string>,
      status: {
        met: (date: string) => `Met on ${date}.`,
        waiting: 'Waiting.',
        paused: 'Paused: the recession filter turned high.',
        expired: 'Expired: 126 sessions passed.',
      },
      paused: (date: string) =>
        `Paused since ${date}: the recession filter read high, so the remaining thirds are not due. Review what you hold.`,
      review: (date: string) =>
        `Review: SPY closed more than 10% below the trigger close on ${date}. The bear case may be playing out.`,
      exit: 'Exit conditions: stop adding if the recession filter turns high; review every holding if SPY closes more than 10% below the trigger close; the plan expires after 126 sessions.',
      bearCase:
        'Bear case: in 2008 the VIX stayed above 35 for weeks while the decline continued, and in 2022 the market made new lows months after its March volatility spike. Staging limits the damage if this is one of those episodes.',
      history:
        'Marsad event study, the longer-history proxy: VIX close at or above 30 with the recession filter not high.',
      screen:
        'The quality-at-discount screen this watch should refresh is not built yet (a later phase).',
      rules: (vix: number, pct: number, members: number, composite: number) =>
        `Rules: VIX at or above ${vix}; at most ${pct}% of the universe above its 50-day average (with at least ${members} members that have 50 sessions); composite at or below ${composite}; recession filter not high. ADR 0011.`,
    },
    geopolitics: {
      title: 'Geopolitical panel',
      intro:
        'How often market news mentions each topic, beside the assets that usually react. Counted by documented keyword rules (ADR 0012), not by a model.',
      none: 'No topic counts yet. The topics job runs daily at 01:20 UTC and fills 35 days on its first run.',
      asOf: (date: string, recent: number, baseline: number) =>
        `7 days to ${date} (${recent} day${recent === 1 ? '' : 's'} stored), against the 4 weeks before (${baseline} day${baseline === 1 ? '' : 's'} stored).`,
      colTopic: 'Topic',
      colLast7: 'Articles, last 7 days',
      colShare: 'Share of all articles',
      colBaseline: 'Weekly average, 4 weeks before',
      colRatio: 'Ratio',
      colLatest: 'Latest headline',
      ratio: (v: string) => `${v} times`,
      noRatio: 'No baseline',
      names: {
        conflict: 'Conflict',
        sanctions: 'Sanctions',
        tariffs: 'Tariffs and trade',
        elections: 'Elections',
        centralBanks: 'Central banks',
        energy: 'Energy',
      } as Record<string, string>,
      assetsTitle: 'Assets that usually react',
      oil: 'WTI crude oil (USD a barrel)',
      dollar: 'Broad US dollar index',
      dgs10: '10-year Treasury yield',
      gld: 'Gold (GLD)',
      ita: 'Defense (ITA)',
      iyt: 'Transports (IYT)',
      source:
        'Source: Massive market-wide news, mostly investment press (The Motley Fool, Zacks, GlobeNewswire), not wire services; so this counts coverage, not events. Assets: FRED DCOILWTICO, DTWEXBGS and DGS10; Massive daily bars for GLD, ITA and IYT.',
    },
    ordinal: (n: number) => {
      const k = n % 100;
      const suffix =
        k >= 11 && k <= 13
          ? 'th'
          : n % 10 === 1
            ? 'st'
            : n % 10 === 2
              ? 'nd'
              : n % 10 === 3
                ? 'rd'
                : 'th';
      return `${n}${suffix}`;
    },
    context: (gpr: string, epu: string) =>
      `Context: geopolitical risk (GPR) at the ${gpr} percentile of the past year; policy uncertainty (EPU) at the ${epu}.`,
    volatility: {
      title: 'Volatility and its term structure',
      vix: 'VIX',
      vix3m: 'VIX3M (3-month)',
      ratio: 'VIX over VIX3M',
      contango: 'Below 1: contango, the usual calm shape.',
      backwardation: 'At or above 1: backwardation, near-term fear above longer-term.',
      source: 'Source: FRED VIXCLS and VXVCLS (official daily closes).',
    },
    credit: {
      title: 'Credit and the curve',
      hy: 'High-yield spread',
      ig: 'Investment-grade spread',
      hyIg: 'High-yield minus investment-grade',
      dgs10: '10-year Treasury yield',
      curve3m: '10-year minus 3-month',
      curve2y: '10-year minus 2-year',
      source:
        'Source: FRED (ICE BofA spreads, Treasury yields). Spreads and yields in percentage points.',
    },
    uncertainty: {
      title: 'Geopolitical risk and policy uncertainty',
      gpr: 'Geopolitical Risk index (daily)',
      epu: 'Economic Policy Uncertainty (daily)',
      source:
        'Sources: Caldara and Iacoviello daily GPR index; Baker, Bloom and Davis daily EPU index via FRED. Both are counts of newspaper coverage and are noisy day to day.',
    },
    colMeasure: 'Measure',
    colLatest: 'Latest',
    colChange: 'Change over 1 month',
    colPercentile: '1-year percentile',
    colAsOf: 'As of',
    noData: 'No data stored',
    ofN: (n: number) => `of ${n} days only`,
  },

  status: {
    title: 'System status',
    sources: 'Data sources',
    jobs: 'Recent job runs',
    alerts: 'System alerts',
    noAlerts: 'No system alerts yet. A source that goes quiet or recovers is recorded here.',
    colWhen: 'Raised',
    colEvent: 'Event',
    colHeadline: 'What happened',
    colPaused: 'Rules paused',
    heartbeat: (ago: string) => `Heartbeat last ran ${ago} ago.`,
    heartbeatNone: 'Heartbeat has not run yet, so stale feeds are not being watched.',
    heartbeatLate: (ago: string) =>
      `Heartbeat last ran ${ago} ago. Stale feeds may be going unreported.`,
    events: { stale: 'STALE', recovered: 'RECOVERED', mismatch: 'MISMATCH' },
    colSource: 'Source',
    colState: 'State',
    colTier: 'Plan tier',
    colLast: 'Last message',
    colLatency: 'Latency',
    colNote: 'Note',
    colJob: 'Job',
    colStarted: 'Started',
    colStatus: 'Result',
    colRows: 'Rows',
    colError: 'Error',
    never: 'Never',
    none: 'None',
    noJobs: 'No jobs have run yet. Ingestion starts in Phase 1.',
    dbOk: (at: string) => `Database reachable, checked ${at}`,
    dbError: (msg: string) => `Database unreachable: ${msg}`,
  },
  errors: { generic: 'Something went wrong.' },
} as const;
