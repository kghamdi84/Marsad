/**
 * Study strings (company research is in research.ts).
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

import { research } from './research';

export const study = {
  title: 'Study',
  intro: 'Pick a company to study. Prices are end-of-day, never a live quote.',
  etfs: 'Benchmark ETFs',
  openLabel: 'Search a ticker or company',
  search: 'Ticker or company name',
  earningsAround: (date: string) => `Earnings around ${date} (estimated)`,
  stocks: 'Starting stocks',
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
  investor: {
    title: 'Cash, value and dilution',
    fcf: 'Free cash flow, 12 months',
    margin: (v: string) => `${v}% of revenue`,
    sbc: 'Stock-based pay, 12 months',
    ofRevenue: (v: string) => `${v}% of revenue`,
    buybacks: 'Buybacks, 12 months',
    dilution: 'Diluted shares, 1 year',
    netCash: 'Net cash',
    netDebt: 'Net debt',
    at: (date: string) => `At ${date}`,
    marketValue: 'Market value',
    mvSub: (priceDate: string, sharesDate: string) =>
      `Close of ${priceDate}, shares at ${sharesDate}`,
    ev: 'Enterprise value',
    evSales: 'EV / sales',
    evEbit: 'EV / operating income',
    pFcf: 'Price / free cash flow',
    fcfYield: 'Free cash flow yield',
    notMeaningful: 'Not meaningful',
    tenYears: (n: number) => `Revenue, EPS and free cash flow, ${n} fiscal years`,
    year: 'Year',
    revenue: 'Revenue',
    eps: 'EPS',
    fcfShort: 'Free cash flow',
    gap: 'Years missing before',
    range: (from: string, to: string) => `Fiscal years ${from} to ${to}.`,
    method:
      'From SEC XBRL facts as filed by the date chosen. Free cash flow is operating cash flow minus capital spending. Net cash is cash plus short-term investments minus long-term debt (both parts). Market value is the close times the shares on the latest cover page; enterprise value adds debt and subtracts cash and short-term investments. A multiple on negative earnings or cash flow is not meaningful.',
    version: (v: string) => `Formula ${v}.`,
  },
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
  business: {
    title: 'What the company does (10-K, Item 1)',
    intro:
      'The business description from the newest annual report, exactly as filed. It is the company describing itself, not an independent view.',
    open: 'Show the business description',
    loading: 'Loading the annual report text',
    none: 'No business description is stored for this company (ETFs file none).',
    filed: (period: string, filed: string) => `Year ended ${period}, filed ${filed}.`,
    view: '10-K on SEC',
    textLabel: 'Business description as filed',
  },
  holders: {
    title: 'Institutional holders (13F)',
    intro:
      'Long positions that investment managers with over 100 million dollars report on Form 13F, from the SEC quarterly data sets. Positions are as of the quarter end and are filed up to 45 days later, so this list is always at least six weeks old.',
    open: 'Show the holders',
    loading: 'Loading the 13F list',
    none: 'No 13F list is stored for this company yet. The SEC job loads each new quarterly data set.',
    summary: (period: string, filers: number, shares: string, value: string) =>
      `Positions as of ${period}: ${filers} filers reported ${shares} shares worth ${value}.`,
    lag: (period: string) =>
      `Disclosure lag: positions on ${period}, filed up to 45 days later. Funds below the reporting threshold, short positions and non-US holders are not included.`,
    cusips: (list: string) => `Counted under CUSIP ${list}.`,
    leftOut: (options: number, amendments: number, other: number, minor: number) =>
      `Left out: ${options} option lines, ${amendments} amended reports, ${other} lines for an older quarter, ${minor} lines under a CUSIP that appears on under 1% of the lines (most likely filer errors).`,
    colRank: 'Rank',
    colFiler: 'Filer',
    colShares: 'Shares',
    colShare: 'Share of reported',
    colValue: 'Value (USD)',
    colFiled: 'Filed',
  },
  quarterly: {
    title: 'Risk factors, quarter over quarter (10-Q)',
    intro:
      'Part II, Item 1A of the two newest quarterly reports, read from the SEC filings. A 10-Q lists changes since the annual report or says there were none; the two quarters are compared sentence by sentence with the same rules as the 10-K comparison.',
    open: 'Show the quarterly updates',
    loading: 'Loading the quarterly reports',
    none: 'No quarterly report text is stored for this company yet.',
    newest: (filed: string) => `Newest 10-Q, filed ${filed}`,
    unchanged:
      'This quarter says there were no material changes to the risk factors in the annual report.',
    changes:
      'This quarter lists risk factors added or changed since the annual report (shown below as filed).',
    textLabel: 'Quarterly risk factors as filed',
    view: '10-Q on SEC',
    compare: (newer: string, older: string) =>
      `Compared with the 10-Q filed ${older} (newer: ${newer}).`,
    oneOnly: 'Only one quarterly report is stored, so there is nothing to compare yet.',
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
    title: 'Latest company news',
    newest: (when: string) => `Newest ${when}`,
    showMore: (n: number) => `Show ${n} more`,
    showFewer: 'Show the newest 4',
    note: 'Grouped so one story from several outlets counts once, shown at its earliest time. Source tier and opinion are labelled. Free-plan news comes from three publishers only.',
    none: 'No news stored for this ticker.',
    outlets: (n: number) => (n === 1 ? '1 outlet' : `${n} outlets`),
    opinion: 'Analysis or opinion',
    noReporting: 'No reporting from tier 1 or 2 sources in the stored news.',
    showOpinion: (n: number) => `Show opinion and tier 3 or 4 (${n})`,
    reportingOnly: 'Reporting only',
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
  /** The company brief (company-brief-1): a summary computed by code from stored data, no AI. */
  brief: {
    title: 'Company brief',
    analysts: 'Analysts',
    aside: 'By code from stored data, not advice',
    na: 'Not available',
    loading: 'Loading',
    failed: (names: string) =>
      `Could not load ${names}, so the lines that need it say Not available.`,
    inputs: {
      facts: 'SEC facts',
      business: 'the 10-K business section',
      short: 'short interest',
      news: 'news sentiment',
      regime: 'the regime',
      sector: 'the sector fund',
      spy: 'SPY bars',
      strength: 'the strength rank',
      risk: 'the 10-Q risk factor flag',
      reports: 'the latest filings',
      insiders: 'insider filings',
      events: 'halts and alerts',
      dividends: 'dividends',
      earnings: 'results filings',
    } as Record<string, string>,
    open: (where: string) => `Open ${where}`,
    regimePage: 'Open the Regime page',
    sections: {
      company: 'Company',
      performance: 'Performance',
      checks: 'Strengths and risks',
      sentiment: 'Sentiment',
      context: 'Context (not a forecast)',
      next: "Latest filing and what's next",
    },
    whatItDoes: 'What it does',
    whatSource: (filed: string, period: string) =>
      `First sentence of the 10-K business section, as filed ${filed} (year ended ${period}).`,
    noBusiness: 'Not available: no 10-K business section is stored.',
    marketValue: 'Market value',
    mvLine: (shares: string, close: string, closeDate: string, sharesDate: string) =>
      `${shares} shares × ${close} (close of ${closeDate}, shares at ${sharesDate})`,
    returns: 'Price return',
    returnsCaption: (to: string) => `Price return to the close of ${to}, by session count`,
    colTicker: 'Ticker',
    periods: { m1: '1M', m3: '3M', y1: '1Y' } as Record<string, string>,
    noSector: 'Sector fund: none set (set one on the watchlist)',
    sectorSource: (src: string) =>
      src === 'holding' ? 'set on the holding' : 'set on the watchlist',
    revenue: 'Revenue, 4 quarters',
    revenueLine: (v: string, yoy: string | null, end: string) =>
      `${v} to ${end}${yoy === null ? ' (no year-earlier figure)' : `, ${yoy} on a year earlier`}`,
    netMargin: 'Net margin',
    netMarginLine: (v: string, end: string) => `${v} over 4 quarters to ${end}`,
    fcf: 'Free cash flow',
    fcfLine: (v: string, filed: string) => `${v} over 4 quarters (filed ${filed})`,
    dilution: 'Dilution',
    dilutionLine: (v: string, end: string) =>
      `Diluted shares ${v} on a year earlier (quarter to ${end})`,
    strength: 'Strength rank',
    strengthLine: (p: string, rank: number, members: number, date: string) =>
      `${p} percentile, ${rank} of ${members} universe stocks by 3-month return (${date})`,
    checksLabel: 'Code-based checks, not advice',
    strengths: (n: number) => `Strengths (${n})`,
    risks: (n: number) => `Risks (${n})`,
    noChecks: 'No rule fired with the data stored.',
    checks: {
      'revenue-growth': (v: string, th: string, d: string) =>
        `Revenue up ${v} on a year earlier (4 quarters to ${d}). Rule: up ${th} or more.`,
      'revenue-decline': (v: string, _th: string, d: string) =>
        `Revenue down ${v} on a year earlier (4 quarters to ${d}). Rule: any fall.`,
      'net-margin': (v: string, th: string, d: string) =>
        `Net margin ${v} over 4 quarters to ${d}. Rule: ${th} or more.`,
      'net-loss': (v: string, _th: string, d: string) =>
        `Net loss: margin ${v} over 4 quarters to ${d}. Rule: below 0%.`,
      'net-cash': (v: string, _th: string, d: string) =>
        `Net cash ${v} at ${d}: cash and short-term investments above long-term debt.`,
      'net-debt': (v: string, _th: string, d: string) =>
        `Net debt ${v} at ${d}: long-term debt above cash and short-term investments.`,
      'fcf-positive': (v: string, _th: string, d: string) =>
        `Free cash flow ${v} over 4 quarters (filed ${d}). Rule: above zero.`,
      'fcf-negative': (v: string, _th: string, d: string) =>
        `Free cash flow ${v} over 4 quarters (filed ${d}): more cash out than in. Rule: below zero.`,
      'shares-shrinking': (v: string, th: string, d: string) =>
        `Diluted shares down ${v} on a year earlier (quarter to ${d}). Rule: down ${th} or more.`,
      dilution: (v: string, th: string, d: string) =>
        `Diluted shares up ${v} on a year earlier (quarter to ${d}): dilution. Rule: up ${th} or more.`,
      'above-200': (v: string, _th: string, d: string, x: string) =>
        `Above its 200-day average: close ${v} against ${x} on ${d}.`,
      'below-200': (v: string, _th: string, d: string, x: string) =>
        `Below its 200-day average: close ${v} against ${x} on ${d}.`,
      'beats-spy': (v: string, th: string, d: string) =>
        `Ahead of SPY by ${v} over 63 sessions to ${d}. Rule: ${th} or more ahead.`,
      'lags-spy': (v: string, th: string, d: string) =>
        `Behind SPY by ${v} over 63 sessions to ${d}. Rule: ${th} or more behind.`,
      'strength-top': (v: string, th: string, d: string, x: string) =>
        `Strength rank ${v} percentile of ${x} universe stocks (${d}). Rule: ${th} or higher.`,
      'strength-bottom': (v: string, th: string, d: string, x: string) =>
        `Strength rank ${v} percentile of ${x} universe stocks (${d}). Rule: ${th} or lower.`,
      'far-from-high': (v: string, th: string, d: string) =>
        `${v} below its 52-week closing high (${d}). Rule: ${th} or more below.`,
      'short-interest': (v: string, th: string, d: string) =>
        `Short interest ${v} of shares outstanding (settled ${d}). Rule: ${th} or more.`,
      'insider-buying': (v: string, _th: string, d: string, x: string) =>
        `Insiders bought ${v} in the open market in 90 days to ${d} (${x}).`,
      'insider-selling': (v: string, _th: string, d: string, x: string) =>
        `Insiders sold ${v} in 90 days to ${d} (${x}), none bought.`,
      'earnings-soon': (v: string, th: string, d: string) =>
        `Earnings in ${v} (estimated ${d}): event risk. Rule: ${th} or fewer.`,
      'recent-halt': (v: string, _th: string, d: string) =>
        `Trading halted ${v} in 30 days, the latest on ${d}.`,
    } as Record<string, (v: string, th: string, d: string, x: string) => string>,
    trades: (n: number) => (n === 1 ? '1 trade' : `${n} trades`),
    sales: (n: number) => (n === 1 ? '1 sale' : `${n} sales`),
    days: (n: number) => (n === 1 ? '1 day' : `${n} days`),
    times: (n: number) => (n === 1 ? 'once' : `${n} times`),
    news: 'News, 30 days',
    newsCounts: (pos: number, neu: number, neg: number, n: number) =>
      `${pos} positive · ${neu} neutral · ${neg} negative, of ${n} stored ${n === 1 ? 'story' : 'stories'}`,
    newsPct: (pos: string, neu: string, neg: string) =>
      `${pos} positive, ${neu} neutral, ${neg} negative of the labelled stories.`,
    newsFew: (n: number) => `${n} labelled: too few for a percentage (needs 30).`,
    newsNotStored: (n: number) =>
      `${n} stored ${n === 1 ? 'story' : 'stories'}; no sentiment labels are stored for them.`,
    newsNone: 'No stories stored in 30 days.',
    newsCapped: 'The read stopped at 500 stories, so older ones in the window are not counted.',
    newsNote:
      "Labels are the news vendor's (Massive) model, an opinion, not Marsad's. Each story counts once.",
    insiders: 'Insiders, 90 days',
    insidersLine: (net: string, buys: number, buyUsd: string, sells: number, sellUsd: string) =>
      `Net ${net}: ${buys} open-market ${buys === 1 ? 'buy' : 'buys'} ${buyUsd}, ${sells} ${sells === 1 ? 'sale' : 'sales'} ${sellUsd}`,
    insidersNone: 'No open-market buys or sales filed.',
    unpriced: (n: number) => `${n} without a reported value, not in the totals.`,
    shortLabel: 'Short interest',
    shortPct: (pct: string) => `${pct} of shares outstanding`,
    shortTrend: (change: string, prior: string) => `${change} since ${prior}`,
    shortDate: (date: string) => `settled ${date}`,
    daysToCover: (d: string) => `${d} days to cover`,
    sectorFund: 'Sector fund',
    sectorTo: (date: string, source: string) => `(to ${date}, ${source})`,
    materialityOf: (m: string) => `${m} materiality`,
    item: (n: string) => `Item ${n}`,
    thresholds: (
      growth: number,
      margin: number,
      dilution: number,
      short: number,
      rs: number,
      top: number,
      bottom: number,
      fromHigh: number,
      earnings: number,
    ) =>
      `Thresholds: revenue growth ${growth}%, net margin ${margin}%, dilution ${dilution}%, short interest ${short}% of shares outstanding, ${rs}% against SPY, strength percentile ${top} and ${bottom}, ${fromHigh}% below the 52-week high, earnings within ${earnings} days.`,
    regime: 'Market regime',
    regimeLine: (label: string, date: string, version: string) =>
      `${label} (close of ${date}, rules ${version})`,
    regimeLabels: {
      stress: 'Stress',
      bear: 'Bear',
      recovery: 'Recovery',
      'bull-calm': 'Bull calm',
      'bull-correction': 'Bull correction',
      'insufficient-data': 'Insufficient data',
    } as Record<string, string>,
    noRegime: 'Not available: no regime has been computed yet.',
    sectorVsSpy: (etf: string) => `${etf} against SPY`,
    sectorRs: (m1: string, m3: string, date: string) =>
      `${m1} over 1 month, ${m3} over 3 months (to ${date})`,
    recession: 'Recession signals',
    recessionLine: (on: number, of: number, level: string, date: string) =>
      `${on} of ${of} on, level ${level} (${date})`,
    noForecast:
      'Plain statements of current conditions with their dates. Marsad does not forecast or predict prices.',
    latest: 'Newest report',
    latestLine: (what: string, form: string, date: string) => `${what} (${form}, filed ${date})`,
    onSec: 'Filing on SEC',
    noReport: 'Not available: no 8-K, 10-Q or 10-K is stored.',
    riskFactors: 'Risk factors',
    riskChanged: (date: string) =>
      `The newest 10-Q (filed ${date}) lists risk factors added or changed since the annual report.`,
    riskSame: (date: string) =>
      `The newest 10-Q (filed ${date}) says there were no material changes.`,
    riskNone: 'Not available: no 10-Q risk factor section is stored.',
    nextEarnings: 'Next earnings',
    earningsLine: (date: string, days: string) =>
      `~ ${date}, estimated from past results 8-Ks (${days})`,
    earningsAgo: (days: string) => `${days} ago`,
    earningsAway: (days: string) => `in ${days}`,
    exDividend: 'Next ex-dividend',
    exDividendLine: (date: string, amount: string) => `${date}, ${amount} a share`,
    noExDividend: 'None upcoming in the stored dividends.',
    events: 'Halts and alerts, 30 days',
    eventsLine: (halts: number, alerts: number) =>
      `${halts === 1 ? '1 trading halt' : `${halts} trading halts`}, ${alerts === 1 ? '1 Marsad alert' : `${alerts} Marsad alerts`}`,
    newestHalt: (date: string, reason: string) => `Newest halt ${date}: ${reason}`,
    newestAlert: (date: string, headline: string) => `Newest alert ${date}: ${headline}`,
    provenance: (asOf: string, close: string, version: string, parts: string) =>
      `Formula ${version} (reusing ${parts}). SEC XBRL facts as filed by ${asOf}; prices are Massive end-of-day closes to ${close}.`,
    method:
      'Every line is computed by code from data Marsad stores; no AI writes any of it. Returns compare closes 21, 63 and 252 sessions apart, with SPY and the sector fund over the same two dates. A check fires only when its input is stored and its rule is met; the rule and threshold are stated on each line. Market value uses the shares on the newest 10-K or 10-Q cover page; short interest is shown against those shares, since float is not stored.',
  },

  markersNote:
    'Markers show 8-Ks of high or medium materiality (E for results under Item 2.02, F for the others), splits, ex-dividend dates, trading halts, Marsad alerts and insider open-market purchases. A filing accepted after the 4:00 pm ET close sits on the next trading day. Other Form 4s stay in the filings list.',
  noMarkers: 'No high or medium materiality 8-Ks or splits in this period.',
  summary: 'Summary',
  ui: {
    searchLabel: 'Search ticker or company',
    searchNone: (q: string) => `No company matches "${q}".`,
    searchMatches: 'Matching companies',
    searching: 'Searching',
    headerMeta: (date: string) => `Massive daily bars \u00B7 close of ${date}`,
    shariahPill: {
      'passes-ratios': 'Shariah ratios within limits',
      'fails-ratios': 'Shariah: a ratio over its limit',
      unknown: 'Shariah ratios not checked',
      off: 'Shariah aid off',
    } as Record<string, string>,
    rsiChip: (v: string | null) => (v === null ? 'RSI 14: not enough history' : `RSI 14: ${v}`),
    markerPrompt:
      'Tap a marker on the chart, or choose one from the list below, to see its detail here.',
    nextSession: (pct: string) => `${pct} next session`,
    largeMove: 'over 25%, check the news before trusting it',
    legend: (range: string, lo: string, hi: string) =>
      `E results 8-K \u00B7 F other 8-K \u00B7 D dividend \u00B7 S split \u00B7 H halt \u00B7 A Marsad alert \u00B7 B insider buy \u00B7 ${range} ${lo} to ${hi}`,
    markersAll: (n: number) => `All chart markers (${n})`,
    trendLine: (trend: string, s50: string, s200: string) =>
      `Trend: ${trend} \u00B7 SMA 50 ${s50} \u00B7 SMA 200 ${s200}`,
    snapshot: {
      title: 'Snapshot',
      marketValue: 'Market value',
      mvSub: (shares: string, close: string) => `${shares} shares \u00D7 ${close}`,
      revenue: 'Revenue, last 4 quarters',
      revenueYoY: (pct: string) => `${pct} on a year earlier`,
      revenueTo: (end: string) => `Four quarters to ${end}`,
      netMargin: 'Net margin',
      netMarginSub: 'Last 4 quarters',
      nextEarnings: 'Next earnings',
      nextSub: 'Estimated from 8-K dates',
      shortInterest: 'Short interest',
      notReported: 'Not reported',
      noFiler: 'No SEC filer record',
      provenance: (asOf: string, close: string, version: string) =>
        `Source: SEC XBRL company facts as filed by ${asOf}; market value uses the close of ${close}. Formula ${version}.`,
    },
    filingsCard: {
      title: 'Filings and announcements',
      source: 'SEC EDGAR',
      showAll: (n: number) => `Show all ${n} filings`,
      showFewer: 'Show the newest 6',
    },
    details: 'Company details',
    riskToggle: 'Risk factor comparison',
    riskModes: { yoy: 'Year on year (10-K)', qoq: 'Quarter on quarter (10-Q)' } as Record<
      string,
      string
    >,
    nextResults: 'Next results (estimated)',
    nextResultsSub: 'Estimated from past results 8-K dates (Item 2.02), within this window:',
    impliedMissing:
      'Implied move and IV rank need options data, which the current Massive plan does not include.',
    shariahRatioName: { debt: 'Debt ratio', cash: 'Cash ratio' } as Record<string, string>,
    shariahLimitTick: 'The tick on each bar marks the limit set in Settings.',
    endOfDay: 'End of day',
    staleBadge: 'Stale',
    latestNotCovered: (tk: string) => `Tauric does not cover ${tk}`,
    latestLine: (price: string, label: string) => `Latest from Tauric $${price} · ${label}`,
    averages: 'Averages',
    rsiZones: 'Under 30 oversold, over 70 overbought',
    rsiAria: (v: string) => `RSI 14 at ${v} on a scale of 0 to 100; zones at 30 and 70.`,
    rangeAria: (low: string, high: string, pos: string) =>
      `Range ${low} to ${high}; the last close sits at ${pos}% of it.`,
    chartRange: 'Chart range',
    readout: (day: string, close: string) => `${day} \u00B7 ${close}`,
    nextEarnings: 'Next earnings (estimated)',
    earningsRange: (from: string, to: string) => `${from} to ${to}`,
    earningsOverdue: 'Overdue: no newer results filing yet',
    noEarnings: 'No results filings stored',
    shortInterest: 'Short interest',
    shortShares: (m: string) => `${m}M shares`,
    shortSub: (days: string | null, date: string) =>
      days === null ? `as of ${date}` : `${days} days to cover \u00B7 as of ${date}`,
    noShort: 'Not stored for this ticker',
    shariahChip: {
      'passes-ratios': 'Within limits',
      'fails-ratios': 'Over a limit',
      unknown: 'Not checked',
    } as Record<string, string>,
    shariahPrefix: 'Shariah screening aid, not a ruling:',
    ranges: { '3m': '3M', '6m': '6M', '1y': '1Y' } as Record<string, string>,
    sections: 'Company sections',
    sectionNames: {
      overview: 'Overview',
      analysts: 'Analysts',
      financials: 'Financials',
      earnings: 'Earnings',
      technicals: 'Technicals',
      dividends: 'Dividends',
      ownership: 'Ownership',
      news: 'News',
      filings: 'Filings',
      shariah: 'Shariah aid',
    } as Record<string, string>,
    markerLetters: {
      results: 'E',
      'high-8k': 'F',
      'medium-8k': 'F',
      split: 'S',
      dividend: 'D',
      'insider-buy': 'B',
      halt: 'H',
      alert: 'A',
    } as Record<string, string>,
  },
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
  shariah: {
    title: 'Shariah screening aid',
    off: 'The Shariah screening aid is off. Turn it on in Settings, under Preferences.',
    noBalance: 'No balance sheet is stored for this company, so the ratios cannot be computed.',
    basis: (b: string) =>
      b === 'assets'
        ? 'Ratios over total assets.'
        : 'Ratios over market capitalization (last close times shares outstanding).',
    ratio: (name: string, value: string, max: string, pass: string) =>
      `${name === 'debt' ? 'Debt' : 'Cash'}: ${value} (limit below ${max}): ${pass}.`,
    pass: 'within the limit',
    fail: 'over the limit',
    unknown: 'not available',
    verdict: {
      'passes-ratios': 'Passes the financial ratios.',
      'fails-ratios': 'Fails at least one financial ratio.',
      unknown: 'Cannot be judged: an input is missing.',
    } as Record<string, string>,
  },
  thesis: {
    title: 'Thesis card',
    intro:
      'Your view, with its other side written down. The bear case and what would change your view are required. Each save is a new version; older versions stay below.',
    none: 'No thesis yet. Writing one before you buy is part of the checklist.',
    status: 'Status',
    statuses: { intact: 'Intact', weakening: 'Weakening', broken: 'Broken' } as Record<
      string,
      string
    >,
    bull: 'Bull case',
    bear: 'Bear case (required)',
    risks: 'Key risks (one a line)',
    changeView: 'What would change my view (required)',
    sources: 'Sources (https links, one a line)',
    save: 'Save new version',
    edit: 'Write a new version',
    saved: 'Saved. Open holdings of this ticker now carry this status.',
    savedAt: (when: string) => `Saved ${when}.`,
    history: (n: number) => `Earlier versions (${n})`,
    ai: 'An AI draft from cited filings and news arrives once an Anthropic key and cost caps are set.',
  },
  research,
  placeholdersTitle: 'More on this company',
  placeholders: [
    {
      name: 'Earnings against estimates, surprise and implied move',
      state: 'Requires a higher Massive plan',
      why: 'Estimates come from Benzinga data, which the free plan does not include. Reported results and the price move after each release are in Earnings history (Financials tab); the implied move needs options data.',
    },
    {
      name: 'Per-analyst ratings and track records (opinion)',
      state: 'Requires a higher Massive plan',
      why: "Massive's Benzinga add-on is not on the plan. The Tauric consensus, rating counts and price targets are in the Analysts view.",
    },
    {
      name: 'Valuation percentiles against the 5-year history',
      state: 'Requires a higher Massive plan',
      why: 'A 5-year price history is beyond the free plan, which allows 2 years of daily bars. Statements come from SEC filings instead.',
    },
  ],
} as const;
