import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secThirteenFSource } from './holders-io.js';

describe('secThirteenFSource.lines', () => {
  it('streams one file of a real zip line by line, header first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marsad-13f-test-'));
    writeFileSync(
      join(dir, 'INFOTABLE.tsv'),
      'ACCESSION_NUMBER\tNAMEOFISSUER\na1\tNVIDIA CORP\na2\tROCKET LAB CORP\n',
    );
    writeFileSync(join(dir, 'SUBMISSION.tsv'), 'ACCESSION_NUMBER\tCIK\n');
    execFileSync('zip', [
      '-q',
      '-j',
      join(dir, 'd.zip'),
      join(dir, 'INFOTABLE.tsv'),
      join(dir, 'SUBMISSION.tsv'),
    ]);
    const out: string[] = [];
    for await (const l of secThirteenFSource('Marsad research test@example.com').lines(
      join(dir, 'd.zip'),
      'INFOTABLE.tsv',
    ))
      out.push(l);
    expect(out).toEqual([
      'ACCESSION_NUMBER\tNAMEOFISSUER',
      'a1\tNVIDIA CORP',
      'a2\tROCKET LAB CORP',
    ]);
  });
  it('refuses to download anything but an SEC zip', async () => {
    await expect(
      secThirteenFSource('Marsad research test@example.com').download('https://example.com/x.zip'),
    ).rejects.toThrow('Not an SEC data set');
  });
});
