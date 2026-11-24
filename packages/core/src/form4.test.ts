import { describe, expect, it } from 'vitest';
import sales from '../../../fixtures/sec/form4-0001696841-26-000016.json';
import giftA from '../../../fixtures/sec/form4-0001197647-26-000011.json';
import giftB from '../../../fixtures/sec/form4-0001197647-26-000013.json';
import form3Mixed from '../../../fixtures/sec/form3-0002164059-26-000002.json';
import form3Rsu from '../../../fixtures/sec/form3-0002163374-26-000002.json';
import form3None from '../../../fixtures/sec/form3-0001773751-26-000248.json';
import form3Joint from '../../../fixtures/sec/form3A-0001209191-22-023889.json';
import form5Grants from '../../../fixtures/sec/form5-0001193125-26-055644.json';
import form5Amended from '../../../fixtures/sec/form5A-0001045810-25-000070.json';
import {
  Form4ParseError,
  parseForm4,
  summarizeForm4,
  summarizeRecentOpenMarket,
  type InsiderTradeLine,
} from './form4.js';
import { child, parseXml, text, XmlError } from './xml.js';

describe('the real NVIDIA Form 4 with 12 open-market sales (filed 2026-11-21)', () => {
  const doc = parseForm4(sales.body);
  it('reads the filing header, the insider and the 10b5-1 flag', () => {
    expect(doc).toMatchObject({
      documentType: '4',
      periodOfReport: '2026-11-19',
      issuer: { cik: '0001045810', name: 'NVIDIA CORP', symbol: 'NVDA' },
      plan10b5: true,
    });
    expect(doc.owners).toEqual([
      {
        cik: '0001696841',
        name: 'Teter Timothy S.',
        isDirector: false,
        isOfficer: true,
        officerTitle: 'EVP, General Counsel and Sec',
        isTenPercentOwner: false,
        isOther: false,
      },
    ]);
  });
  it('reads every sale with its weighted-average price and the shares left afterwards', () => {
    expect(doc.transactions).toHaveLength(12);
    expect(doc.transactions.every((t) => t.code === 'S' && t.acquiredDisposed === 'D')).toBe(true);
    expect(doc.transactions[0]).toMatchObject({
      shares: 1434,
      pricePerShare: 146.0298,
      sharesAfter: 2686226,
      date: '2026-11-19',
    });
    expect(doc.transactions[11]).toMatchObject({
      shares: 1410,
      pricePerShare: 157.4947,
      sharesAfter: 2657660,
    });
  });
  it('attaches footnote text to the transactions that cite it, including the 10b5-1 plan statement', () => {
    expect(doc.transactions[0]?.footnotes.some((f) => f.includes('Rule 10b5-1 trading plan'))).toBe(
      true,
    );
  });
  it('totals match an independent computation: 30,000 shares sold for $4,542,781.49', () => {
    const s = summarizeForm4(doc);
    expect(s.netSharesByCode).toEqual({ S: -30000 });
    expect(s.soldUsd).toBeCloseTo(4542781.4904, 4);
    expect(s.purchasedUsd).toBe(0);
  });
});

describe('the real NVIDIA director gifts under a 10b5-1 plan', () => {
  it('reads a gift (code G) at a zero price with no dollar value, and ignores holdings rows', () => {
    for (const f of [giftA, giftB]) {
      const doc = parseForm4(f.body);
      expect(doc.owners[0]).toMatchObject({
        name: 'COXE TENCH',
        isDirector: true,
        isOfficer: false,
        officerTitle: null,
      });
      expect(doc.plan10b5).toBe(true);
      expect(doc.transactions).toHaveLength(1);
      expect(doc.transactions[0]).toMatchObject({
        code: 'G',
        shares: 500000,
        pricePerShare: 0,
        acquiredDisposed: 'D',
        ownership: 'I',
        valueUsd: null,
      });
    }
    expect(parseForm4(giftB.body).transactions[0]?.sharesAfter).toBe(23171360);
  });
});

// Expected values below were read from the recorded documents with a separate Python script (ElementTree), not from
// this parser. All six documents are real filings recorded on 2026-11-24.
describe('real Form 3 documents (holdings, not trades)', () => {
  it('reads an Oklo officer: common stock plus restricted stock units and two option grants', () => {
    const d = parseForm4(form3Mixed.body);
    expect(d).toMatchObject({
      documentType: '3',
      periodOfReport: '2026-11-04',
      isAmendment: false,
      noSecuritiesOwned: false,
      dateOfOriginalSubmission: null,
      issuer: { cik: '0001849056', symbol: 'OKLO' },
    });
    expect(d.owners[0]).toMatchObject({
      name: 'Petit de Mange Edward',
      isOfficer: true,
      officerTitle: 'VP of Recycling',
    });
    expect(d.transactions).toEqual([]); // a Form 3 reports no trades
    expect(d.holdings).toHaveLength(6);
    expect(d.holdings[0]).toMatchObject({
      table: 'non-derivative',
      securityTitle: 'Class A Common Stock',
      shares: 61985,
      ownership: 'D',
      natureOfOwnership: null,
    });
    // The restricted stock units give only footnotes for price and dates, so those are null rather than guessed.
    expect(d.holdings[1]).toMatchObject({
      table: 'derivative',
      securityTitle: 'Restricted Stock Units',
      shares: null,
      exercisePrice: null,
      exerciseDate: null,
      expirationDate: null,
      underlyingTitle: 'Class A Common Stock',
      underlyingShares: 1938,
    });
    expect(d.holdings.slice(1, 4).map((h) => h.underlyingShares)).toEqual([1938, 2171, 1156]);
    expect(d.holdings[4]).toMatchObject({
      securityTitle: 'Stock Option',
      exercisePrice: 3.18,
      expirationDate: '2033-12-22',
      underlyingShares: 109116,
    });
    expect(d.holdings[5]).toMatchObject({
      exercisePrice: 0.41,
      expirationDate: '2032-11-09',
      underlyingShares: 155387,
    });
  });
  it('reads a Form 3 with one block of restricted stock units and nothing else', () => {
    const d = parseForm4(form3Rsu.body);
    expect(d.holdings).toHaveLength(1);
    expect(d.holdings[0]).toMatchObject({
      table: 'derivative',
      underlyingShares: 30000,
      ownership: 'D',
    });
    expect(d.noSecuritiesOwned).toBe(false);
  });
  it('a Form 3 that says the person owns nothing is an explicit statement, not missing data', () => {
    const d = parseForm4(form3None.body);
    expect(d.noSecuritiesOwned).toBe(true);
    expect(d.holdings).toEqual([]);
    expect(d.owners[0]).toMatchObject({ name: 'Huberman Andrew D', isDirector: true });
  });
  it('a joint Form 3/A names all four reporting owners and marks itself an amendment', () => {
    const d = parseForm4(form3Joint.body);
    expect(d.documentType).toBe('3/A');
    expect(d.isAmendment).toBe(true);
    expect(d.dateOfOriginalSubmission).toBe('2021-10-04');
    expect(d.owners.map((o) => o.name)).toEqual([
      'GV 2019 GP, L.L.C.',
      'GV 2019 GP, L.P.',
      'GV 2019, L.P.',
      'Alphabet Inc.',
    ]);
    expect(d.holdings).toHaveLength(1);
    expect(d.holdings[0]).toMatchObject({
      shares: 4556532,
      ownership: 'I',
      natureOfOwnership: 'By GV 2019 L.P.',
    });
    expect(d.holdings[0]?.footnotes.length).toBeGreaterThan(0);
  });
});

describe('real Form 5 documents (trades reported after the fact)', () => {
  it('reads restricted stock unit grants as derivative transactions at a zero price, and a false plan box', () => {
    const d = parseForm4(form5Grants.body);
    expect(d).toMatchObject({
      documentType: '5',
      periodOfReport: '2025-12-31',
      plan10b5: false,
      isAmendment: false,
    });
    expect(d.noSecuritiesOwned).toBeNull(); // only a Form 3 has the flag
    expect(
      d.transactions.map((t) => [
        t.table,
        t.date,
        t.code,
        t.shares,
        t.pricePerShare,
        t.acquiredDisposed,
      ]),
    ).toEqual([
      ['derivative', '2025-12-22', 'A', 15574, 0, 'A'],
      ['derivative', '2025-12-22', 'A', 71811, 0, 'A'],
    ]);
    expect(d.owners[0]?.name).toBe('Cochran Caroline');
  });
  it('an amended Form 5 reports two sales from 2023 and 2024, years before it was filed, and a holding', () => {
    const d = parseForm4(form5Amended.body);
    expect(d).toMatchObject({
      documentType: '5/A',
      isAmendment: true,
      dateOfOriginalSubmission: '2025-03-12',
      periodOfReport: '2025-01-26',
    });
    expect(
      d.transactions.map((t) => [
        t.date,
        t.code,
        t.shares,
        t.pricePerShare,
        t.sharesAfter,
        t.ownership,
      ]),
    ).toEqual([
      ['2023-12-13', 'S', 65000, 48.2582, 212740, 'I'],
      ['2024-06-14', 'S', 34000, 131.7047, 178740, 'I'],
    ]);
    // 65,000 x 48.2582 = 3,136,783 and 34,000 x 131.7047 = 4,477,959.80 (worked out separately).
    expect(d.transactions.map((t) => t.valueUsd)).toEqual(
      [3_136_783, 4_477_959.8].map((v) => expect.closeTo(v, 4)),
    );
    expect(d.holdings).toEqual([
      expect.objectContaining({
        table: 'non-derivative',
        securityTitle: 'Common Stock',
        shares: 2088,
        ownership: 'D',
      }),
    ]);
  });
  it('a Form 4 is not an amendment, has no Form 3 flag, and its holdings rows are read too', () => {
    const d = parseForm4(sales.body);
    expect([d.isAmendment, d.noSecuritiesOwned, d.dateOfOriginalSubmission]).toEqual([
      false,
      null,
      null,
    ]);
    expect(d.holdings).toEqual([
      expect.objectContaining({
        table: 'non-derivative',
        securityTitle: 'Common Stock',
        shares: 268238,
        ownership: 'D',
      }),
    ]);
    // A director's Form 4 lists both a direct holding and an indirect one held through a plan trust.
    expect(
      parseForm4(giftB.body).holdings.map((h) => [h.shares, h.ownership, h.natureOfOwnership]),
    ).toEqual([
      [57378, 'D', null],
      [4852480, 'I', 'By Profit Sharing Plan Trust'],
    ]);
  });
});

describe('documents the recordings do not cover (hand-built, labelled synthetic)', () => {
  const wrap = (body: string) =>
    `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><periodOfReport>2026-01-02</periodOfReport><issuer><issuerCik>0000000001</issuerCik><issuerName>TestCo</issuerName></issuer><reportingOwner><reportingOwnerId><rptOwnerCik>0000000002</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner>${body}</ownershipDocument>`;
  const nd = (code: string, ad: string, shares: number, price: number) =>
    `<nonDerivativeTransaction><securityTitle><value>Common</value></securityTitle><transactionDate><value>2026-01-02</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>`;

  it('counts an open-market purchase as bought dollars and nets purchases against sales per code', () => {
    const doc = parseForm4(
      wrap(
        `<nonDerivativeTable>${nd('P', 'A', 1000, 10.5)}${nd('S', 'D', 400, 11)}</nonDerivativeTable>`,
      ),
    );
    expect(summarizeForm4(doc)).toEqual({
      netSharesByCode: { P: 1000, S: -400 },
      purchasedUsd: 10500,
      soldUsd: 4400,
    });
    expect(doc.plan10b5).toBeNull(); // no aff10b5One element: an older form, so unknown, not false
  });
  it('reads a derivative transaction (an option exercise) and keeps it out of the share totals', () => {
    const dv = `<derivativeTable><derivativeTransaction><securityTitle><value>Stock option</value></securityTitle><conversionOrExercisePrice><value>25.5</value></conversionOrExercisePrice><transactionDate><value>2026-01-02</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>5000</value></transactionShares></transactionAmounts><underlyingSecurity><underlyingSecurityShares><value>5000</value></underlyingSecurityShares></underlyingSecurity></derivativeTransaction></derivativeTable>`;
    const doc = parseForm4(wrap(dv));
    expect(doc.transactions[0]).toMatchObject({
      table: 'derivative',
      code: 'M',
      shares: 5000,
      exercisePrice: 25.5,
    });
    expect(summarizeForm4(doc).netSharesByCode).toEqual({});
  });
  it('reads a false 10b5-1 box as false', () => {
    expect(parseForm4(wrap('<aff10b5One>0</aff10b5One>')).plan10b5).toBe(false);
  });
});

describe('a broken document is an error, never a partial result', () => {
  it('rejects malformed XML', () => {
    expect(() => parseForm4('<ownershipDocument><a></ownershipDocument>')).toThrow(Form4ParseError);
    expect(() => parseForm4('not xml at all')).toThrow(Form4ParseError);
  });
  it('rejects the wrong document, a missing owner and a non-numeric share count', () => {
    expect(() => parseForm4('<html><body>Rate limit exceeded</body></html>')).toThrow(
      /not ownershipDocument/,
    );
    const head = (extra: string) =>
      `<ownershipDocument><documentType>4</documentType><periodOfReport>2026-01-02</periodOfReport><issuer><issuerCik>1</issuerCik></issuer>${extra}</ownershipDocument>`;
    expect(() => parseForm4(head(''))).toThrow(/No reporting owner/);
    expect(() =>
      parseForm4(
        head(
          `<reportingOwner><reportingOwnerId><rptOwnerCik>2</rptOwnerCik></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>2026-01-02</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>lots</value></transactionShares></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable>`,
        ),
      ),
    ).toThrow(/Not a number/);
  });
});

describe('the XML reader', () => {
  it('reads attributes, self-closing tags, entities and comments', () => {
    const n = parseXml(
      '<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b id=\'F1\'/><c>R&amp;D &#169; &lt;ok&gt;</c></a>',
    );
    expect(n.attrs['x']).toBe('1 & 2');
    expect(child(n, 'b')?.attrs['id']).toBe('F1');
    expect(text(n, 'c')).toBe('R&D © <ok>');
  });
  it('throws on unbalanced tags, trailing text and several roots', () => {
    for (const bad of ['<a><b></a>', '<a></a>junk', '<a></a><b></b>', '<a>', ''])
      expect(() => parseXml(bad), bad).toThrow(XmlError);
  });
});

describe('recent open-market totals', () => {
  const line = (over: Partial<InsiderTradeLine>): InsiderTradeLine => ({
    table: 'non-derivative',
    date: '2026-11-19',
    code: 'S',
    shares: 100,
    valueUsd: 1000,
    isAmendment: false,
    ...over,
  });
  const since = '2026-08-27'; // 90 days before 2026-11-25
  it('adds sales and purchases separately: 100 + 50 shares sold for $1,000 + $750, 20 bought for $300', () => {
    const r = summarizeRecentOpenMarket(
      [
        line({}),
        line({ shares: 50, valueUsd: 750 }),
        line({ code: 'P', shares: 20, valueUsd: 300 }),
      ],
      since,
    );
    expect(r).toEqual({
      soldShares: 150,
      soldUsd: 1750,
      boughtShares: 20,
      boughtUsd: 300,
      amendmentLines: 0,
    });
  });
  it('leaves out a trade older than the window, including one a late Form 5 reports now', () => {
    // The real 5/A in fixtures reports sales from 2023-12-13 and 2024-06-14: far outside any 90-day window.
    const r = summarizeRecentOpenMarket(
      [line({ date: '2026-08-26' }), line({ date: '2024-06-14' })],
      since,
    );
    expect(r.soldShares).toBe(0);
    expect(summarizeRecentOpenMarket([line({ date: '2026-08-27' })], since).soldShares).toBe(100); // the first day counts
  });
  it('does not add a line from an amendment, and counts how many it left out', () => {
    const r = summarizeRecentOpenMarket(
      [line({}), line({ isAmendment: true }), line({ isAmendment: true, code: 'P' })],
      since,
    );
    expect(r).toMatchObject({ soldShares: 100, soldUsd: 1000, boughtShares: 0, amendmentLines: 2 });
  });
  it('ignores derivative rows, other codes (gifts, tax withholding) and lines with no share count', () => {
    const r = summarizeRecentOpenMarket(
      [
        line({ table: 'derivative' }),
        line({ code: 'G' }),
        line({ code: 'F' }),
        line({ shares: null }),
      ],
      since,
    );
    expect(r).toEqual({
      soldShares: 0,
      soldUsd: 0,
      boughtShares: 0,
      boughtUsd: 0,
      amendmentLines: 0,
    });
  });
  it('counts shares even when there is no price, adding nothing to the dollars', () => {
    expect(summarizeRecentOpenMarket([line({ valueUsd: null })], since)).toMatchObject({
      soldShares: 100,
      soldUsd: 0,
    });
  });
});
