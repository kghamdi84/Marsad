import { describe, expect, it } from 'vitest';
import hy from '../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json';
import icsa from '../../fixtures/fred/fredgraph-ICSA.json';
import nfci from '../../fixtures/fred/fredgraph-NFCI.json';
import sahm from '../../fixtures/fred/fredgraph-SAHMREALTIME.json';
import sp from '../../fixtures/fred/fredgraph-SP500.json';
import curve from '../../fixtures/fred/fredgraph-T10Y3M.json';
import vix from '../../fixtures/fred/fredgraph-VIXCLS.json';
import vix3m from '../../fixtures/fred/fredgraph-VXVCLS.json';
import {
  classifyRegime,
  recessionFilter,
  type FredObservation,
  type RegimeInputs,
} from '@marsad/core';
import { fakeStore } from './fake-store.js';
import { runRegimeJob } from './regime-job.js';

/** The FRED graph download as stored rows: a blank or "." becomes a null value, as the FRED job stores it. */
function rows(text: string): FredObservation[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .map(([d, v]) => ({
      date: d as string,
      value: v === undefined || v === '' || v === '.' ? null : Number(v),
    }));
}

const fred = {
  SP500: rows(sp.body),
  VIXCLS: rows(vix.body),
  VXVCLS: rows(vix3m.body),
  T10Y3M: rows(curve.body),
  BAMLH0A0HYM2: rows(hy.body),
  ICSA: rows(icsa.body),
  NFCI: rows(nfci.body),
  SAHMREALTIME: rows(sahm.body),
};

describe('runRegimeJob on the real FRED history', () => {
  it('stores every S&P 500 session with its label, inputs and recession filter, and the event statistics', async () => {
    const { store, log } = fakeStore({ fred });
    const run = await runRegimeJob({ store, now: () => new Date('2026-11-25T01:15:00Z') });
    expect(run.status).toBe('ok');
    // 2,607 rows in the download, 95 of them blank holidays: 2,512 sessions with a value, each stored.
    expect(run.rows_written).toBe(2512);
    expect(run.details).toMatchObject({
      latest: '2026-11-23',
      label: 'stress',
      recession: 'elevated',
      from: '2016-11-25',
      to: '2026-11-23',
    });
    const days = log.regimeDays.flat();
    const last = days.at(-1);
    expect(last).toMatchObject({
      date: '2026-11-23',
      ruleVersion: 'regime-1',
      recessionVersion: 'recession-1',
    });
    // Reproducible from what is stored: the stored inputs give the stored label again.
    const again = classifyRegime(last?.inputs as unknown as RegimeInputs, false);
    expect(again.label).toBe(last?.label);
    // 5 labels, VIX at or above 30, and all days, each at 21, 63 and 126 sessions.
    const stats = log.eventStats[0];
    expect(stats?.ruleVersion).toBe('regime-1');
    expect(stats?.rows).toHaveLength(21);
    const stress63 = stats?.rows.find((r) => r.condition === 'stress' && r.horizon === 63);
    expect(stress63).toMatchObject({
      n: 16,
      sufficient: false,
      dataFrom: '2016-11-25',
      dataTo: '2026-11-23',
    });
    expect(stress63?.episodes).toHaveLength(17);
    expect(stats?.rows.find((r) => r.condition === 'all-days' && r.horizon === 21)).toMatchObject({
      n: 119,
      sufficient: true,
    });
    expect(log.runs[0]?.job).toBe('regime-daily');
  });

  it('the stored recession filter for each day matches a fresh computation for that day', async () => {
    const { store, log } = fakeStore({ fred });
    await runRegimeJob({ store, now: () => new Date('2026-11-25T01:15:00Z') });
    const day = log.regimeDays.flat().find((d) => d.date === '2024-08-12');
    expect(day?.recessionLevel).toBe('high'); // the Sahm rule counts as published from 2024-08-10
    const macro = Object.fromEntries(
      Object.entries(fred).map(([k, v]) => [k, v.filter((o) => o.value !== null)]),
    ) as never;
    expect(recessionFilter(macro, '2024-08-12').level).toBe('high');
  });

  it('fails loudly when the newest S&P 500 close is more than 5 days old, after storing what it computed', async () => {
    const { store, log } = fakeStore({ fred });
    const run = await runRegimeJob({ store, now: () => new Date('2026-12-02T01:15:00Z') });
    expect(run.status).toBe('error');
    expect(run.error).toContain('newest S&P 500 close is 2026-11-23 (9 days old)');
    expect(log.regimeDays.flat()).toHaveLength(2512);
  });

  it('refuses to compute without enough S&P 500 history', async () => {
    const { store } = fakeStore({ fred: { ...fred, SP500: fred.SP500.slice(-100) } });
    const run = await runRegimeJob({ store, now: () => new Date('2026-11-25T01:15:00Z') });
    expect(run.status).toBe('error');
    expect(run.error).toContain('S&P 500 history has');
  });
});
