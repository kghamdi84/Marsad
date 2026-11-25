import { describe, expect, it } from 'vitest';
import {
  capitulationAlert,
  capitulationDay,
  capitulationHistory,
  capitulationTriggers,
  episodeLosses,
  stagedPlan,
  type SpyBar,
} from './capitulation.js';
import type { RecessionLevel } from './regime.js';

const base = {
  date: '2026-03-10',
  vix: 35.9,
  above50: 90,
  n50: 1000,
  composite: 6,
  recession: 'low' as RecessionLevel,
};

describe('capitulationDay', () => {
  it('fires when all four conditions hold (the brief example: VIX 35.9, 9%, composite 6, low)', () => {
    const d = capitulationDay(base);
    expect(d.state).toBe('on');
    expect(d.conditions.map((c) => [c.key, c.value, c.met])).toEqual([
      ['vix', 35.9, true],
      ['breadth', 9, true],
      ['composite', 6, true],
      ['recession', 'low', true],
    ]);
  });

  it('uses inclusive thresholds: VIX 30, 15% and composite 15 still count', () => {
    expect(capitulationDay({ ...base, vix: 30, above50: 150, composite: 15 }).state).toBe('on');
    expect(capitulationDay({ ...base, vix: 29.99 }).state).toBe('off');
    expect(capitulationDay({ ...base, above50: 151 }).state).toBe('off');
    expect(capitulationDay({ ...base, composite: 15.01 }).state).toBe('off');
  });

  it('elevated recession still allows it; high blocks it', () => {
    expect(capitulationDay({ ...base, recession: 'elevated' }).state).toBe('on');
    expect(capitulationDay({ ...base, recession: 'high' }).state).toBe('off');
  });

  it('is unavailable, not off, when data is missing and nothing fails', () => {
    expect(capitulationDay({ ...base, composite: null }).state).toBe('unavailable');
    expect(capitulationDay({ ...base, recession: 'unavailable' }).state).toBe('unavailable');
    // too few members with 50 sessions: the breadth reading is not trusted
    const thin = capitulationDay({ ...base, n50: 499, above50: 10 });
    expect(thin.state).toBe('unavailable');
    expect(thin.conditions[1]).toMatchObject({ value: null, met: null });
  });

  it('is off when any condition with data fails, even if another has no data', () => {
    expect(capitulationDay({ ...base, vix: 20, composite: null }).state).toBe('off');
  });
});

describe('capitulationHistory and triggers', () => {
  it('builds days from keyed series and finds the first day of each run', () => {
    const dates = ['d1', 'd2', 'd3', 'd4', 'd5'];
    const vix = dates.map((date, i) => ({ date, value: [20, 31, 32, 25, 33][i] as number }));
    const breadth = new Map(dates.map((d) => [d, { above50: 100, n50: 1000 }]));
    const composite = new Map(dates.map((d) => [d, 10]));
    const rec = new Map(dates.map((d) => [d, 'low' as RecessionLevel]));
    const days = capitulationHistory(dates, vix, breadth, composite, rec);
    expect(days.map((d) => d.state)).toEqual(['off', 'on', 'on', 'off', 'on']);
    expect(capitulationTriggers(days)).toEqual(['d2', 'd5']);
  });
});

/** Sessions numbered from 0; closes and lows as given. */
function bars(closes: number[], lows?: number[]): SpyBar[] {
  return closes.map((close, i) => ({
    date: `s${String(i).padStart(3, '0')}`,
    close,
    low: lows?.[i] ?? close,
  }));
}

describe('stagedPlan (hand-checked scenarios)', () => {
  // 50 flat sessions at 100 (50-day average 100), then a selloff to 80 at session 55 (the trigger).
  const closes = [
    ...Array.from({ length: 50 }, () => 100),
    95,
    90,
    86,
    83,
    81,
    80, // s055 trigger, selloff low 80
  ];
  const rec = new Map<string, RecessionLevel>();

  it('step 1 is the trigger close; nothing else is due yet', () => {
    const p = stagedPlan('s055', bars(closes), rec);
    expect(p).toMatchObject({ triggerClose: 80, selloffLow: 80, sessionsSince: 0 });
    expect(p?.tranches.map((t) => t.status)).toEqual(['met', 'waiting', 'waiting']);
  });

  it('a retest needs 5 sessions after the low, a low within 2% and a close at or above it', () => {
    // s056..s059 bounce, s060 dips to 81.5 (within 2% of 80) but only 5 sessions after s055: counts
    const after = [84, 86, 85, 84, 82];
    const lows = [...closes, 83, 85, 84, 83, 81.5];
    const p = stagedPlan('s055', bars([...closes, ...after], lows), rec);
    expect(p?.tranches[1]).toMatchObject({ status: 'met', date: 's060', level: 80 });
  });

  it('a dip 4 sessions after the low is too early to be a retest', () => {
    // s059 (4 sessions after the s055 low) dips to 80.5; s060 holds at 83: no retest yet
    const after = [84, 86, 85, 82, 83];
    const lows = [...closes, 83, 85, 84, 80.5, 83];
    const p = stagedPlan('s055', bars([...closes, ...after], lows), rec);
    expect(p?.tranches[1]).toMatchObject({ status: 'waiting', date: null });
  });

  it('a lower close moves the low and restarts the count', () => {
    // s057 closes at 78 (new low), so a dip at s060 is only 3 sessions later: not yet a retest
    const after = [82, 78, 81, 82, 79.2, 80, 80.5, 79.5];
    const p = stagedPlan('s055', bars([...closes, ...after]), rec);
    expect(p?.selloffLow).toBe(78);
    // s062 (5 sessions after s057) has low 80.5, within 2% of 78 (79.56)? no; s063 low 79.5 <= 79.56 and close >= 78
    expect(p?.tranches[1]).toMatchObject({ status: 'met', date: 's063' });
  });

  it('step 3 is the first close above the 50-day average after the trigger', () => {
    const after = Array.from({ length: 10 }, (_, i) => 85 + i * 2); // 85 .. 103
    const p = stagedPlan('s055', bars([...closes, ...after]), rec);
    const t3 = p?.tranches[2];
    expect(t3?.status).toBe('met');
    // By hand: the selloff (95, 90, 86, 83, 81, 80 = 515) and the rebound enter the 50-session window.
    // s062 closes 97; its window is 37 x 100 + 515 + 85 + 87 + 89 + 91 + 93 + 95 + 97 = 4852, average 97.04: not above.
    // s063 closes 99; its window is 36 x 100 + 515 + 85 + ... + 99 (736) = 4851, average 97.02: above.
    expect((37 * 100 + 515 + 85 + 87 + 89 + 91 + 93 + 95 + 97) / 50).toBeCloseTo(97.04, 10);
    expect((36 * 100 + 515 + 736) / 50).toBeCloseTo(97.02, 10);
    expect(t3?.date).toBe('s063');
  });

  it('pauses the remaining steps when the recession filter turns high', () => {
    const after = [84, 86, 85, 84, 82];
    const lows = [...closes, 83, 85, 84, 83, 81.5];
    const high = new Map<string, RecessionLevel>([['s058', 'high']]);
    const p = stagedPlan('s055', bars([...closes, ...after], lows), high);
    expect(p?.pausedOn).toBe('s058');
    expect(p?.tranches.map((t) => t.status)).toEqual(['met', 'paused', 'paused']);
  });

  it('keeps a step met before the pause and pauses the rest', () => {
    const after = [84, 86, 85, 84, 82, 83, 84];
    const lows = [...closes, 83, 85, 84, 83, 81.5, 83, 84];
    const high = new Map<string, RecessionLevel>([['s062', 'high']]);
    const p = stagedPlan('s055', bars([...closes, ...after], lows), high);
    expect(p?.tranches.map((t) => t.status)).toEqual(['met', 'met', 'paused']);
    expect(p?.tranches[1]?.date).toBe('s060');
  });

  it('flags a close more than 10% below the trigger close for review', () => {
    const p = stagedPlan('s055', bars([...closes, 75, 71.9, 72]), rec);
    expect(p?.reviewOn).toBe('s057');
  });

  it('expires after 126 sessions', () => {
    // A flat 79 never closes above its own 50-day average (which is at least 79), so step 3 is never met.
    const after = Array.from({ length: 127 }, () => 79);
    const p = stagedPlan('s055', bars([...closes, ...after]), rec);
    expect(p?.expired).toBe(true);
    expect(p?.selloffLow).toBe(79);
    expect(p?.tranches.map((t) => t.status)).toEqual(['met', 'met', 'expired']);
  });

  it('returns null without a SPY bar on the trigger date', () => {
    expect(stagedPlan('nope', bars(closes), rec)).toBeNull();
  });
});

describe('episodeLosses', () => {
  const s = [100, 101, 99, 102, 98, 103].map((value, i) => ({ date: `2026-01-0${i + 1}`, value }));
  it('counts episodes whose close 2 sessions later is lower, leaving out those without that close', () => {
    // 01: 100 -> 99 loss; 02: 101 -> 102 gain; 04: 102 -> 103 gain; 05: no close 2 sessions later; 09: not in series.
    expect(
      episodeLosses(s, ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-09'], 2),
    ).toEqual({
      n: 3,
      losses: 1,
    });
  });
  it('an equal close is not a loss', () => {
    const flat = [5, 6, 5].map((value, i) => ({ date: `d${i}`, value }));
    expect(episodeLosses(flat, ['d0'], 2)).toEqual({ n: 1, losses: 0 });
  });
});

describe('capitulationAlert', () => {
  const day = capitulationDay({
    date: '2026-03-09',
    vix: 35.94,
    above50: 90,
    n50: 1000,
    composite: 6.4,
    recession: 'low',
  });
  const plan = {
    version: 'capitulation-1',
    triggerDate: '2026-03-09',
    triggerClose: 480,
    selloffLow: 470.5,
    sessionsSince: 0,
    expired: false,
    pausedOn: null,
    reviewOn: null,
    tranches: [],
  };
  const at = new Date('2026-03-10T12:00:00Z');
  const study = {
    horizon: 63,
    n: 41,
    median: 0.061,
    q1: -0.024,
    q3: 0.11,
    dataFrom: '1990-01-02',
    episodes: [],
    losses: { n: 41, losses: 12 },
  };

  it('writes the brief example 3 card from the stored numbers', () => {
    const a = capitulationAlert(day, plan, study, { regime: 'stress' }, at, at);
    expect(a.headline).toBe('Capitulation watch ON');
    expect(a.kind).toBe('regime');
    expect(a.priority).toBe('high');
    expect(a.eventId).toBe('capitulation:2026-03-09');
    expect(a.trigger).toBe(
      'Trigger at the close of 2026-03-09: VIX 35.9 (at least 30); 9.0% of the Marsad universe above its 50-day average (at most 15%); Fear and Greed composite 6 (at most 15); recession filter low (not high). Marsad event study (VIX close at least 30 with the recession filter not high, S&P 500 since 1990-01-02): 63-session forward return median +6.1%, 25th percentile -2.4%, 75th percentile +11.0%, n=41 episodes.',
    );
    // Review level: 480 x 0.9 = 432.00.
    expect(a.plan?.entry).toContain(
      'SPY trigger close 480.00; selloff low 470.50; review below 432.00.',
    );
    expect(a.plan?.stop).toBeUndefined();
    expect(a.risk).toEqual([
      { horizon: 'scalp', losses: 0, n: null },
      { horizon: 'swing', losses: 0, n: null },
      { horizon: 'long', losses: 12, n: 41 },
    ]);
    expect(a.worstAgeSeconds).toBe(0);
    expect(a.maxAgeSeconds).toBe(26 * 3600);
    expect(a.bearCase).toMatch(/2008/);
  });

  it('gives no rate under 30 episodes and says when the study or SPY levels are missing', () => {
    const few = capitulationAlert(day, null, { ...study, n: 9 }, {}, at, at);
    expect(few.trigger).toContain('n=9 episodes, insufficient history for a rate.');
    expect(few.trigger).not.toContain('median');
    expect(few.plan?.entry).toContain('SPY levels unavailable');
    const none = capitulationAlert(day, plan, null, {}, at, at);
    expect(none.trigger).toContain('Marsad event study: not computed yet.');
    expect(none.risk.at(-1)).toEqual({ horizon: 'long', losses: 0, n: 0 });
  });

  it('measures age from when the inputs were stored', () => {
    const a = capitulationAlert(day, plan, study, {}, new Date('2026-03-10T09:00:00Z'), at);
    expect(a.worstAgeSeconds).toBe(3 * 3600);
  });
});
