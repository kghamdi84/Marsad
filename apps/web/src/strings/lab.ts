/**
 * Lab strings.
 * Import `t` from `strings.ts`, not this module (ADR 0051).
 */

export const lab = {
  title: 'Lab',
  intro: (n: number) =>
    `${n} playbooks \u00B7 every one starts as a draft and earns live status only through Marsad's own tests`,
  stage: {
    notTestable: 'Not testable yet',
    notRun: 'Not run yet',
    draft: 'Draft',
    backtested: 'Backtested',
    shadow: 'Shadow',
    live: 'Live',
    demoted: 'Demoted',
  } as Record<string, string>,
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
  ui: {
    lifecycle: 'Lifecycle',
    outside: (notTestable: number, notRun: number) =>
      `Not in the lifecycle yet: ${notTestable} not testable, ${notRun} not run. Backtested needs 30 out-of-sample trades.`,
    filterLabel: 'Which playbooks',
    filterAll: (n: number) => `All ${n}`,
    filterTestable: (n: number) => `Testable ${n}`,
    filterNot: (n: number) => `Not testable ${n}`,
    gateNote:
      'Draft to Backtested needs 30 out-of-sample trades and an expectancy interval above zero after costs. Shadow logs alerts without sending. Demoted rules return to draft.',
    evidence: (label: string) => `Evidence: ${label}`,
    evidenceDot: (label: string) => `Evidence \u00B7 ${label.toLowerCase()}`,
    queued: 'Rule written. Not run yet: queued for the next backtest job.',
    insufficientHistory: 'Insufficient history',
    oosOf30: (n: number) => `${n} of 30 out of sample`,
    lastRunDate: (date: string, all: number, oos: number) =>
      oos === 0
        ? `Last run ${date} \u00B7 ${all} trades in total, all inside the training window`
        : `Last run ${date} \u00B7 ${all} trades in total, ${oos} out of sample`,
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    costsPerSide: 'Costs per side',
    costsValue: (c: number, s: number, f: number) => `${c} bps fee, ${s} bps slippage, ${f} bps FX`,
    trialsCounted: 'Trials counted',
    testedOn: (tickers: string) => `Tested on ${tickers}`,
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  trades: (all: number, oos: number) =>
    `${all} trades in all; ${oos} out of sample (walk-forward, holdout untouched).`,
  expectancy: (v: string, lo: string, hi: string) =>
    `Out-of-sample expectancy ${v} per trade (90% interval ${lo} to ${hi}).`,
  insufficient: (n: number) =>
    `Insufficient history: ${n} out-of-sample trades, 30 needed for any percentage.`,
  winRate: (v: string) => `Win rate ${v}.`,
  drawdown: (dd: string, mc: string) => `Maximum drawdown ${dd}; Monte Carlo worst 5% ${mc}.`,
  benchmark: (t: string, v: string) => `${t} over the same dates: ${v}.`,
  equityTitle: 'Equity curve, out of sample',
  equityNote:
    'Growth of 1, the walk-forward test trades taken one after another by exit date at full size (the same convention as the drawdown). A sequence of trades, not a portfolio.',
  equityAria: (n: number, from: string, to: string, end: string, low: string) =>
    `Equity curve of ${n} out-of-sample trades from ${from} to ${to}: growth of 1 ends at ${end}, lowest ${low}.`,
  equitySummary: (end: string, low: string) => `Ends at ${end}; lowest ${low}.`,
  gate: (reason: string) => `Gate to backtested: ${reason}.`,
  costs: (c: number, s: number, f: number) =>
    `Costs per side: commission ${c}, slippage ${s}, currency ${f} basis points.`,
  leftOut: 'Not recommended',
  /** Marsad v2 Lab: counts, the list and detail split, the gate and the fact tiles. */
  v2: {
    counts: 'Playbooks by stage',
    count: {
      notTestable: 'Not testable',
      notRun: 'Not run',
      draft: 'Draft',
      backtested: 'Backtested',
      shadow: 'Shadow',
      live: 'Live',
      demoted: 'Demoted',
    } as Record<string, string>,
    showingAll: 'Showing every playbook. Tap a count to show one stage.',
    showingStage: (stage: string) => `Showing ${stage.toLowerCase()} only.`,
    listTitle: (n: number) => `${n} playbooks`,
    listMeta: (horizon: string, evidence: string) =>
      `${horizon} · evidence ${evidence.toLowerCase()}`,
    detailMeta: (n: string, horizon: string, evidence: string) =>
      `Playbook ${n} · ${horizon} · evidence ${evidence.toLowerCase()}`,
    noneAtStage: 'No playbook is at this stage.',
    gatePassed: 'Gate passed',
    gateNotPassed: 'Gate not passed',
    oosTrades: 'Out-of-sample trades',
    ofThirty: (n: number) => `${n} of 30`,
    outOfSample: 'out of sample',
    outOfSampleMet: 'out of sample, 30 needed',
    noCurve: 'Equity curve appears when the backtest report has one.',
    ruleJson: 'Rule as stored (JSON, version kept with a content hash)',
    costsValue: (bps: number) => `${bps} bps`,
    costsSub: (c: number, s: number, f: number) => `${c} fee, ${s} slippage, ${f} FX`,
    walkForward: 'Walk-forward',
    walkValue: (folds: number) => `${folds} folds`,
    walkSub: 'train, then test, rolling',
    holdout: 'Holdout',
    holdoutValue: (pct: string) => `Last ${pct}%`,
    holdoutSub: 'of the dates, untouched',
    notRecorded: 'Not recorded',
    notRecordedSub: 'not in this stored run',
    noRunTrials: 'no run stored yet',
  },
} as const;
