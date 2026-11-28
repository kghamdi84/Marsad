/**
 * Portfolio strings.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

/** Portfolio views (ADR 0048): review, holdings, analysis, performance, income, news; and the Watch dividend calendar. */
export const portfolio = {
  na: 'Data unavailable',
  loading: 'Loading…',
  notTracked: 'Not tracked',
  noHoldings: 'No open holdings. Add them under Holdings (Import Sahm CSV).',
  pageIntro:
    'What you hold, read against your own exit conditions and limits. Holding is never the default: every position shows how it ends. Prices are end of day; Marsad never places orders.',
  unclassified: 'Unclassified',
  above: 'Above your limit',
  within: 'Within your limits',
  limits: {
    label: 'Your limits against the book',
    name: {
      largest: 'Largest position',
      top5: 'Top 5 positions',
      beta: 'Portfolio beta',
      cash: 'Cash',
      'open-risk': 'Total open risk',
      sector: 'Largest sector',
      volatility: 'Volatility',
      drawdown: 'Largest fall',
      'below-cost': 'Positions below cost',
    },
    unset: 'No limit set',
    limit: (v: string, minimum: boolean) => `limit ${minimum ? 'at least ' : ''}${v}`,
    breachesLabel: 'Breaches',
    breach: (
      name: string,
      subject: string | null,
      value: string,
      limit: string,
      minimum: boolean,
      ofEquity: boolean,
    ) =>
      `${name}${subject ? ` (${subject})` : ''}: ${value}${ofEquity ? ' of equity' : ''}; your limit is ${minimum ? 'at least ' : ''}${limit}.`,
    riskUnknown: (n: number, list: string) =>
      `Open risk unknown for ${n} holding${n === 1 ? '' : 's'} without a stop (${list}): the figure is the known part only.`,
    source: {
      council: 'Set by the council at your request on 28 Nov 2026; change any time',
      user: 'Your stored limits',
      none: 'No limit set',
    },
    setByYou: (date: string) => `Set by you on ${date}; change any time`,
    edit: 'Change them in Settings',
    form: {
      title: 'Portfolio limits',
      intro:
        'Your own limits for your book, shown on Portfolio against your actual figures with a count of breaches. A breach is a fact with its figures, never a block or advice. Leave a box empty for no limit.',
      label: 'Portfolio limits',
      largestPosition: 'Largest single position (% of equity)',
      top5: 'Top 5 positions together (% of equity)',
      minCash: 'Minimum cash (% of equity)',
      portfolioBeta: 'Maximum portfolio beta to SPY',
      openRisk: 'Maximum total open risk (% of equity)',
      openRiskNote:
        'Open risk is the distance to each stop times its shares; a holding with no stop counts as risk unknown, never zero.',
      save: 'Save limits',
      saved: 'Saved.',
      invalid: 'Check the highlighted boxes.',
      errNumber: 'Enter a number, or leave it empty.',
      errRange: (max: string) => `Enter a number above 0 and at most ${max}.`,
      errRangeCash: 'Enter a number from 0 to below 100.',
      version: (n: number, date: string) => `Version ${n}, set ${date}.`,
      placeholder: 'None',
      none: 'No limits stored yet: every limit reads "No limit set".',
    },
  },
  viewsLabel: 'Portfolio view',
  views: {
    review: 'Review',
    holdings: 'Holdings',
    analysis: 'Analysis',
    performance: 'Performance',
    income: 'Income',
    news: 'News',
  },
  mix: {
    title: 'Portfolio vs SPY',
    label: 'Current holdings at today’s weights, not your actual result',
    rangeLabel: 'Chart span',
    ranges: { d60: '60D', m1: '1M', m3: '3M', m6: '6M', y1: '1Y' },
    portfolio: 'Current holdings',
    spy: 'SPY',
    aria: (port: string, spy: string, from: string, to: string) =>
      `Current holdings ${port}, SPY ${spy}, from ${from} to ${to}.`,
    span: (n: number, from: string, to: string) =>
      `${n} sessions, ${from} to ${to}. Today’s shares valued at each stored close; past buys and sales are not in it.`,
    shorter: (n: number) => `Fewer than the ${n} sessions asked for are stored.`,
    leftOut: (list: string) => `Left out (a close missing in the span): ${list}.`,
    none: 'Not enough stored bars for SPY and the holdings to draw this.',
  },
  summary: {
    label: 'Portfolio summary',
    value: 'Total value',
    asOf: (date: string) => `At the close of ${date}`,
    unpriced: (list: string) => `No stored close, left out: ${list}`,
    day: 'Day change',
    open: 'Unrealized result',
    onCost: (pct: string, cost: string) => `${pct} on cost ${cost}`,
    cash: 'Cash',
    cashSub: 'Marsad does not store a cash balance',
    movers: 'Top movers today',
    noMoves: 'No change stored',
    dayOf: (prev: string, date: string) => `Close of ${date} against ${prev}`,
  },
  tableTitle: 'Holdings',
  tableInfo:
    'One row per ticker, lots combined (shares added, cost averaged by shares). Prices are stored end-of-day closes from Massive; each column set names its source and date.',
  table: {
    setLabel: 'Columns',
    sets: {
      holdings: 'Holdings',
      performance: 'Performance',
      dividends: 'Dividends',
      earnings: 'Earnings',
      technicals: 'Technicals',
    },
    aria: (set: string) => `Holdings table, ${set} columns`,
    ticker: 'Ticker',
    shares: 'Shares',
    avgCost: 'Avg cost',
    last: 'Last close',
    dayUsd: 'Day $',
    dayPct: 'Day %',
    weight: '% of value',
    value: 'Value',
    gainUsd: 'Unrealized $',
    gainPct: 'Unrealized %',
    opened: 'Opened',
    horizon: 'Horizon',
    horizons: { long: 'Long term', swing: 'Swing' },
    horizonNone: 'Not set',
    periods: {
      w1: '1W',
      m1: '1M',
      m3: '3M',
      m6: '6M',
      ytd: 'YTD',
      y1: '1Y',
    },
    shortBars: 'Not enough stored bars',
    ttm: 'Dividends, 12 months',
    noDividends: 'None stored',
    yield: 'Yield',
    exDate: 'Ex-date',
    next: 'Next',
    latest: 'Latest',
    income: 'Annual income',
    nextEarnings: 'Next earnings',
    noEarnings: 'No date stored',
    estimated: '(estimated)',
    days: 'Days',
    eps: 'Consensus EPS',
    source: 'Source',
    src: {
      massive: 'Massive',
      tauric: 'Tauric calendar',
      'tauric-calendar': 'Tauric calendar',
      'marsad-estimate': 'Marsad estimate from SEC filings',
    },
    readings: 'Readings',
    fromSummary: (date: string, extra: string) =>
      `From the nightly summary (ticker-summary-1), session ${date}.${extra ? ` ${extra}` : ''}`,
    readingsBars: 'Readings are counted from the stored bars.',
    fromBars: (tks: string) => `Computed from bars, no current nightly summary row: ${tks}.`,
    nOfM: (bull: number, n: number) => `${bull} of ${n} bullish`,
    vs50: 'vs SMA 50',
    vs200: 'vs SMA 200',
    rsi: 'RSI 14',
    sources: {
      holdings:
        'Shares, cost and dates from your holdings; closes from stored Massive daily bars (end of day). Day change: the newest close against the one before.',
      performance:
        'Returns from stored daily bars (company-brief-1 periodReturn): 1W 5, 1M 21, 3M 63, 1Y 252 sessions; YTD from the last close of the previous year.',
      dividends:
        'Cash dividends with ex-dates in the 365 days to the last close, from Massive /stocks/v1/dividends and Tauric’s calendar (portfolio-check-1). Yield is that sum over the last close. Annual income is that sum times your shares.',
      earnings:
        'Tauric’s calendar (one consensus EPS) when it states a date; otherwise Marsad’s estimate from SEC results filings, never a confirmed date.',
      technicals:
        'From the one technical engine (technical-1) on stored daily bars: the count of bullish readings among its moving averages and indicators, the last close against its 50- and 200-session simple averages, and the 14-session RSI. A description of the chart, not advice.',
    },
  },
  review: {
    title: 'Review',
    info: 'Each holding against its own exit plan, from stored closes and your exit rules. Equity here is the priced holdings value, because Marsad does not track cash. Marsad states the facts and the rules; you decide.',
    subLabel: 'Review section',
    sub: { exits: 'Exit plan', coming: 'Coming up', moves: 'Weekly moves' },
    openRisk: 'Total open risk to the stops',
    openRiskSub: (risk: string, equity: string) =>
      `${risk} lost if every stop fills exactly, of ${equity} equity`,
    openRiskNoStop: (list: string) => `Risk unknown, not counted as zero (no stop): ${list}.`,
    riskUnknown: (n: number) => `+ risk unknown on ${n}`,
    rowsLabel: 'Holdings by exit plan',
    missing: 'Exit rules missing',
    met: (n: number) => `${n} exit condition${n === 1 ? '' : 's'} met`,
    noneMet: 'No exit condition met',
    lot: (shares: number, price: string, date: string) =>
      `${shares} shares · close ${price}${date ? ` (${date})` : ''}`,
    stopDistance: 'Fall to stop',
    stopDistanceNote: 'How far the close must fall to reach the stop',
    noStop: 'No stop',
    toStop: (stop: string) => `to ${stop}`,
    atrs: 'In ATRs (14)',
    atrValue: (v: string) => `${v} ATR`,
    atRisk: 'Dollars at risk',
    unbounded: 'Not bounded: no stop',
    vsCap: 'Size against the cap',
    capValue: (v: string) => `${v} of cap`,
    sessions: 'Sessions held',
    earnings: 'Next earnings',
    noEarnings: 'No date stored',
    sizer: (allowed: number, held: number, capped: boolean) =>
      `The sizer allows ${allowed} shares at today’s close and stop${capped ? ' (set by the position cap)' : ''}; you hold ${held}.`,
    sizerError: (why: string) => `The sizer cannot size this at today’s close: ${why}`,
    sizerNone: 'The sizer needs a stop and a stored close.',
    source: (risk: string, cap: string) =>
      `Sizer defaults: ${risk} risk per trade on the priced holdings value, position cap ${cap} (portfolio-1 positionSize). Exit conditions from portfolio-1 exitSignals; ATR 14 from indicators.ts; fall to stop as (close minus stop) over close (fallToStop), the figure the earnings-guard alert uses.`,
    coming: {
      none: 'No dated events stored for your holdings',
      kind: {
        earnings: 'Earnings',
        'ex-dividend': 'Ex-dividend',
        catalyst: 'Catalyst',
      },
      eps: (v: string) => `consensus EPS ${v}`,
      noEps: 'no estimate stored',
      amount: (v: string) => `${v} a share`,
      source: {
        'tauric-calendar': 'Tauric calendar',
        'marsad-estimate': 'Marsad estimate from SEC results filings',
        massive: 'Massive dividends',
        'tauric-thesis': 'Tauric AI thesis (not Marsad’s view)',
      },
      estimated: 'estimated, not confirmed',
      timing: (v: string) => `timing: ${v}`,
      window: (from: string, to: string) => `From ${from} to ${to} (8 weeks).`,
      undated: (n: number) => `${n} catalyst${n === 1 ? '' : 's'} without a date not shown.`,
    },
    moves: {
      none: (limit: string) => `No holding moved more than ${limit} over the last five sessions.`,
      span: (a: string, from: string, b: string, to: string) => `${a} (${from}) to ${b} (${to})`,
      alertsTitle: 'Marsad alerts on holdings, last 7 days',
      noAlerts: 'No alerts on your holdings in the last 7 days.',
      source: (limit: string) =>
        `Moves above ${limit} over five stored sessions (closes from Massive). Facts only; no alert is raised from this page.`,
    },
  },
  analysis: {
    title: 'Analysis',
    info: 'portfolio-check-1: each measure from stored data beside your limit or Marsad\u2019s stated check rule. There is no single score, and nothing here says what to do.',
    subLabel: 'Analysis section',
    sub: {
      check: 'Check',
      attention: 'Needs attention',
      groups: 'Groups',
      distribution: 'Distribution',
    },
    check: {
      rowsLabel: 'Marsad\u2019s check rules',
      pastRule: 'Past the rule',
      withinRule: 'Within the rule',
      name: {
        largest: 'Largest position',
        cash: 'Cash',
        'open-risk': 'Total open risk',
        top5: 'Top 5 positions',
        sector: 'Largest sector',
        beta: 'Portfolio beta to SPY',
        volatility: 'Volatility, 1 year',
        drawdown: 'Largest fall, 1 year',
        'below-cost': 'Positions below cost',
      },
      rule: (id: string, subject: string | null, limit: string) => {
        const s = subject ? `${subject}. ` : '';
        if (id === 'largest') return `${s}Share of priced value; Marsad flags above ${limit}.`;
        if (id === 'sector') return `${s}Share of priced value; Marsad flags above ${limit}.`;
        if (id === 'beta') return `Value-weighted; Marsad flags above ${limit}.`;
        if (id === 'volatility')
          return `Annualized, current mix; Marsad flags above ${limit}. Needs 60 daily returns.`;
        if (id === 'drawdown')
          return `Peak to trough of the current mix; Marsad flags a fall larger than ${limit}.`;
        return `Share of positions priced under their cost; Marsad flags above ${limit}.`;
      },
      betaNote: (window: number, minObs: number, n: number, of: number) =>
        `Beta to SPY: least-squares slope of daily returns over the last ${window} common sessions (exposure-1), at least ${minObs} needed. Coverage: ${n} of ${of} holdings.`,
      betaAssumed: (list: string) => `Counted as 1 (too little history): ${list}.`,
      sectors: 'Sector allocation',
      sectorSource: (limit: string) =>
        `Sector: the holding’s own sector fund, else Tauric’s GICS sector, else Unclassified. The tick marks Marsad’s ${limit} check rule.`,
      performers: 'Performers since cost',
      belowCost: (n: number, of: number) => `${n} of ${of} positions are below cost.`,
      options: 'Options exposure',
      noOptions: 'No open option positions. Add them under Holdings.',
      optionLine: (premium: string, maxLoss: string, dte: number) =>
        `premium at entry ${premium} · max loss ${maxLoss} · ${dte} days to expiry`,
      optionsSource:
        'From your option positions (options-pos-1). Current option values need the options data plan, so only entry premium and the defined maximum loss are shown.',
      written: 'Written by Marsad from the numbers above',
      source: (v: string) =>
        `${v}; closes from stored Massive daily bars. Volatility and largest fall use today’s shares at past closes, not your account history.`,
    },
    attention: {
      none: 'No rule fired.',
      title: {
        'down-from-cost': 'Down 40% or more from cost',
        'loss-share': 'One position holds a large share of the loss',
        'high-beta': 'High beta positions',
        'book-loss': 'Whole book below cost',
        'biggest-gainer': 'Biggest gainer',
      },
      positive: 'Positive',
      note: 'Note',
      fact: (id: string, value: string, weight: string) => {
        if (id === 'down-from-cost')
          return `Furthest below cost: ${value}. Combined weight ${weight}.`;
        if (id === 'loss-share') return `Largest share of the total unrealized loss: ${value}.`;
        if (id === 'high-beta') return `${value} position(s), combined weight ${weight}.`;
        if (id === 'book-loss') return `Unrealized result of the whole book: ${value} on cost.`;
        return `Unrealized result ${value} on cost.`;
      },
      rule: (id: string, limit: string) => {
        if (id === 'down-from-cost') return `Rule: a position ${limit} or more below its cost.`;
        if (id === 'loss-share')
          return `Rule: one position holding more than ${limit} of the total unrealized loss.`;
        if (id === 'high-beta') return `Rule: beta to SPY above ${limit}.`;
        if (id === 'book-loss') return `Rule: the whole book more than ${limit} below cost.`;
        return 'Rule: the largest unrealized gain in dollars.';
      },
      notMet: (title: string, rule: string) => `Not met: ${title}. ${rule}`,
      noExit: 'Exit rules missing',
      stopAt: (levels: string) => `Exit condition: stop ${levels}`,
      otherRules: 'Exit condition: target, trend break or time stop (no stop)',
    },
    groups: {
      name: 'Name',
      tableAria: (g: string) => `${g} positions`,
      source:
        'Grouped by the holding’s own sector fund, else Tauric’s sub-industry, else Unclassified. No invented theme names.',
    },
    dist: {
      assets: 'Asset split',
      stocks: 'Stocks',
      etfs: 'ETFs',
      options: 'Options',
      optionsValue: (v: string, n: number) => `${v} premium at entry (${n} open)`,
      cash: 'Cash',
      assetsSource:
        'ETF: a sector or index fund Marsad knows, or one with a stored N-PORT report; every other ticker counts as a stock. Options at entry premium; current values need the options data plan.',
      dimLabel: 'Distribution by',
      dims: {
        sector: 'Sector',
        marketCap: 'Market cap',
        dividend: 'Dividend',
        beta: 'Beta',
        pe: 'P/E',
      },
      listAria: (d: string) => `Holdings by ${d}`,
      sliceLabel: (k: string, n: number) => `${k} (${n})`,
      major: (k: string, list: string) => `Largest holdings in ${k}: ${list}.`,
      bucket: {
        micro: 'Micro (under $300M)',
        small: 'Small ($300M to $2B)',
        mid: 'Mid ($2B to $10B)',
        large: 'Large ($10B to $200B)',
        mega: 'Mega ($200B and over)',
        low: 'Under 0.8',
        market: '0.8 to 1.2',
        high: '1.2 to 2',
        'very-high': '2 and over',
        'under-15': 'Under 15',
        '15-25': '15 to 25',
        '25-40': '25 to 40',
        'over-40': '40 and over',
        'not-meaningful': 'Not meaningful (zero, negative or missing)',
        unavailable: 'Data unavailable',
      } as Record<string, string>,
      payer: 'Paid a dividend in 12 months',
      nonPayer: 'No dividend in 12 months',
      dimSource: {
        sector: 'Sector as in the check.',
        marketCap: 'Market cap from Tauric’s profile, with its price date there.',
        dividend: 'Stored Massive dividends and Tauric’s calendar, 365 days to the last close.',
        beta: 'Beta to SPY from stored bars (exposure-1).',
        pe: 'P/E from Tauric’s profile (pe_ratio).',
      },
      betaTitle: 'Portfolio beta (highest five)',
      peTitle: 'Portfolio P/E (highest five)',
      peFormula: (n: number, of: number, coverage: string) =>
        `Value-weighted harmonic mean of positive P/Es: total value over the sum of value / P/E (Tauric profile pe_ratio). Coverage: ${n} of ${of} holdings, ${coverage} of value.`,
      peNotMeaningful: (list: string) => `Not meaningful (negative, zero or missing P/E): ${list}.`,
      unavailable: [
        'Crowd insights and comparison with other investors: not available, Marsad has no other-investor data.',
        'Geographic allocation: not available, no source.',
      ],
    },
  },
  performance: {
    title: 'Performance',
    info: 'Closed trades from your Journal, in R (initial risk). Below 30 closed trades Marsad shows counts only, never a percentage or a mean.',
    tradesTitle: 'Closed trades',
    profitable: 'Profitable trades',
    profitableCount: (k: number, n: number) => `${k} of ${n} closed trades were profitable`,
    winLoss: 'Winners, losers, flat',
    winLossCount: (w: number, l: number, f: number) => `${w} winners, ${l} losers, ${f} flat`,
    withStop: 'With a stop (R known)',
    withStopCount: (n: number, of: number) => `${n} of ${of}`,
    adherenceSplit: 'Adherence 80+ against below 80',
    adherenceCount: (hi: number, lo: number) => `${hi} trades against ${lo} trades`,
    winRate: 'Win rate',
    meanReturn: 'Average return per closed trade',
    expectancy: 'Expectancy',
    avgWinLoss: 'Average win against average loss',
    daysHeld: 'Weekdays held, winners against losers',
    insufficient: (n: number, min: number) =>
      `Insufficient history (${n} of ${min} closed trades): counts only.`,
    tradesSource:
      'journal-1 rMultiple and adherence; portfolio-check-1 rPerformance. Weekdays held do not remove exchange holidays.',
    holdingsTitle: 'Current holdings',
    spyLine: (v: string) => `SPY ${v}`,
    monthlyTitle: 'Monthly, current holdings against SPY',
    partial: (from: string, to: string) => `${from} to ${to}`,
    mine: 'Holdings',
    monthlySource: (from: string, to: string) =>
      `Each month’s last stored close against the previous month’s, ${from} to ${to}. Today’s shares at past closes, not your actual result.`,
    activityTitle: 'Recent activity',
    noActivity: 'No trades or holdings recorded yet.',
    ret: 'Return',
    transactions: 'Transactions',
    lastAction: 'Last action',
    notHeld: 'Not held',
    actions: { opened: 'Opened', added: 'Added', closed: 'Closed' },
    activitySource:
      'From Journal trades (entries and exits) and open holdings lots. Return: unrealized on cost while held, else the last closed trade on entry.',
  },
  actual: {
    title: 'Your actual result',
    noTrades: 'No Journal trades yet, so there is no actual result to show.',
    noPeriod: 'No stored SPY session falls in the trades’ period yet.',
    period: (from: string, to: string, sessions: number, days: number) =>
      `${from} to ${to}: ${sessions} sessions, ${days} calendar days.`,
    twr: 'Time-weighted return',
    annualized: 'Annualized',
    notAnnualized: 'Not annualized: under 365 days',
    mwr: 'Money-weighted return (XIRR), a year',
    mwrNote: (method: string) =>
      `Solved by ${method === 'bisection' ? 'bisection' : 'Newton’s method'}`,
    spyTwr: 'SPY with the same cash flows, time-weighted',
    spySame: 'Each buy buys SPY and each sell sells SPY, same dollars, same day’s close',
    spyNegative:
      'A sell was larger than the SPY balance at the time, so the SPY balance went below zero',
    spyMwr: 'SPY with the same cash flows, money-weighted',
    flows: 'Money in and out',
    flowsValue: (dep: string, wd: string) => `${dep} in, ${wd} out`,
    endValue: (mine: string, spy: string) => `End value ${mine}; SPY ${spy}`,
    counts: 'Trades counted',
    countsValue: (n: number, closed: number, flows: number) =>
      `${n} ${n === 1 ? 'trade' : 'trades'}, ${closed} closed, ${flows} ${flows === 1 ? 'cash flow' : 'cash flows'}`,
    fees: (v: string) => `Fees ${v}`,
    missing: 'Sessions with a missing close',
    missingNote: (n: number) =>
      n === 0
        ? 'Every holding had a stored close'
        : `${n} closes carried from the last known price`,
    missingTitle: 'Closes carried from the last known price',
    excluded: (list: string) => `Not counted: ${list}.`,
    offSession: (n: number) =>
      `${n} ${n === 1 ? 'trade date falls' : 'trade dates fall'} on a weekend or holiday and count on the next session.`,
    method: 'What the result leaves out',
    feesStored: 'Fees as stored: Journal trades have no fee field yet, so fees count as zero.',
    source: (v: string) =>
      `Formula ${v}, from Journal trades and stored Massive daily closes. Not the Sahm account statement.`,
  },
  compare: {
    title: 'Compare dividend returns',
    info: 'The same amount in each ticker for the years you choose, with dividends reinvested (DRIP) or kept as cash, at today’s price and trailing yield held fixed (dividend-compare-1). A fixed price says nothing about what the price did, so each row also shows the trailing 1-year price change and the historical 1-year and 3-year total returns from stored closes plus the dividends paid. Not advice.',
    tickersLabel: 'Tickers compared',
    noTickers: 'No ticker chosen. Add one below.',
    defaultNote: 'Holdings and watchlist names with a stored dividend in the last 12 months.',
    remove: (tk: string) => `Remove ${tk} from the comparison`,
    addLabel: 'Add a ticker',
    add: 'Add',
    amount: 'Amount in each, USD',
    years: 'Years, 1 to 30',
    withholding: 'Withholding, %',
    withholdingNote: (d: string) =>
      `US withholding defaults to ${d}% (no US and Saudi treaty, IRS Publication 515), editable; check your Sahm statement.`,
    dripOn: 'DRIP on: dividends reinvested',
    dripOff: 'DRIP off: dividends kept as cash',
    invalid: (reason: string) => `Not computed: ${reason}.`,
    method: 'Method',
    tableAria: 'Dividend return comparison',
    price: 'Price (date)',
    change1y: 'Price change, 1Y',
    yield: 'Yield, 12 months',
    payments: (n: number) => (n === 1 ? '1 payment' : `${n} payments`),
    payouts: 'Payouts a year',
    none: 'None in 12 months',
    startShares: 'Start shares',
    endShares: 'End shares',
    annualIncome: 'Annual income, net (final year)',
    dividendsNet: 'Dividends, net total',
    endBalance: 'End balance',
    projection: 'Projected total return',
    priceBeside: (v: string) => `Price 1Y ${v}`,
    hist1y: 'Total return, last 1Y',
    hist3y: 'Total return, last 3Y',
    histPrice: (v: string, from: string, to: string) => `Price ${v}, ${from} to ${to}`,
    source: (amount: string, years: number, drip: boolean, tax: string, s1: number, s3: number) =>
      `USD ${amount} in each, ${years} ${years === 1 ? 'year' : 'years'}, DRIP ${drip ? 'on' : 'off'}, ${tax}% withholding. Historical returns over the last ${s1} and ${s3} stored sessions: buy at the first close, dividends net of withholding paid on their ex-date (reinvested at that close with DRIP), split-adjusted. Prices and dividends from stored Massive data.`,
    formula: (versions: string) => `Formulas ${versions}.`,
    asOf: (d: string) => `Closes to ${d}.`,
    csv: 'Export CSV',
  },
  income: {
    title: 'Income',
    info: 'Forward 12-month dividends from stored payments, with no growth and no price change assumed. Net figures deduct the withholding default.',
    summaryLabel: 'Income summary',
    forwardGross: 'Forward 12 months, gross',
    perYear: 'Stored payments, annualized',
    forwardNet: (w: string) => `Net of ${w} withholding`,
    withholdingShort: 'US withholding, the rate entered below',
    withholdingLabel: (w: string) =>
      `US withholding, ${w} (no US and Saudi treaty), editable; check your Sahm statement`,
    withholdingUnit: 'Percent of each gross dividend.',
    withholdingInvalid: 'Enter a percent from 0 to 100. Net figures are not shown until then.',
    yieldOnCost: 'Yield on cost, net',
    onCost: (gross: string, cost: string) => `Gross ${gross}, on ${cost} cost`,
    yieldOnValue: 'Yield on value',
    ttmLine: (v: string) => `Trailing 12 months: ${v}`,
    noPayers: 'No stored dividends for your holdings.',
    tableAria: 'Income by holding',
    perShare: 'Per share, 12 months',
    basis: 'Basis',
    gross: 'Gross',
    net: 'Net',
    yoc: 'Yield on cost, net (gross)',
    yocCell: (net: string, gross: string) => `${net} (${gross})`,
    yop: 'Yield on price',
    basisText: {
      'stated-frequency': (amount: string, date: string) =>
        `${amount} (ex ${date}) times stated payments a year`,
      'trailing-12m': (amount: string, date: string) =>
        `Trailing 12 months (latest ${amount}, ex ${date})`,
      none: () => 'None stored',
    },
    basisNone: 'None stored',
    nonPayers: (list: string) => `No stored dividends: ${list}.`,
    upcomingTitle: 'Upcoming ex-dates, 8 weeks',
    noUpcoming: 'No ex-dividend dates stored for your holdings in the next 8 weeks.',
    amount: (v: string) => `${v} a share`,
    exLine: (ex: string, pay: string | null, src: string) =>
      `ex ${ex}${pay ? ` · paid ${pay}` : ''} · ${src}`,
    withholding: (w: string) =>
      `Withholding ${w}: the US rate for a nonresident with no treaty is 30% (IRS Publication 515); the US has no income tax treaty with Saudi Arabia. Not verified: how Sahm applies it.`,
    source: (date: string) =>
      `Sources: Massive /stocks/v1/dividends (newest fetch ${date}) and Tauric’s calendar; portfolio-check-1 forwardIncome.`,
  },
  news: {
    title: 'Holdings news',
    info: 'Stored articles that name one of your holdings, with the description the feed stores. No images and no full text; the link opens the publisher.',
    filter: 'Ticker',
    allTickers: 'All holdings',
    search: 'Search titles and descriptions',
    none: 'No stored articles match.',
    listAria: 'Articles',
    paneAria: 'Reading pane',
    choose: 'Choose an article to read its stored description.',
    noDescription: 'The feed stored no description for this article.',
    readAt: (pub: string) => `Read at ${pub}`,
    source: 'Source: Massive news (news_articles), newest 120 for your holdings. Times in UTC.',
  },
  divCal: {
    title: 'Ex-dividend calendar',
    info: 'Ex-dividend dates for your watchlist and holdings, 7 days back to 14 ahead, from stored Massive dividends and Tauric’s calendar.',
    stripLabel: 'Choose a day',
    dayAria: (today: boolean, n: number) =>
      `${today ? ' (today)' : ''}, ${n} ex-dividend date${n === 1 ? '' : 's'}`,
    today: 'Today',
    none: 'No ex-dividend dates for your tickers on this day',
    amount: (v: string) => `${v} a share`,
    dates: (ex: string, pay: string | null) =>
      `ex ${ex}${pay ? ` · paid ${pay}` : ' · pay date not stored'}`,
    frequency: (n: number | null) =>
      n === null
        ? 'frequency not stated'
        : n === 0
          ? 'irregular'
          : n === 12
            ? 'monthly'
            : n === 4
              ? 'quarterly'
              : n === 2
                ? 'semi-annual'
                : n === 1
                  ? 'annual'
                  : `${n} a year`,
    noYield: 'yield unavailable (no stored close)',
    yieldAt: (pct: string, date: string, annual: boolean) =>
      `yield ${pct}% at the ${date} close (${annual ? 'this payment annualized' : 'trailing 12 months'})`,
    source: {
      massive: 'Massive /stocks/v1/dividends',
      tauric: 'Tauric calendar',
    },
    scope:
      'Your tickers only. Massive serves a market-wide list filtered by ex-date on the current plan; adding it is noted in docs/IDEAS.md.',
  },
} as const;
