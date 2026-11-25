import { describe, expect, it } from 'vitest';
import { lines, validateThesis, type ThesisDraft } from './thesis.js';

const ok: ThesisDraft = {
  ticker: 'RKLB',
  status: 'intact',
  bull: 'Launch cadence and Neutron could take share from incumbents.',
  bear: 'Neutron slips again, cash burn forces dilution, and the valuation already prices in success.',
  risks: ['Neutron delay', 'Dilution'],
  changeView: 'A second Neutron slip past mid-2027, or an equity raise above USD 500 million.',
  sources: ['https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001819994'],
};

describe('validateThesis', () => {
  it('accepts a complete card', () => {
    expect(validateThesis(ok)).toEqual([]);
  });
  it('requires a real bear case and something observable that would change the view', () => {
    expect(validateThesis({ ...ok, bear: 'Could go down.', changeView: '' })).toEqual([
      'The bear case is required: at least 40 characters, a real argument.',
      'Say what would change your view: at least 40 characters, something you could observe.',
    ]);
  });
  it('requires a bull case and a risk; sources must be https', () => {
    expect(
      validateThesis({ ...ok, bull: ' ', risks: [' '], sources: ['http://x.com', 'ftp://y'] }),
    ).toEqual([
      'Write the bull case.',
      'Name at least one key risk.',
      'Sources must be https links: http://x.com, ftp://y.',
    ]);
  });
  it('rejects a bad ticker', () => {
    expect(validateThesis({ ...ok, ticker: 'rk lb' })).toContain('The ticker is not valid.');
  });
});

describe('lines', () => {
  it('trims and drops empty lines', () => {
    expect(lines(' a \r\n\n b\n')).toEqual(['a', 'b']);
  });
});
