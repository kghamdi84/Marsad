import { expect, test, type Page, type Route } from '@playwright/test';
import {
  baselineStudy,
  eventStudy,
  recessionFilter,
  regimeHistory,
  type MacroSeries,
  type Obs,
} from '@marsad/core';
import gprFixture from '../../../fixtures/gpr-daily-recent.json' with { type: 'json' };
import hy from '../../../fixtures/fred/fredgraph-BAMLH0A0HYM2.json' with { type: 'json' };
import ig from '../../../fixtures/fred/fredgraph-BAMLC0A0CM.json' with { type: 'json' };
import dgs10 from '../../../fixtures/fred/fredgraph-DGS10.json' with { type: 'json' };
import epu from '../../../fixtures/fred/fredgraph-USEPUINDXD.json' with { type: 'json' };
import icsa from '../../../fixtures/fred/fredgraph-ICSA.json' with { type: 'json' };
import nfci from '../../../fixtures/fred/fredgraph-NFCI.json' with { type: 'json' };
import sahm from '../../../fixtures/fred/fredgraph-SAHMREALTIME.json' with { type: 'json' };
import sp from '../../../fixtures/fred/fredgraph-SP500.json' with { type: 'json' };
import t10y2y from '../../../fixtures/fred/fredgraph-T10Y2Y.json' with { type: 'json' };
import t10y3m from '../../../fixtures/fred/fredgraph-T10Y3M.json' with { type: 'json' };
import vix from '../../../fixtures/fred/fredgraph-VIXCLS.json' with { type: 'json' };
import vix3m from '../../../fixtures/fred/fredgraph-VXVCLS.json' with { type: 'json' };
import { seedSession } from './helpers';

// Every row below is computed from the real FRED downloads in fixtures/ by the same core functions the regime job
// uses, then served in the shape of the database tables. Nothing is invented.

function csv(text: string): Obs[] {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
    .filter(([, v]) => v !== undefined && v !== '' && v !== '.')
    .map(([d, v]) => ({ date: d as string, value: Number(v) }));
}

const fred: Record<string, Obs[]> = {
  SP500: csv(sp.body),
  VIXCLS: csv(vix.body),
  VXVCLS: csv(vix3m.body),
  T10Y3M: csv(t10y3m.body),
  T10Y2Y: csv(t10y2y.body),
  DGS10: csv(dgs10.body),
  BAMLH0A0HYM2: csv(hy.body),
  BAMLC0A0CM: csv(ig.body),
  ICSA: csv(icsa.body),
  NFCI: csv(nfci.body),
  SAHMREALTIME: csv(sahm.body),
  USEPUINDXD: csv(epu.body),
};

function regimeRows() {
  const days = regimeHistory(fred['SP500'] ?? [], fred['VIXCLS'] ?? [], fred['VXVCLS'] ?? []);
  return days.slice(-252).map((d) => {
    const f = recessionFilter(fred as MacroSeries, d.date);
    return {
      date: d.date,
      rule_version: d.ruleVersion,
      label: d.label,
      reason: d.reason,
      inputs: d.inputs,
      recession_version: f.ruleVersion,
      recession_level: f.level,
      recession: { available: f.available, triggered: f.triggered, signals: f.signals },
    };
  });
}

function statRows() {
  const spx = fred['SP500'] ?? [];
  const days = regimeHistory(spx, fred['VIXCLS'] ?? [], fred['VXVCLS'] ?? []);
  const out: Record<string, unknown>[] = [];
  const push = (condition: string, stats: ReturnType<typeof baselineStudy>, episodes: string[]) =>
    stats.forEach((s) =>
      out.push({
        rule_version: 'regime-1',
        condition,
        horizon: s.horizon,
        n: s.n,
        sufficient: s.sufficient,
        median: s.median,
        q1: s.q1,
        q3: s.q3,
        episodes,
        data_from: spx[0]?.date,
        data_to: spx.at(-1)?.date,
      }),
    );
  for (const label of ['stress', 'bear', 'recovery', 'bull-calm', 'bull-correction']) {
    const e = eventStudy(
      spx,
      days.map((d) => d.label === label),
    );
    push(label, e.byHorizon, e.episodes);
  }
  const vixBy = new Map((fred['VIXCLS'] ?? []).map((o) => [o.date, o.value]));
  const v30 = eventStudy(
    spx,
    spx.map((o) => (vixBy.get(o.date) ?? 0) >= 30),
  );
  push('vix-30', v30.byHorizon, v30.episodes);
  push('all-days', baselineStudy(spx), []);
  return out;
}

async function mock(page: Page) {
  await seedSession(page, 'aal2');
  await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/rest/v1/**', (r) => json(r, []));
  await page.route('**/rest/v1/regime_daily**', (r) => json(r, [...regimeRows()].reverse()));
  await page.route('**/rest/v1/regime_event_stats**', (r) => json(r, statRows()));
  await page.route('**/rest/v1/fred_observations**', (r) => {
    const id = new URL(r.request().url()).searchParams.get('series_id')?.replace(/^eq\./, '') ?? '';
    const rows = (fred[id] ?? []).slice(-260).reverse();
    return json(r, rows);
  });
  await page.route('**/rest/v1/gpr_daily**', (r) =>
    json(
      r,
      (gprFixture.data as { date: string; GPRD: number }[])
        .map((d) => ({ date: d.date, gprd: d.GPRD }))
        .reverse(),
    ),
  );
}

test('regime: the label with its reason and inputs, the recession filter, the event study and every panel with its source and date', async ({
  page,
}) => {
  await mock(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto('/regime');

  // The label on 2026-11-23: VIX 26.62 at or above VIX3M 25.50, with the S&P 500 below its 50-day average.
  const label = page.getByRole('region', { name: 'Market regime' });
  await expect(label.getByText('Stress', { exact: true })).toBeVisible();
  await expect(label.getByText(/VIX is at or above VIX3M \(backwardation\)/)).toBeVisible();
  await expect(label.getByText('As of the close on 2026-11-23. Rules regime-1.')).toBeVisible();
  await expect(label.getByText('26.62')).toBeVisible();
  await expect(label.getByText('25.50')).toBeVisible();
  await expect(label.getByText(/FRED keeps 10 years|goes back 10 years/)).toBeVisible();

  // The recession filter on 2026-11-23: elevated, with only the curve triggered.
  const rec = page.getByRole('region', { name: 'Recession filter' });
  await expect(rec.getByText('Elevated', { exact: true })).toBeVisible();
  await expect(
    rec.getByText('1 of 5 available signals triggered (5 signals in total).'),
  ).toBeVisible();
  const curve = rec.getByRole('row', { name: /Yield curve/ });
  await expect(curve).toContainText('Triggered');
  await expect(curve).toContainText('inverted on 50 of the last 378 sessions');
  await expect(rec.getByRole('row', { name: /Sahm rule/ })).toContainText('Clear');
  await expect(rec.getByRole('row', { name: /Jobless claims/ })).toContainText('197,750');

  // The event study: 16 stress episodes with a 63-session return is not enough to show numbers.
  const study = page.getByRole('region', { name: 'What happened next (event study)' });
  await expect(study.getByRole('row', { name: /^Stress/ })).toContainText(
    'Insufficient history: 16 episodes, 30 needed',
  );
  // The benchmark has 119 one-month windows: shown with its median and middle half.
  await expect(study.getByRole('row', { name: /All days/ })).toContainText('n 119');
  await expect(study.getByText(/Data 2016-11-25 to 2026-11-23/)).toBeVisible();
  await expect(study.getByRole('columnheader', { name: '6 months (126 sessions)' })).toBeVisible();
  await expect(study.getByRole('row', { name: /VIX at or above 30/ })).toContainText(
    'Insufficient history',
  );

  // Every panel names its source and gives the date of each value.
  const vol = page.getByRole('region', { name: 'Volatility and its term structure' });
  await expect(vol.getByRole('row', { name: /^VIX / })).toContainText('2026-11-23');
  await expect(vol.getByRole('row', { name: /^VIX / })).toContainText('96'); // 95.6, the 1-year percentile
  await expect(vol.getByText(/Source: FRED VIXCLS and VXVCLS/)).toBeVisible();
  const credit = page.getByRole('region', { name: 'Credit and the curve' });
  await expect(
    credit.getByRole('row', { name: /High-yield minus investment-grade/ }),
  ).toContainText('2.66');
  await expect(credit.getByText(/Source: FRED/)).toBeVisible();
  const unc = page.getByRole('region', { name: 'Geopolitical risk and policy uncertainty' });
  await expect(unc.getByRole('row', { name: /Geopolitical Risk/ })).toContainText('2026-11-23');
  // Only 20 GPR days are recorded in the fixture: the percentile says how few it rests on.
  await expect(unc.getByRole('row', { name: /Geopolitical Risk/ })).toContainText(
    'of 20 days only',
  );
  await expect(unc.getByText(/Caldara and Iacoviello/)).toBeVisible();
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/regime.png`, fullPage: true });
});

test('regime: before the job has run, the page says so', async ({ page }) => {
  await seedSession(page, 'aal2');
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.goto('/regime');
  await expect(page.getByText('No regime has been computed yet.', { exact: false })).toBeVisible();
});
