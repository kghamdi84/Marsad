import { describe, expect, it } from 'vitest';
import holidays from '../../fixtures/massive/market-status-upcoming.json';
import type { CatalystScenario, DailyBar, UpcomingRow } from '@marsad/core';
import { runCatalystJob } from './catalyst-job.js';
import { fakeStore } from './fake-store.js';

// Tuesday 2026-11-24, 22:45 UTC: the session closed at 21:00 UTC.
const NOW = new Date('2026-11-24T22:45:00Z');
const scenario: CatalystScenario = {
  id: 7,
  name: 'NVDA CEO returns',
  tickers: ['NVDA', 'AMD'],
  keywords: [],
  triggers: {
    eightKItems: ['5.02'],
    form4Codes: [],
    newsMinTier: null,
    halts: false,
    movePct: null,
    volumeRatio: null,
  },
  plan: {
    entry: 'Wait for a pullback.',
    chaseGuardPct: 0.1,
    invalidation: 'Below the low.',
    size: 'half.',
  },
  expiresOn: '2026-12-31',
};
// 21 sessions of NVDA ending 2026-11-24 with a 20% jump on the last one.
const bars: DailyBar[] = Array.from({ length: 21 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 27) + i * 86_400_000);
  return {
    date: d.toISOString().slice(0, 10),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1_000_000,
    vwap: null,
  };
});
bars[20] = {
  ...(bars[20] as DailyBar),
  date: '2026-11-24',
  close: 120,
  high: 121,
  volume: 3_000_000,
};
bars[19] = { ...(bars[19] as DailyBar), date: '2026-11-23' };

describe('runCatalystJob', () => {
  it('records a confirmed 8-K match as a shadow alert with the chase guard applied; names tickers without a bar', async () => {
    const { store, log } = fakeStore({
      holidays: holidays.data as UpcomingRow[],
      scenarios: [scenario, { ...scenario, id: 8, expiresOn: '2026-11-01' }], // the second has expired
      catalystEvents: [
        {
          kind: '8-K',
          ticker: 'NVDA',
          at: '2026-11-24T13:00:00Z',
          items: ['5.02'],
          accession: '0001045810-26-000099',
        },
      ],
      bars: { NVDA: bars },
      eightKAnalogs: 4,
    });
    const run = await runCatalystJob({ store, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.details).toMatchObject({
      session: '2026-11-24',
      scenarios: 1,
      matched: 1,
      noSessionBar: ['AMD'],
      decisions: { shadow: 1 },
    });
    const a = log.storedAlerts[0]?.[0];
    expect(a?.input).toMatchObject({
      kind: 'catalyst',
      priority: 'critical',
      ruleStatus: 'shadow',
    });
    expect(a?.input.plan?.entry).toMatch(
      /^No entry: the \+20\.0% move is beyond the 10\.0% chase guard/,
    );
    expect(a?.input.trigger).toBe(
      '8-K item 5.02. Confirmed by: 8-K 0001045810-26-000099 on SEC EDGAR.',
    );
    expect(a?.input.bearCase).toContain('Only 4 comparable past 8-K filings with item 5.02 stored');
  });

  it('no active scenario is a clean run that reads nothing else', async () => {
    const { store } = fakeStore({ holidays: holidays.data as UpcomingRow[], scenarios: [] });
    expect(await runCatalystJob({ store, now: () => NOW })).toMatchObject({
      status: 'ok',
      rows_written: 0,
    });
  });
});
