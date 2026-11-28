/**
 * The Ask page (checklist 8.1, ADR 0054). Import `t` from `strings.ts`, not this module (ADR 0051).
 */
const usd = (n: number) => `USD ${n.toFixed(2)}`;

export const ask = {
  formTitle: 'Ask about your Marsad data',
  formSubtitle:
    'Claude reads Marsad through read-only tools: tracked tickers, your holdings, company research, the regime, breadth, stored filings and recent alerts. Code checks every figure before you see it.',
  label: 'Your question',
  placeholder: 'For example: How has NVDA done over the last month, and when does it report?',
  counter: (n: number, max: number) => `${n} of ${max} characters`,
  submit: 'Ask',
  asking: 'Asking. Claude reads your Marsad data first; this can take up to a minute.',
  never: 'Marsad never advises. Claude explains stored data; you decide.',
  spendLeft: (day: number, month: number) =>
    `AI spend left: ${usd(day)} today, ${usd(month)} this month (shared with briefs and reviews).`,
  spendWarn: 'Over 80% of an AI cap is used.',
  spendUnknown: 'AI spend left: unavailable until Ask answers.',

  notConfigured: 'Ask is not configured yet',
  notConfiguredBody:
    'Ask needs the Anthropic key as a Supabase Edge Function secret and its first deploy from GitHub. Nothing is sent to Claude and nothing is spent until then.',
  notDeployed: 'The Ask function cannot be reached. It may not be deployed yet.',
  ownerOnly: 'Ask is for the owner of this Marsad only.',
  signedOut: 'Your session has ended. Sign in again to ask.',
  cappedDaily: 'AI limit reached for today',
  cappedMonthly: 'AI limit reached for this month',
  cappedBody:
    'No question goes to Claude until the limit resets: midnight UTC for the daily cap, the first of the month (UTC) for the monthly cap.',
  invalid: 'Type a question of up to 500 characters.',
  error: 'Ask failed on the server. Try again; if it keeps failing, check Status.',

  aiLabel: 'AI answer (Claude), figures checked against Marsad data',
  factsLabel: 'Facts only, written by Marsad from its data',
  reasons: {
    'verification-failed':
      "Claude's answer did not pass Marsad's figure check twice, so Marsad lists the facts it read instead.",
    'max-tokens': "Claude's answer was cut off, so Marsad lists the facts it read instead.",
    'key-rejected':
      'The Anthropic key was rejected. Marsad lists the facts it read; replace the key in the Edge Function secrets.',
    'rate-limited': 'Claude is busy right now. Marsad lists the facts it read; try again shortly.',
    unreachable: 'Claude could not be reached. Marsad lists the facts it read.',
    'api-error': 'Claude returned an error. Marsad lists the facts it read.',
    timeout: 'The answer took too long. Marsad lists the facts it read.',
    'too-many-calls': 'The answer needed too many steps. Marsad lists the facts it read.',
    'no-data': 'Marsad found no stored data for this question.',
  },
  refused: 'Claude declined this question. Marsad lists any facts it had read.',
  cappedMidway: 'The AI limit was reached during this answer. Marsad lists the facts it had read.',
  model: (m: string) => `Model ${m}`,
  asOf: (when: string) => `Data as of ${when} (the oldest cited figure)`,
  cost: (n: number) => `This answer cost ${n < 0.01 ? 'under USD 0.01' : usd(n)}`,
  sources: 'Sources',
  sourceAria: (n: number) => `Source ${n}`,
  openPage: 'Open in Marsad',
  openFiling: 'Open the filing on SEC.gov',
  opensNewTab: '(opens a new tab)',
  scopeSource: "Marsad's scope",

  historyTitle: 'Earlier questions',
  historySubtitle: 'Stored in your account only, newest first.',
  historyEmpty: 'No questions yet.',
  historyError: (m: string) => `History unavailable: ${m}`,
  states: {
    answered: 'Checked answer',
    'facts-only': 'Facts only',
    refused: 'Declined',
    capped: 'AI limit reached',
  },
  showAnswer: 'Show the answer',
  askedAt: (when: string) => `Asked ${when}`,
} as const;
