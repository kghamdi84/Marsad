/**
 * Regime strings.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const regime = {
  title: 'Regime',
  ui: {
    running: (n: number, date: string) =>
      `Running ${n} session${n === 1 ? '' : 's'}, since ${date}`,
    ribbonAria: (summary: string) => `Regime by session over the past year: ${summary}.`,
    ribbonPast: (n: number) => `Last ${n} sessions`,
    ribbonNow: 'Now',
    heroChip: (rules: string, day: string) => `${rules} · close of ${day}`,
    delayedEod: 'Delayed · end of day',
    why: {
      title: 'Why this label',
      spClose: (v: string) => `S&P 500 close ${v}`,
      above50: (v: string) => `S&P 500 above its 50-day average (${v})`,
      above200: (v: string) => `S&P 500 above its 200-day average (${v})`,
      nearHigh: (limit: string, v: string) => `Within ${limit} of the 252-day high (${v})`,
      vixCalm: (limit: string, v: string) => `VIX under ${limit} (${v})`,
      stress: (limit: string, vix: string, vix3m: string) =>
        `Stress check: VIX at or above ${limit}, or VIX at or above VIX 3-month (${vix} against ${vix3m}) with the S&P under its 50-day`,
      met: 'Met',
      notMet: 'Not met',
      noData: 'No data',
      rule: 'Bull calm needs all four conditions. The label is the first rule that holds, in this order: stress, bear (the S&P 500 under a falling 200-day average), recovery, bull calm, bull correction. There is no numeric score.',
    },
    today: (label: string) => `Today: ${label}`,
    condVix30: 'VIX 30+',
    condAll: 'All sessions',
    studySub: (since: string) =>
      `Median with the middle half (no bootstrap interval stored) · FRED SP500 since ${since} · under 30 cases shows insufficient history`,
    studySub90: (since: string) =>
      `Median with a 90% bootstrap interval · FRED SP500 since ${since} · under 30 cases shows insufficient history`,
    horizonSessions: (h: number) => `${h} sessions`,
    median: 'Median',
    notEnough: 'n/a',
    nEquals: (n: number) => `n = ${n}`,
    middleHalf: (lo: string, hi: string) => `middle half ${lo} to ${hi}`,
    interval90: (lo: string, hi: string) => `90% interval ${lo} to ${hi}`,
    insufficientOf: (n: number) => `insufficient history (${n} of 30)`,
    scaleNote: (m: number) =>
      `Bar: the middle half of outcomes (25th to 75th percentile). Tick: the median. The scale runs from minus ${m} to plus ${m} percent, with zero in the middle.`,
    scaleNote90: (m: number) =>
      `Bar: the 90% interval of the median, from 2,000 bootstrap resamples of the episodes (seeded, so a rerun gives the same interval). Tick: the median. The scale runs from minus ${m} to plus ${m} percent, with zero in the middle.`,
    ofAvailable: (triggered: number, available: number) => `${triggered} of ${available}`,
    triggers: (rule: string) => `triggers ${rule}`,
    fred: (source: string) => `FRED ${source}`,
    fredData: (source: string, date: string) => `FRED ${source}, data for ${date}`,
    unavailable: 'Unavailable',
    metCount: (n: number) => `${n} of 4 met`,
    capNames: (key: string, vix: number, pct: number, composite: number) =>
      ({
        vix: `VIX at or above ${vix}`,
        breadth: `${pct}% or less of the universe above its 50-day`,
        composite: `Fear and Greed at or below ${composite}`,
        recession: 'Recession filter not High',
      })[key] ?? key,
    capFoot:
      'When all 4 are met, a staged plan for index ETFs appears in thirds with exit conditions and a bear case.',
    keywordTopics: 'Keyword topics (AI off)',
    articlesN: (n: number) => `${n.toLocaleString('en-US')} articles`,
    ratioX: (v: string) => `${v}×`,
    topicHeadlines: (name: string, n: number) =>
      `${name}: newest ${n} headline${n === 1 ? '' : 's'}`,
    noHeadlines: 'No headline stored for this topic in the last 40 days.',
    percentileChip: (name: string, pct: string, date: string) =>
      `${name} ${pct} percentile (${date})`,
    tables: {
      study: 'Every condition and horizon',
      signals: 'The 5 signals in full',
      components: 'The 7 components in full',
      conditions: 'The 4 conditions in full',
      topics: 'Topic counts in full',
      measures: 'Latest value, 1-month change and 1-year percentile',
    },
    // The summary card (squeezed v2 Regime): one row per gauge, each opening its detail below.
    summary: {
      rowsLabel: 'Regime at a glance',
      regime: 'Regime',
      recession: 'Recession filter',
      fearGreed: 'Fear and Greed',
      capitulation: 'Capitulation',
      sectors: 'Sectors against SPY',
      geopolitics: 'Geopolitics',
      signalsOn: (n: number, available: number) =>
        available === 5
          ? `${n} of 5 signals on`
          : `${n} of ${available} available signals on (5 in total)`,
      closeOf: (day: string) => `close of ${day}`,
      fgComponents: (n: number) => `${n} of 7 components`,
      fgNone: 'Not enough components yet',
      capMet: (n: number) => `${n} of 4 conditions met`,
      capPlan: 'staged plan running',
      capNone: 'Not computed yet',
      sectorSub: (lead: string, lag: string, day: string) =>
        `${lead} first, ${lag} last · 1 month against SPY · close of ${day}`,
      sectorNone: 'Data unavailable: fewer than two sector funds have a 1-month return',
      percentiles: (parts: string) => `${parts} percentile`,
      pastYear: (dates: string) => `Of the past year · data for ${dates}`,
      fewDays: (name: string, n: number) => `${name} from ${n} days only`,
      unavailable: 'Data unavailable',
    },
    switch: {
      riskLabel: 'Risk gauges',
      risk: {
        recession: 'Recession',
        fearGreed: 'Fear and Greed',
        capitulation: 'Capitulation',
        breadth: 'Breadth',
      },
      contextLabel: 'Context',
      context: {
        study: 'What came next',
        rotation: 'Sectors',
        geopolitics: 'Geopolitics',
        quality: 'Quality screen',
        measures: 'More measures',
      },
    },
  },
  intro:
    'What kind of market this is, from documented rules (ADR 0009), computed at the end of each day from stored data. It describes the market; it does not forecast it.',
  none: 'No regime has been computed yet. The regime job runs after the FRED job.',
  labelTitle: 'Regime label',
  labels: {
    stress: 'Stress',
    bear: 'Bear',
    recovery: 'Recovery',
    'bull-calm': 'Bull calm',
    'bull-correction': 'Bull correction',
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
    sp500: 'S&P 500',
    srcSp500: 'FRED SP500',
    srcVix: 'FRED VIXCLS',
    srcVix3m: 'FRED VXVCLS',
    high: (v: string) => `High ${v}`,
    sma50: '50-day average',
    sma200: '200-day average',
    rising: 'rising',
    falling: 'falling',
    drawdown: 'From the 252-day high',
    vix: 'VIX',
    vix3m: 'VIX 3-month',
    ratio: 'VIX over VIX3M',
  },
  inputsSource:
    'Source: FRED (S&P 500, VIXCLS, VXVCLS). The S&P 500 on FRED goes back 10 years, so labels start in November 2017.',
  recession: {
    title: 'Recession filter',
    none: 'Not computed yet. The regime job computes the filter after the FRED job.',
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
    title: 'What the S&P did next',
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
    none: 'No event study stored yet. The regime job computes it from the stored labels.',
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
    tickNote: 'The tick marks the reading a month ago.',
    highsLowsOutOf: (n: number) =>
      `52-week highs and lows: out of ${n.toLocaleString('en-US')} with enough history`,
    warmup:
      'The free plan gives 2 years of history, so the 200-day and 52-week measures need most of the first year to warm up; the counts show how many members they rest on.',
    source: (versions: string) =>
      `Source: Massive grouped daily (end of day, unadjusted, splits applied by Marsad). Rules ${versions}.`,
    suspect: (n: number) =>
      `${n} member${n === 1 ? '' : 's'} left out today: a one-day move over 50% with no split.`,
  },
  fearGreed: {
    title: 'Fear and Greed',
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
    short: {
      momentum: 'Momentum',
      strength: 'Strength',
      breadth: 'Breadth',
      putCall: 'Put/call',
      junk: 'Junk bonds',
      volatility: 'Volatility',
      safeHaven: 'Safe haven',
    } as Record<string, string>,
    ofMembers: (v: string) => `${v} of members`,
    points: (v: string) => `${v} points`,
    method:
      'A component counts only with a value for that day; nothing is carried forward. Prices are price returns. Stock price strength needs a 52-week measure plus a year of its own history, so it joins about two years after breadth starts (around December 2026).',
  },
  quality: {
    title: 'Quality at a discount',
    intro:
      'Profitable companies with strong balance sheets that also look cheap: quality is gross profits over assets (Novy-Marx, 2013), return on assets, low accruals and low leverage (Asness, Frazzini and Pedersen, 2019); value is the earnings yield and book-to-market (Graham). Each is a percentile within the Marsad universe; a company passes at quality 70 or more and value 50 or more.',
    active:
      'Capitulation watch is on: this is the list the brief pairs with staged entries. Study each name before any decision.',
    inactive: 'Capitulation watch is off: shown for study, not as a signal.',
    none: 'The screen has not run yet. It runs every Sunday.',
    noPrice: 'no stored close',
    summary: (
      asOf: string,
      year: number,
      priceDate: string,
      universe: number,
      eligible: number,
      passed: number,
    ) =>
      `Screened ${asOf}: fiscal ${year} figures from SEC filings, closes of ${priceDate}. ${eligible} of ${universe} companies had every input; ${passed} pass.`,
    excluded: (noCik: number, noGp: number, loss: number, negEq: number, missing: number) =>
      `Left out: ${noCik} without an SEC record, ${noGp} reporting no gross profit (banks and most insurers), ${loss} unprofitable, ${negEq} with negative equity, ${missing} with missing figures or no close.`,
    nonePassed: 'No company passes both bars this week.',
    colTicker: 'Company',
    colQuality: 'Quality',
    colValue: 'Value',
    colGp: 'Gross profit / assets',
    colRoa: 'Return on assets',
    colEy: 'Earnings yield',
    colBm: 'Book / price',
    colNotes: 'Figures used',
    caveats:
      'Market value uses the latest close times shares from the year-end filing, so later buybacks or issuance are not reflected. Figures are as reported for the full fiscal year; a quarter since then is not included. A screen is a starting point for study, not a recommendation.',
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
  rotation: {
    title: 'Sector rotation against SPY',
    source: (date: string) => `Massive daily bars · close of ${date}`,
    sourceNone: 'Massive daily bars',
    caption: (date: string) =>
      `Return of each sector fund relative to SPY to the close of ${date}, best 1 month first`,
    colSector: 'Sector',
    w1: '1 week',
    m1: '1 month',
    m3: '3 months',
    na: 'n/a',
    stale: (date: string) => `Stale: newest bar ${date}`,
    noBars: 'No bars stored',
    none: 'Not available yet: no SPY bars are stored. The bars job stores SPY and the 11 sector funds every night.',
    names: {
      XLK: 'Technology',
      XLC: 'Communication',
      XLY: 'Discretionary',
      XLF: 'Financials',
      XLI: 'Industrials',
      XLV: 'Health care',
      XLB: 'Materials',
      XLP: 'Staples',
      XLRE: 'Real estate',
      XLU: 'Utilities',
      XLE: 'Energy',
    } as Record<string, string>,
    info: 'Relative return against SPY over 5, 21 and 63 sessions: (1 + fund return) divided by (1 + SPY return), minus 1, over the same sessions. From Massive end-of-day closes of the Select Sector SPDR funds (split-adjusted by the vendor). A fund whose newest close is older than SPY\u2019s shows no values. Sorted by 1 month. Rules sector-rotation-1.',
  },
  geopolitics: {
    title: 'Geopolitics',
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
} as const;
