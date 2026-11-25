import { describe, expect, it } from 'vitest';
import { extractQuarterlyRiskFactors, htmlToText } from './tenq.js';

describe('htmlToText', () => {
  it('drops the hidden XBRL header, scripts and tags, decodes entities and keeps block breaks', () => {
    const html =
      '<html><body><div style="display:none"><ix:header><ix:hidden>secret 123</ix:hidden></ix:header></div>' +
      '<script>var x = 1;</script><p>Item&#160;1A.&nbsp;Risk Factors</p><p>We&#8217;re exposed to AT&amp;T&#x2019;s pricing.</p>' +
      '<table><tr><td>a</td><td>b</td></tr></table></body></html>';
    expect(htmlToText(html)).toBe('Item 1A. Risk Factors\nWe’re exposed to AT&T’s pricing.\na b');
  });
});

describe('extractQuarterlyRiskFactors', () => {
  const doc = (body: string) =>
    [
      'PART II OTHER INFORMATION',
      'Item 1A. Risk Factors 45',
      'Item 2. Unregistered Sales of Equity Securities 46',
      'PART I',
      'Item 1. Financial Statements ...',
      'PART II',
      'Item 1A. Risk Factors',
      body,
      'Item 2. Unregistered Sales of Equity Securities and Use of Proceeds',
      'None.',
    ].join('\n');

  it('takes the real section, not the table-of-contents line', () => {
    const r = extractQuarterlyRiskFactors(
      htmlToText(
        doc(
          'In addition to the other information, you should consider the risk factors below. Export controls may change our China sales.',
        ),
      ),
    );
    expect(r).toEqual({
      text: 'In addition to the other information, you should consider the risk factors below. Export controls may change our China sales.',
      noMaterialChanges: false,
    });
  });

  it('recognizes a "no material changes" statement', () => {
    const r = extractQuarterlyRiskFactors(
      doc(
        'There have been no material changes to the risk factors disclosed in our Annual Report on Form 10-K for fiscal 2026.',
      ),
    );
    expect(r?.noMaterialChanges).toBe(true);
  });

  it('ignores a cross-reference inside a sentence', () => {
    const r = extractQuarterlyRiskFactors(
      [
        "Item 2. Management's Discussion",
        'Refer to Part II, Item 1A. Risk Factors for more.',
        'PART II',
        'Item 1A. Risk Factors',
        'Our supply chain depends on a few foundries.',
        'Item 2. Unregistered Sales of Equity Securities',
      ].join('\n'),
    );
    expect(r?.text).toBe('Our supply chain depends on a few foundries.');
  });

  it('a qualified statement ("other than ... below") lists changes, so it is not "no material changes"', () => {
    const r = extractQuarterlyRiskFactors(
      doc(
        'Other than as set forth below, there have been no material changes from the risk factors previously disclosed in our Annual Report. The Iridium transaction may not close.',
      ),
    );
    expect(r?.noMaterialChanges).toBe(false);
  });

  it('returns null when it cannot find the section, rather than an empty update', () => {
    expect(extractQuarterlyRiskFactors('PART II\nItem 5. Other Information\nNone.')).toBeNull();
  });
});
