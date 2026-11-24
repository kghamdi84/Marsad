/**
 * What SEC filings mean, in plain language: 8-K item labels with a default materiality, Form 4 transaction
 * codes, and the disclosure lags that must be shown next to insider and institutional data.
 *
 * Sources, all read on 2026-11-24:
 * - Form 8-K item numbers and official titles: https://www.sec.gov/files/form8-k.pdf (OMB 3235-0060, expires
 *   2027-11-30). The four-business-day filing rule is in the same document.
 * - Form 4 transaction codes P, S, A, D, F, M, G, V, J, K and the two-business-day rule, Form 3 (10 days) and
 *   Form 5 (45 days after fiscal year end): SEC Investor Bulletin, "Insider Transactions and Forms 3, 4, and 5"
 *   (SEC Pub. No. 137, 2/13), https://www.sec.gov/files/forms-3-4-5.pdf. Code X comes from the project brief
 *   and is not in that bulletin; the SEC's Form 4 instructions page could not be fetched (404), so codes
 *   beyond those listed are shown as unexplained rather than guessed.
 * - Form 13F deadline (45 days after quarter end): https://www.sec.gov/about/forms/form13f.pdf, Special
 *   Instruction 3.
 *
 * Materiality: the brief names high, medium and low items. Items the brief does not name carry
 * `basis: 'marsad-default'`, a judgment of this project that can be changed here in one place.
 */

export type Materiality = 'high' | 'medium' | 'low';

export interface EightKItem {
  item: string;
  /** Title as printed in the SEC's Form 8-K. */
  officialTitle: string;
  /** Short label a non-lawyer can read at a glance. */
  plain: string;
  materiality: Materiality;
  /** `brief`: set by the project brief. `marsad-default`: this project's own judgment. */
  basis: 'brief' | 'marsad-default';
}

const item = (
  n: string,
  officialTitle: string,
  plain: string,
  materiality: Materiality,
  basis: 'brief' | 'marsad-default' = 'brief',
): [string, EightKItem] => [n, { item: n, officialTitle, plain, materiality, basis }];

export const EIGHT_K_ITEMS: Readonly<Record<string, EightKItem>> = Object.freeze(
  Object.fromEntries([
    item(
      '1.01',
      'Entry into a Material Definitive Agreement',
      'Signed a major agreement',
      'medium',
    ),
    item(
      '1.02',
      'Termination of a Material Definitive Agreement',
      'Ended a major agreement',
      'medium',
    ),
    item(
      '1.03',
      'Bankruptcy or Receivership',
      'Bankruptcy or receivership',
      'high',
      'marsad-default',
    ),
    item(
      '1.04',
      'Mine Safety – Reporting of Shutdowns and Patterns of Violations',
      'Mine safety shutdown or violations',
      'low',
      'marsad-default',
    ),
    item('1.05', 'Material Cybersecurity Incidents', 'Cybersecurity incident', 'high'),
    item(
      '2.01',
      'Completion of Acquisition or Disposition of Assets',
      'Completed an acquisition or sale of assets',
      'medium',
    ),
    item(
      '2.02',
      'Results of Operations and Financial Condition',
      'Earnings results released',
      'high',
    ),
    item(
      '2.03',
      'Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant',
      'Took on new debt or similar obligation',
      'medium',
      'marsad-default',
    ),
    item(
      '2.04',
      'Triggering Events That Accelerate or Increase a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement',
      'Debt triggered early or increased',
      'medium',
      'marsad-default',
    ),
    item(
      '2.05',
      'Costs Associated with Exit or Disposal Activities',
      'Restructuring or exit costs',
      'medium',
    ),
    item('2.06', 'Material Impairments', 'Asset write-down (impairment)', 'high'),
    item(
      '3.01',
      'Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing',
      'Delisting notice or listing problem',
      'high',
    ),
    item(
      '3.02',
      'Unregistered Sales of Equity Securities',
      'Sold shares outside a public offering',
      'medium',
      'marsad-default',
    ),
    item(
      '3.03',
      'Material Modification to Rights of Security Holders',
      'Changed rights of shareholders',
      'medium',
      'marsad-default',
    ),
    item('4.01', 'Changes in Registrant’s Certifying Accountant', 'Auditor change', 'high'),
    item(
      '4.02',
      'Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review',
      'Past financials should not be relied on (restatement)',
      'high',
    ),
    item('5.01', 'Changes in Control of Registrant', 'Change of control', 'high', 'marsad-default'),
    item(
      '5.02',
      'Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers',
      'Executive or director change',
      'high',
    ),
    item(
      '5.03',
      'Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year',
      'Charter or bylaw change, or new fiscal year',
      'low',
      'marsad-default',
    ),
    item(
      '5.04',
      'Temporary Suspension of Trading Under Registrant’s Employee Benefit Plans',
      'Employee plan trading blackout',
      'low',
      'marsad-default',
    ),
    item(
      '5.05',
      'Amendments to the Registrant’s Code of Ethics, or Waiver of a Provision of the Code of Ethics',
      'Code of ethics change or waiver',
      'low',
      'marsad-default',
    ),
    item(
      '5.06',
      'Change in Shell Company Status',
      'Shell company status change',
      'low',
      'marsad-default',
    ),
    item(
      '5.07',
      'Submission of Matters to a Vote of Security Holders',
      'Shareholder vote results',
      'low',
      'marsad-default',
    ),
    item(
      '5.08',
      'Shareholder Director Nominations',
      'Shareholder director nominations',
      'low',
      'marsad-default',
    ),
    item(
      '6.01',
      'ABS Informational and Computational Material',
      'Asset-backed securities material',
      'low',
      'marsad-default',
    ),
    item(
      '6.02',
      'Change of Servicer or Trustee',
      'Asset-backed securities servicer or trustee change',
      'low',
      'marsad-default',
    ),
    item(
      '6.03',
      'Change in Credit Enhancement or Other External Support',
      'Asset-backed securities credit support change',
      'low',
      'marsad-default',
    ),
    item(
      '6.04',
      'Failure to Make a Required Distribution',
      'Asset-backed securities missed distribution',
      'low',
      'marsad-default',
    ),
    item(
      '6.05',
      'Securities Act Updating Disclosure',
      'Asset-backed securities disclosure update',
      'low',
      'marsad-default',
    ),
    item('6.06', 'Static Pool', 'Asset-backed securities static pool', 'low', 'marsad-default'),
    item('7.01', 'Regulation FD Disclosure', 'Information shared under Regulation FD', 'low'),
    item('8.01', 'Other Events', 'Other event', 'low'),
    item('9.01', 'Financial Statements and Exhibits', 'Attached documents and exhibits', 'low'),
  ]),
);

const RANK: Record<Materiality, number> = { low: 0, medium: 1, high: 2 };

export interface DescribedEightK {
  items: EightKItem[];
  /** Item numbers the table does not know, kept visible instead of dropped. */
  unknown: string[];
  /** The highest materiality among known items, or `unknown` when no item is recognised. */
  materiality: Materiality | 'unknown';
}

/** Labels the item numbers of one 8-K. Order is preserved; duplicates are removed. */
export function describeEightK(itemNumbers: readonly string[]): DescribedEightK {
  const seen = new Set<string>();
  const items: EightKItem[] = [];
  const unknown: string[] = [];
  for (const raw of itemNumbers) {
    const n = raw.trim();
    if (n === '' || seen.has(n)) continue;
    seen.add(n);
    const known = EIGHT_K_ITEMS[n];
    if (known) items.push(known);
    else unknown.push(n);
  }
  let materiality: Materiality | 'unknown' = 'unknown';
  for (const i of items)
    if (materiality === 'unknown' || RANK[i.materiality] > RANK[materiality])
      materiality = i.materiality;
  return { items, unknown, materiality };
}

export type TransactionKind = 'discretionary' | 'compensation' | 'other';

export interface TransactionCode {
  code: string;
  meaning: string;
  kind: TransactionKind;
  /** Where the explanation comes from. */
  source: 'sec-bulletin' | 'brief';
}

const tc = (
  code: string,
  meaning: string,
  kind: TransactionKind,
  source: TransactionCode['source'] = 'sec-bulletin',
): [string, TransactionCode] => [code, { code, meaning, kind, source }];

/**
 * Form 4 and Form 5 transaction codes. `kind` is this project's reading of the code: P and S are open-market
 * decisions by the insider; A, F, M and X mostly follow from pay and option plans; the rest are neither.
 */
export const TRANSACTION_CODES: Readonly<Record<string, TransactionCode>> = Object.freeze(
  Object.fromEntries([
    tc('P', 'Open-market or private purchase of securities', 'discretionary'),
    tc('S', 'Open-market or private sale of securities', 'discretionary'),
    tc(
      'A',
      'Grant, award or other acquisition from the company (such as an option)',
      'compensation',
    ),
    tc('D', 'Sale or transfer of securities back to the company', 'other'),
    tc(
      'F',
      'Payment of exercise price or tax liability using securities received from the company',
      'compensation',
    ),
    tc(
      'M',
      'Exercise or conversion of a derivative security received from the company (such as an option)',
      'compensation',
    ),
    tc(
      'X',
      'Exercise of an in-the-money or at-the-money derivative security',
      'compensation',
      'brief',
    ),
    tc('G', 'Gift of securities by or to the insider', 'other'),
    tc('V', 'Transaction voluntarily reported on Form 4', 'other'),
    tc('J', 'Other (the filing carries a footnote describing it)', 'other'),
    tc('K', 'Equity swap or similar hedging transaction', 'other'),
  ]),
);

export interface ExplainedCode {
  code: string;
  meaning: string;
  kind: TransactionKind | 'unexplained';
  known: boolean;
}

/** Explains one transaction code; a code outside the table is shown as unexplained, never guessed. */
export function explainTransactionCode(code: string): ExplainedCode {
  const c = code.trim().toUpperCase();
  const known = TRANSACTION_CODES[c];
  if (known) return { code: c, meaning: known.meaning, kind: known.kind, known: true };
  return {
    code: c,
    meaning: `Code ${c}: see the SEC's Form 4 instructions`,
    kind: 'unexplained',
    known: false,
  };
}

export interface DisclosureLag {
  form: string;
  /** One line shown next to the data. */
  label: string;
  source: string;
}

/** Disclosure lags that must be labelled wherever the data is shown (integrity rule 15). */
export const DISCLOSURE_LAGS: Readonly<Record<string, DisclosureLag>> = Object.freeze({
  '3': {
    form: '3',
    label: 'Filed within 10 days after the person becomes an insider',
    source: 'SEC Investor Bulletin, Pub. No. 137',
  },
  '4': {
    form: '4',
    label: 'Filed within two business days after the trade, so it can be days old',
    source: 'SEC Investor Bulletin, Pub. No. 137',
  },
  '5': {
    form: '5',
    label: 'Filed up to 45 days after the fiscal year ends, for trades not reported earlier',
    source: 'SEC Investor Bulletin, Pub. No. 137',
  },
  '8-K': {
    form: '8-K',
    label: 'Filed within four business days after the event, unless the item says otherwise',
    source: 'SEC Form 8-K, General Instruction B.1',
  },
  '13F-HR': {
    form: '13F-HR',
    label: '45-day reporting lag: holdings are as of quarter end and filed up to 45 days later',
    source: 'SEC Form 13F, Special Instruction 3',
  },
});

/** The lag label for a form type, or null when none is recorded. Amendments use the base form's label. */
export function disclosureLag(form: string): DisclosureLag | null {
  const base = form.replace(/\/A$/i, '').toUpperCase();
  return DISCLOSURE_LAGS[base] ?? null;
}

/** Plain names for the filing types Marsad shows. Anything else is shown by its form code. */
export const FORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '8-K': 'Current report (8-K)',
  '10-K': 'Annual report (10-K)',
  '10-Q': 'Quarterly report (10-Q)',
  '3': 'Insider initial ownership (Form 3)',
  '4': 'Insider transaction (Form 4)',
  '5': 'Insider annual statement (Form 5)',
  '144': 'Notice of proposed insider sale (Form 144)',
  '13F-HR': 'Institutional holdings (13F)',
  'DEF 14A': 'Proxy statement (DEF 14A)',
  '6-K': 'Foreign issuer report (6-K)',
  '20-F': 'Foreign issuer annual report (20-F)',
});

export function formLabel(form: string): string {
  const upper = form.toUpperCase();
  const amended = upper.endsWith('/A');
  const base = amended ? upper.slice(0, -2) : upper;
  const label = FORM_LABELS[base];
  if (!label) return form;
  return amended ? `${label}, amended` : label;
}
