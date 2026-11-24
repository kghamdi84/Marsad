import { describe, expect, it } from 'vitest';
import sales from '../../../fixtures/sec/form4-0001696841-26-000016.json';
import giftA from '../../../fixtures/sec/form4-0001197647-26-000011.json';
import giftB from '../../../fixtures/sec/form4-0001197647-26-000013.json';
import { Form4ParseError, parseForm4, summarizeForm4 } from './form4.js';
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
