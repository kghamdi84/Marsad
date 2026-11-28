/**
 * Row-level security tests. They run every migration in an in-process
 * Postgres (PGlite) on top of a small Supabase stand-in, then act as
 * different users to prove that nobody but the owner can read owner rows.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = import.meta.dirname;
const OWNER = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';

let db: PGlite;

type Session = { sub?: string; aal?: 'aal1' | 'aal2'; role: 'anon' | 'authenticated' };

/** Runs fn inside a transaction as the given API session, then rolls back. */
async function as<T>(session: Session, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  let ran = false;
  await db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: session.sub, aal: session.aal, role: session.role });
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.exec(`set local role ${session.role}`);
    ran = true;
    try {
      result = await fn(tx);
    } catch (e) {
      failure = e;
    }
    await tx.rollback();
  });
  // Guard against a vacuous pass: the body must actually have run.
  if (!ran) throw new Error('session setup did not run');
  if (failure) throw failure;
  return result as T;
}

const owner2: Session = { sub: OWNER, aal: 'aal2', role: 'authenticated' };
const owner1: Session = { sub: OWNER, aal: 'aal1', role: 'authenticated' };
const other2: Session = { sub: OTHER, aal: 'aal2', role: 'authenticated' };
const anon: Session = { role: 'anon' };

async function count(tx: Transaction, table: string): Promise<number> {
  const r = await tx.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return r.rows[0]!.n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(here, 'harness.sql'), 'utf8'));
  const dir = join(here, '..', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  // Seed as the database owner (bypasses RLS), like the dashboard or a job would.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@example.com'), ('${OTHER}', 'other@example.com');
    insert into private.app_owners (user_id) values ('${OWNER}');
    insert into public.user_settings (owner_id) values ('${OWNER}'), ('${OTHER}');
    insert into public.watchlists (owner_id, name) values ('${OWNER}', 'Core'), ('${OTHER}', 'Theirs');
    insert into public.watchlist_items (owner_id, watchlist_id, ticker)
      select '${OWNER}', id, t from public.watchlists, unnest(array['NVDA','RKLB']) t where owner_id = '${OWNER}';
    insert into public.watchlist_items (owner_id, watchlist_id, ticker)
      select '${OTHER}', id, 'SOFI' from public.watchlists where owner_id = '${OTHER}';
    insert into public.job_runs (job, status) values ('baseline-seed', 'ok');
    insert into public.instruments (figi, cik, ticker, name)
      values ('BBG000BBJQV0', '0001045810', 'NVDA', 'NVIDIA Corp');
    insert into public.instrument_tickers (instrument_id, ticker, valid_from)
      select id, 'NVDA', date '1999-01-22' from public.instruments;
    insert into public.splits (vendor_id, ticker, execution_date, split_from, split_to, adjustment_type)
      values ('E-test', 'NVDA', date '2024-06-10', 1, 10, 'forward_split');
    insert into public.daily_bars (ticker, date, open, high, low, close, volume)
      values ('NVDA', date '2026-11-20', 188.0, 190.0, 186.0, 189.0, 1000000);
    insert into public.price_quotes (ticker, source, price, quote_kind, price_time, session_date, fetched_at)
      values ('NVDA', 'tauric', 149.3, 'snapshot', '2026-11-25T21:00:01Z', date '2026-11-25', now());
    insert into public.company_research (ticker, analyst, analyst_refreshed_at, errors)
      values ('NVDA', '{"recommendation": "buy", "target_mean_price": 242.4278}'::jsonb, '2026-11-28T01:46:14Z', '{"thesis": "temporarily_unavailable"}'::jsonb);
    insert into public.financial_facts (fact_key, cik, taxonomy, concept, unit, period_end, value, accession, form, filed)
      values ('k1', '0001045810', 'us-gaap', 'Revenues', 'USD', date '2026-07-26', 96221000000, '0001045810-26-000100', '10-Q', date '2026-08-26');
    insert into public.insider_filings (accession, issuer_cik, status) values ('0001696841-26-000016', '0001045810', 'ok');
    insert into public.insider_transactions (accession, line, table_kind, trade_date, code, shares, price_per_share)
      values ('0001696841-26-000016', 1, 'non-derivative', date '2026-11-19', 'S', 1434, 146.0298);
    insert into public.insider_holdings (accession, line, table_kind, security_title, shares, ownership)
      values ('0001696841-26-000016', 1, 'non-derivative', 'Common Stock', 268238, 'D');
    insert into public.annual_sections (cik, ticker, section, period_end, filing_date, filing_url, text)
      values ('0001045810', 'NVDA', 'risk_factors', date '2026-01-25', date '2026-02-25', 'https://www.sec.gov/x', 'Item 1A. Risk Factors');
    insert into public.regime_daily (date, rule_version, label, reason, inputs, recession_version, recession_level, recession)
      values (date '2026-11-23', 'regime-1', 'stress', 'backwardation', '{}'::jsonb, 'recession-1', 'elevated', '{}'::jsonb);
    insert into public.regime_event_stats (rule_version, condition, horizon, n, sufficient, data_from, data_to)
      values ('regime-1', 'stress', 63, 16, false, date '2016-11-25', date '2026-11-23');
    insert into public.market_snapshots (date, tickers, min_dollar_volume, encoding, payload)
      values (date '2026-11-24', 1, 1000000, 'gzip-base64-json-v1', 'x');
    insert into public.ticker_type_snapshots (as_of, common_stocks, etfs, encoding, payload)
      values (date '2026-10-02', 1, 1, 'gzip-base64-json-v1', 'x');
    insert into public.universe_members (version, month_start, ticker, rank, dollar_volume)
      values ('universe-1', date '2026-11-02', 'NVDA', 1, 30000000000);
    insert into public.breadth_daily (date, version, members, with_change, advancers, decliners, unchanged, up_volume, down_volume, above50, n50, above200, n200, new_highs, new_lows, n252, suspect)
      values (date '2026-11-24', 'breadth-1', 1000, 990, 600, 380, 10, 3e9, 1e9, 450, 900, 300, 800, 40, 15, 700, 0);
    insert into public.fear_greed_daily (date, version, composite, label, available, components)
      values (date '2026-11-23', 'fear-greed-1', 41.9, 'fear', 5, '[]'::jsonb);
    insert into public.capitulation_daily (date, version, state, conditions)
      values (date '2026-11-23', 'capitulation-1', 'off', '[]'::jsonb);
    insert into public.capitulation_plans (trigger_date, version, plan)
      values (date '2026-04-07', 'capitulation-1', '{}'::jsonb);
    insert into public.alerts (id, version, kind, priority, ticker, rule_id, rule_version, rule_status, dedupe_key, decision, headline, push, card, input)
      values ('11111111-1111-4111-8111-111111111111', 'alerts-1', 'halt', 'critical', 'SOFI', 'halts', 1, 'live',
              'halt|SOFI|halts|halt:x', 'push', 'SOFI halted', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb);
    insert into public.alert_outcomes (alert_id, horizon, version, status, ref_date, end_date, ret)
      values ('11111111-1111-4111-8111-111111111111', '1d', 'scorecard-1', 'done', date '2026-11-23', date '2026-11-24', 0.01);
    insert into public.ai_usage (job, purpose, model, input_tokens, output_tokens, usd)
      values ('brief', 'pre-market narrative', 'claude-sonnet-5-5', 1000, 200, 0.004);
    insert into public.rules (id, version, hash, doc) values ('index-trend-filter', 1, 'abcdef12', '{}'::jsonb);
    insert into public.rule_events (rule_id, version, to_status, reason) values ('index-trend-filter', 1, 'draft', 'new version');
    insert into public.backtest_runs (rule_id, version, engine, params, trials, report)
      values ('index-trend-filter', 1, 'backtest-1', '{}'::jsonb, 1, '{}'::jsonb);
    insert into public.briefs (kind, for_date, version, title, push_body, sections, inputs)
      values ('pre-market', date '2026-11-25', 'brief-1', 'Pre-market brief, Wed 2026-11-25', 'Regime Stress.', '[]'::jsonb, '{}'::jsonb);
    insert into public.market_movers_daily (date, version, n, gainers, losers, sectors)
      values (date '2026-11-24', 'watch-1', 990, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    insert into public.strength_rank_daily (version, date, ticker, return_63, rank, members, percentile)
      values ('strength-1', date '2026-11-24', 'NVDA', 0.12, 40, 990, 96.05);
    insert into public.econ_calendar_snapshots (fetched_at, version, range_from, range_to, events)
      values (timestamptz '2026-11-25 23:40:00+00', 'calendar-1', date '2026-11-25', date '2027-01-24', '[]'::jsonb);
    insert into public.earnings_estimate_snapshots (computed_at, version, estimates)
      values (timestamptz '2026-11-25 23:40:00+00', 'calendar-1', '[]'::jsonb);
    insert into public.news_topic_days (date, version, total, counts, samples)
      values (date '2026-11-24', 'topics-1', 554, '{}'::jsonb, '{}'::jsonb);
    insert into public.news_articles (id, published_at, publisher, title, url)
      values ('n1', timestamptz '2026-11-24 17:45:55+00', 'The Motley Fool', 'Why Sandisk Stock Plunged Today', 'https://example.com/a');
    insert into public.short_interest (ticker, settlement_date, short_interest) values ('NVDA', date '2026-10-30', 279579505);
    insert into public.short_volume (ticker, date, total_volume, short_volume) values ('NVDA', date '2026-11-23', 310699598, 90419413);
    insert into public.dividends (id, ticker, ex_dividend_date, cash_amount) values ('d1', 'NVDA', date '2026-12-02', 0.25);
    insert into public.system_alerts (event, source, headline, trigger, policy_version)
      values ('stale', 'nasdaq_halts', 'Nasdaq trade halts stale, silent for 40 min', 'test', 'test');
  `);
  // Production starts in password mode (ADR 0039). Every test below proves the strict mode (aal2 required)
  // unless it switches back with asPasswordMode.
  const mode = await db.query<{ require_mfa: boolean }>(
    'select require_mfa from private.auth_policy',
  );
  passwordModeShipped = mode.rows.length === 1 && mode.rows[0]!.require_mfa === false;
  await db.exec('update private.auth_policy set require_mfa = true');
});

let passwordModeShipped = false;

/** Like as(), with the switch turned to password mode inside the same rolled-back transaction. */
async function asPasswordMode<T>(
  session: Session,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  await db.transaction(async (tx) => {
    await tx.exec('update private.auth_policy set require_mfa = false');
    const claims = JSON.stringify({ sub: session.sub, aal: session.aal, role: session.role });
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.exec(`set local role ${session.role}`);
    try {
      result = await fn(tx);
    } catch (e) {
      failure = e;
    }
    await tx.rollback();
  });
  if (failure) throw failure;
  return result as T;
}

afterAll(async () => {
  await db.close();
});

describe('personal tables', () => {
  it('the owner with MFA sees only their own rows', async () => {
    await as(owner2, async (tx) => {
      expect(await count(tx, 'public.user_settings')).toBe(1);
      expect(await count(tx, 'public.watchlists')).toBe(1);
      const items = await tx.query<{ ticker: string }>(
        'select ticker from public.watchlist_items order by ticker',
      );
      expect(items.rows.map((r) => r.ticker)).toEqual(['NVDA', 'RKLB']);
    });
  });

  it('another user cannot read the owner rows', async () => {
    await as(other2, async (tx) => {
      const lists = await tx.query<{ owner_id: string }>('select owner_id from public.watchlists');
      expect(lists.rows).toEqual([{ owner_id: OTHER }]);
      const items = await tx.query<{ ticker: string }>('select ticker from public.watchlist_items');
      expect(items.rows.map((r) => r.ticker)).toEqual(['SOFI']);
      const settings = await tx.query(
        `select 1 from public.user_settings where owner_id = '${OWNER}'`,
      );
      expect(settings.rows).toHaveLength(0);
    });
  });

  it('another user cannot change or delete the owner rows', async () => {
    await as(other2, async (tx) => {
      const upd = await tx.query(
        `update public.watchlists set name = 'pwned' where owner_id = '${OWNER}'`,
      );
      expect(upd.affectedRows).toBe(0);
      const del = await tx.query(`delete from public.watchlist_items where owner_id = '${OWNER}'`);
      expect(del.affectedRows).toBe(0);
    });
    await as(owner2, async (tx) => {
      expect(await count(tx, 'public.watchlist_items')).toBe(2);
    });
  });

  it('another user cannot insert rows in the owner name', async () => {
    await expect(
      as(other2, (tx) =>
        tx.query(`insert into public.watchlists (owner_id, name) values ('${OWNER}', 'x')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('another user cannot attach an item to the owner watchlist', async () => {
    // The owner's list is invisible, so selecting it yields nothing to insert.
    await as(other2, async (tx) => {
      const r = await tx.query(
        `insert into public.watchlist_items (watchlist_id, ticker)
         select id, 'HOOD' from public.watchlists where name = 'Core'`,
      );
      expect(r.affectedRows).toBe(0);
    });
    // Guessing the id directly is blocked by the owner-matching foreign key.
    const id = await db.query<{ id: number }>(
      `select id from public.watchlists where owner_id = '${OWNER}'`,
    );
    await expect(
      as(other2, (tx) =>
        tx.query(`insert into public.watchlist_items (watchlist_id, ticker) values ($1, 'HOOD')`, [
          id.rows[0]!.id,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('the owner without MFA (aal1) reads nothing', async () => {
    await as(owner1, async (tx) => {
      expect(await count(tx, 'public.user_settings')).toBe(0);
      expect(await count(tx, 'public.watchlists')).toBe(0);
      expect(await count(tx, 'public.watchlist_items')).toBe(0);
    });
  });

  it('the anon role has no access at all', async () => {
    for (const table of [
      'user_settings',
      'watchlists',
      'watchlist_items',
      'job_runs',
      'source_status',
    ]) {
      await expect(as(anon, (tx) => count(tx, `public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe('system tables', () => {
  it('the owner with MFA reads job runs and source status', async () => {
    await as(owner2, async (tx) => {
      expect(await count(tx, 'public.job_runs')).toBe(1);
      expect(await count(tx, 'public.source_status')).toBe(15); // five seeded sources plus massive_reference, massive_bars, the four Study sources, massive_sections, massive_breadth, massive_topics and tauric
    });
  });

  it('a member account (a friend, ADR 0040) reads the shared job runs and source status', async () => {
    await as(other2, async (tx) => {
      expect(await count(tx, 'public.job_runs')).toBe(1);
      expect(await count(tx, 'public.source_status')).toBe(15);
    });
  });

  it('the owner without MFA reads no system rows', async () => {
    await as(owner1, async (tx) => {
      expect(await count(tx, 'public.job_runs')).toBe(0);
    });
  });

  it('signed-in users cannot write system tables', async () => {
    await expect(
      as(owner2, (tx) => tx.query(`insert into public.job_runs (job) values ('forged')`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('identity, split and alert tables: owner and members read the shared ones, system alerts are owner-only', async () => {
    for (const [table, member] of [
      ['instruments', 1],
      ['instrument_tickers', 1],
      ['splits', 1],
      ['system_alerts', 0],
      ['daily_bars', 1],
      ['price_quotes', 1],
      ['company_research', 1],
      ['analyst_history', 1],
    ] as const) {
      await as(owner2, async (tx) => expect(await count(tx, `public.${table}`)).toBe(1));
      await as(other2, async (tx) =>
        expect(await count(tx, `public.${table}`), table).toBe(member),
      );
      await as(owner1, async (tx) => expect(await count(tx, `public.${table}`)).toBe(0));
      await expect(as(anon, (tx) => count(tx, `public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(owner2, (tx) => tx.query(`delete from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('quote source (ADR 0041): each person sets their own, Massive by default, only the two vendors; quotes are read-only', async () => {
    await as(owner2, async (tx) => {
      const r = await tx.query<{ quote_source: string }>(
        'select quote_source from public.user_settings',
      );
      expect(r.rows).toEqual([{ quote_source: 'massive' }]);
      await tx.query(`update public.user_settings set quote_source = 'tauric'`);
      await expect(
        tx.query(`update public.user_settings set quote_source = 'yahoo'`),
      ).rejects.toThrow(/check constraint/);
    });
    // A friend changes only their own row; the owner's stays as it was.
    await as(other2, async (tx) => {
      const r = await tx.query(
        `update public.user_settings set quote_source = 'tauric' where owner_id = '${OWNER}'`,
      );
      expect(r.affectedRows ?? 0).toBe(0);
    });
    await expect(
      as(owner2, (tx) =>
        tx.query(`update public.price_quotes set price = 1 where ticker = 'NVDA'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into public.price_quotes (ticker, source, price, quote_kind, fetched_at) values ('AAPL', 'yahoo', 1, 'snapshot', now())`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('company research (ADR 0047): members read, nobody signed in writes, only Tauric, parts are objects', async () => {
    await as(other2, async (tx) => {
      const r = await tx.query<{ analyst: { recommendation: string }; errors: object }>(
        `select analyst, errors from public.company_research where ticker = 'NVDA'`,
      );
      expect(r.rows).toEqual([
        {
          analyst: { recommendation: 'buy', target_mean_price: 242.4278 },
          errors: { thesis: 'temporarily_unavailable' },
        },
      ]);
    });
    for (const sql of [
      `insert into public.company_research (ticker) values ('AAPL')`,
      `update public.company_research set analyst = null where ticker = 'NVDA'`,
      `delete from public.company_research`,
    ]) {
      await expect(as(owner2, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
      await expect(as(other2, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
    await as(owner1, async (tx) => expect(await count(tx, 'public.company_research')).toBe(0));
    for (const sql of [
      `insert into public.company_research (ticker, source) values ('AAPL', 'yahoo')`,
      `insert into public.company_research (ticker, thesis) values ('AAPL', '[1]'::jsonb)`,
      `insert into public.company_research (ticker, errors) values ('AAPL', '"x"'::jsonb)`,
      `insert into public.company_research (ticker) values ('aapl')`,
    ])
      await expect(db.query(sql)).rejects.toThrow(/check constraint/);
  });

  it('analyst history (ADR 0047): each analyst write keeps one row per ticker per day, read-only for everyone signed in', async () => {
    const rows = async () =>
      (
        await db.query<{ as_of: string; buy: number | null; target_mean: string | null }>(
          `select as_of::text, buy, target_mean::text from public.analyst_history where ticker = 'AMD' order by as_of`,
        )
      ).rows;
    await db.query(
      `insert into public.company_research (ticker, analyst, analyst_refreshed_at) values ('AMD', '{"buy": 30, "target_mean_price": 250.5}'::jsonb, '2026-11-27T22:00:00Z')`,
    );
    // A second write the same UTC day replaces that day's row; a write on a new day adds one.
    await db.query(
      `update public.company_research set analyst = '{"buy": 31, "target_mean_price": 251}'::jsonb where ticker = 'AMD'`,
    );
    expect(await rows()).toEqual([{ as_of: '2026-11-27', buy: 31, target_mean: '251' }]);
    await db.query(
      `update public.company_research set analyst = '{"buy": "x"}'::jsonb, analyst_refreshed_at = '2026-11-28T22:00:00Z' where ticker = 'AMD'`,
    );
    expect(await rows()).toEqual([
      { as_of: '2026-11-27', buy: 31, target_mean: '251' },
      { as_of: '2026-11-28', buy: null, target_mean: null },
    ]);
    // Clearing the analyst part (Tauric dropped coverage) keeps the history.
    await db.query(`update public.company_research set analyst = null where ticker = 'AMD'`);
    expect(await rows()).toHaveLength(2);
    await expect(
      as(owner2, (tx) => tx.query(`delete from public.analyst_history`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(other2, (tx) =>
        tx.query(
          `insert into public.analyst_history (ticker, as_of) values ('AMD', date '2026-11-29')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await db.query(`delete from public.analyst_history where ticker = 'AMD'`);
    await db.query(`delete from public.company_research where ticker = 'AMD'`);
  });

  it("ticker summary (ADR 0050): members read 'tracked' rows, only the owner reads 'market' rows, nobody signed in writes", async () => {
    await db.exec(`
      insert into public.ticker_daily_summary (version, date, ticker, coverage, close, close_date, range_position_52w, formula_versions)
        values ('ticker-summary-1', date '2026-11-27', 'NVDA', 'tracked', 177.0, date '2026-11-27', 0.8, '{"summary": "ticker-summary-1"}'::jsonb),
               ('ticker-summary-1', date '2026-11-27', 'AAPL', 'market', 278.0, date '2026-11-27', 0.9, '{"summary": "ticker-summary-1"}'::jsonb);
    `);
    const tickers = async (tx: Transaction) =>
      (
        await tx.query<{ ticker: string }>(
          'select ticker from public.ticker_daily_summary order by ticker',
        )
      ).rows.map((r) => r.ticker);
    try {
      await as(owner2, async (tx) => expect(await tickers(tx)).toEqual(['AAPL', 'NVDA']));
      await as(other2, async (tx) => expect(await tickers(tx)).toEqual(['NVDA']));
      await as(owner1, async (tx) => expect(await tickers(tx)).toEqual([]));
      await expect(as(anon, (tx) => tickers(tx))).rejects.toThrow(/permission denied/);
      for (const sql of [
        `insert into public.ticker_daily_summary (version, date, ticker, coverage, formula_versions) values ('ticker-summary-1', date '2026-11-27', 'AMD', 'tracked', '{}'::jsonb)`,
        `update public.ticker_daily_summary set close = 1 where ticker = 'NVDA'`,
        `delete from public.ticker_daily_summary`,
      ]) {
        await expect(as(owner2, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
        await expect(as(other2, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
      }
      const row = (cols: string, vals: string) =>
        db.query(
          `insert into public.ticker_daily_summary (version, date, ticker, coverage, formula_versions${cols}) values ('ticker-summary-1', date '2026-11-27', 'AMD', 'tracked', '{}'::jsonb${vals})`,
        );
      for (const [cols, vals] of [
        [', range_position_52w', ', 1.5'],
        [', next_earnings_date', ", date '2027-01-28'"],
        [', next_earnings_source', ", 'tauric'"],
        [', analyst_recommendation', ", 'outperform'"],
        [', sector_etf', ", 'SPY'"],
        [', close_date', ", date '2026-11-30'"],
        [', low_52w, high_52w', ', 200, 100'],
        [', unavailable', ", '[]'::jsonb"],
      ] as const)
        await expect(row(cols, vals), cols).rejects.toThrow(/check constraint/);
      await expect(
        db.query(
          `insert into public.ticker_daily_summary (version, date, ticker, coverage, formula_versions) values ('ticker-summary-1', date '2026-11-27', 'amd', 'tracked', '{}'::jsonb)`,
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(
          `insert into public.ticker_daily_summary (version, date, ticker, coverage, formula_versions) values ('ticker-summary-1', date '2026-11-27', 'AMD', 'friends', '{}'::jsonb)`,
        ),
      ).rejects.toThrow(/check constraint/);
    } finally {
      await db.query(`delete from public.ticker_daily_summary`);
    }
  });

  it('every Study table: owner reads, members read all but the owner-only signals, nobody deletes', async () => {
    const ownerOnly = new Set([
      'briefs',
      'alerts',
      'alert_outcomes',
      'ai_usage',
      // Whole-market data is owner-only (ADR 0048): Massive's plans are for individual use.
      'market_snapshots',
      'ticker_type_snapshots',
    ]);
    for (const table of [
      'financial_facts',
      'insider_filings',
      'insider_transactions',
      'insider_holdings',
      'annual_sections',
      'regime_daily',
      'regime_event_stats',
      'market_snapshots',
      'ticker_type_snapshots',
      'universe_members',
      'breadth_daily',
      'fear_greed_daily',
      'capitulation_daily',
      'capitulation_plans',
      'news_topic_days',
      'market_movers_daily',
      'strength_rank_daily',
      'briefs',
      'rules',
      'rule_events',
      'backtest_runs',
      'alerts',
      'alert_outcomes',
      'ai_usage',
      'econ_calendar_snapshots',
      'earnings_estimate_snapshots',
      'news_articles',
      'short_interest',
      'short_volume',
      'dividends',
    ]) {
      await as(owner2, async (tx) => expect(await count(tx, `public.${table}`), table).toBe(1));
      await as(other2, async (tx) =>
        expect(await count(tx, `public.${table}`), table).toBe(ownerOnly.has(table) ? 0 : 1),
      );
      await as(owner1, async (tx) => expect(await count(tx, `public.${table}`), table).toBe(0));
      await expect(as(anon, (tx) => count(tx, `public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(owner2, (tx) => tx.query(`delete from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('the new insider columns default sensibly and holdings reject an unknown table kind', async () => {
    const r = await db.query<{ co_owners: string[]; no_securities_owned: boolean | null }>(
      `select co_owners, no_securities_owned from public.insider_filings where accession = '0001696841-26-000016'`,
    );
    expect(r.rows[0]).toEqual({ co_owners: [], no_securities_owned: null });
    await expect(
      db.query(
        `insert into public.insider_holdings (accession, line, table_kind) values ('0001696841-26-000016', 9, 'other')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('the breadth tables refuse an adjusted snapshot, a rank above 1,000 and a malformed ticker', async () => {
    await expect(
      db.query(
        `insert into public.market_snapshots (date, adjusted, tickers, min_dollar_volume, encoding, payload) values (date '2026-11-25', true, 1, 1, 'e', 'x')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.universe_members (version, month_start, ticker, rank, dollar_volume) values ('universe-1', date '2026-11-02', 'AAPL', 1001, 1)`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.universe_members (version, month_start, ticker, rank, dollar_volume) values ('universe-1', date '2026-11-02', 'bad ticker', 2, 1)`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('whole-market movers (movers-1, ADR 0048) are owner-only; members read only the version marker', async () => {
    await db.query(
      `insert into public.market_movers_market (date, version, session) values (date '2026-11-24', 'movers-1', '{}'::jsonb)`,
    );
    await db.query(
      `update public.market_movers_daily set market_version = 'movers-1' where date = date '2026-11-24'`,
    );
    try {
      await as(owner2, async (tx) =>
        expect(await count(tx, 'public.market_movers_market')).toBe(1),
      );
      await as(other2, async (tx) => {
        expect(await count(tx, 'public.market_movers_market')).toBe(0);
        const r = await tx.query<{ market_version: string }>(
          `select market_version from public.market_movers_daily where date = date '2026-11-24'`,
        );
        expect(r.rows).toEqual([{ market_version: 'movers-1' }]);
      });
      await as(owner1, async (tx) =>
        expect(await count(tx, 'public.market_movers_market')).toBe(0),
      );
      await expect(as(anon, (tx) => count(tx, 'public.market_movers_market'))).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        as(owner2, (tx) => tx.query(`delete from public.market_movers_market`)),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.query(`delete from public.market_movers_market`);
      await db.query(`update public.market_movers_daily set market_version = null`);
    }
  });

  it('the composite and capitulation tables reject out-of-range values and unknown states', async () => {
    const fg = (composite: string, label: string, available: number) =>
      db.query(
        `insert into public.fear_greed_daily (date, version, composite, label, available, components)
         values (date '2026-11-24', 'fear-greed-1', ${composite}, ${label}, ${available}, '[]')`,
      );
    await expect(fg('101', "'extreme-greed'", 5)).rejects.toThrow(/check constraint/);
    await expect(fg('40', "'panic'", 5)).rejects.toThrow(/check constraint/);
    await expect(fg('40', "'fear'", 8)).rejects.toThrow(/check constraint/);
    // A label without a composite (or the reverse) is refused.
    await expect(fg('null', "'fear'", 3)).rejects.toThrow(/check constraint/);
    await expect(fg('40', 'null', 5)).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.capitulation_daily (date, version, state, conditions) values (date '2026-11-24', 'capitulation-1', 'maybe', '[]')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('alert feedback is personal: the owner with MFA writes and reads it, nobody else sees it', async () => {
    // Each `as` call is one transaction that is rolled back, so the write and the read share one.
    await as(owner2, async (tx) => {
      await tx.query(
        `insert into public.alert_feedback (alert_id, verdict) values ('11111111-1111-4111-8111-111111111111', 'useful')`,
      );
      expect(await count(tx, 'public.alert_feedback')).toBe(1);
    });
    await as(other2, async (tx) => {
      await tx.query(
        `insert into public.alert_feedback (alert_id, verdict) values ('11111111-1111-4111-8111-111111111111', 'noise')`,
      );
      // The other user sees only their own row, never the owner's.
      const r = await tx.query<{ verdict: string }>('select verdict from public.alert_feedback');
      expect(r.rows.map((x) => x.verdict)).toEqual(['noise']);
    });
    await expect(
      as(owner1, (tx) =>
        tx.query(
          `insert into public.alert_feedback (alert_id, verdict) values ('11111111-1111-4111-8111-111111111111', 'noise')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      as(owner2, (tx) =>
        tx.query(
          `insert into public.alert_feedback (alert_id, verdict) values ('11111111-1111-4111-8111-111111111111', 'maybe')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(as(anon, (tx) => count(tx, 'public.alert_feedback'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('holdings are personal and refuse a bad trend rule', async () => {
    await as(owner2, async (tx) => {
      await tx.query(
        `insert into public.holdings (ticker, shares, cost_basis, opened_on, stop, targets, trend_break) values ('RKLB', 100, 24, '2026-10-01', 22, '{27}', 'sma50')`,
      );
      expect(await count(tx, 'public.holdings')).toBe(1);
    });
    await as(other2, async (tx) => expect(await count(tx, 'public.holdings')).toBe(0));
    await expect(
      as(owner2, (tx) =>
        tx.query(
          `insert into public.holdings (ticker, shares, cost_basis, opened_on, trend_break) values ('RKLB', 1, 1, '2026-10-01', 'magic')`,
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(owner1, (tx) =>
        tx.query(
          `insert into public.holdings (ticker, shares, cost_basis, opened_on) values ('RKLB', 1, 1, '2026-10-01')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(as(anon, (tx) => count(tx, 'public.holdings'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('a holding takes a known sector ETF and a thesis status (intact by default)', async () => {
    await as(owner2, async (tx) => {
      const r = await tx.query<{ sector_etf: string | null; thesis_status: string }>(
        `insert into public.holdings (ticker, shares, cost_basis, opened_on, sector_etf) values ('RKLB', 1, 1, '2026-10-01', 'XLI') returning sector_etf, thesis_status`,
      );
      expect(r.rows[0]).toEqual({ sector_etf: 'XLI', thesis_status: 'intact' });
    });
    for (const [col, bad] of [
      ['sector_etf', 'QQQ'],
      ['thesis_status', 'great'],
    ] as const)
      await expect(
        as(owner2, (tx) =>
          tx.query(
            `insert into public.holdings (ticker, shares, cost_basis, opened_on, ${col}) values ('RKLB', 1, 1, '2026-10-01', '${bad}')`,
          ),
        ),
      ).rejects.toThrow(/check constraint/);
  });

  it('a finished outcome needs its return and dates; horizons are 1d, 5d or 20d', async () => {
    for (const values of [
      `'5d', 'scorecard-1', 'done', null, null, null`,
      `'2h', 'scorecard-1', 'pending', null, null, null`,
    ])
      await expect(
        db.query(
          `insert into public.alert_outcomes (alert_id, horizon, version, status, ref_date, end_date, ret) values ('11111111-1111-4111-8111-111111111111', ${values})`,
        ),
      ).rejects.toThrow(/check constraint/);
  });

  it('trades are personal and refuse a half-closed trade or an exit before the entry', async () => {
    await as(owner2, async (tx) => {
      await tx.query(
        `insert into public.trades (ticker, entry_date, entry_price, shares, stop, setup) values ('RKLB', '2026-11-02', 24, 100, 22, 'trend-template-breakout')`,
      );
      expect(await count(tx, 'public.trades')).toBe(1);
    });
    await as(other2, async (tx) => expect(await count(tx, 'public.trades')).toBe(0));
    await as(owner1, async (tx) =>
      expect(
        tx.query(
          `insert into public.trades (ticker, entry_date, entry_price, shares) values ('RKLB', '2026-11-02', 24, 1)`,
        ),
      ).rejects.toThrow(),
    );
    for (const bad of [
      `exit_date) values ('RKLB', '2026-11-02', 24, 1, '2026-11-05'`,
      `exit_date, exit_price) values ('RKLB', '2026-11-02', 24, 1, '2026-11-01', 20`,
    ])
      await expect(
        as(owner2, (tx) =>
          tx.query(`insert into public.trades (ticker, entry_date, entry_price, shares, ${bad})`),
        ),
      ).rejects.toThrow(/check constraint/);
    await expect(as(anon, (tx) => count(tx, 'public.trades'))).rejects.toThrow(/permission denied/);
  });

  it('trades take checklist-3 (ADR 0048 round 2), keep checklist-1 as the default and refuse an unknown version', async () => {
    await as(owner2, async (tx) => {
      for (const v of ['checklist-1', 'checklist-2', 'checklist-3'])
        await tx.query(
          `insert into public.trades (ticker, entry_date, entry_price, shares, checklist_version) values ('RKLB', '2026-11-02', 24, 1, $1)`,
          [v],
        );
      await tx.query(
        `insert into public.trades (ticker, entry_date, entry_price, shares) values ('SOFI', '2026-11-02', 18, 1)`,
      );
      const r = await tx.query<{ ticker: string; checklist_version: string }>(
        `select ticker, checklist_version from public.trades order by id`,
      );
      expect(r.rows.map((x) => x.checklist_version)).toEqual([
        'checklist-1',
        'checklist-2',
        'checklist-3',
        'checklist-1',
      ]);
    });
    await expect(
      as(owner2, (tx) =>
        tx.query(
          `insert into public.trades (ticker, entry_date, entry_price, shares, checklist_version) values ('RKLB', '2026-11-02', 24, 1, 'checklist-4')`,
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('journal screenshots: only the owner with MFA, only in their own folder, only in the private bucket', async () => {
    const bucket = await db.query<{ public: boolean; file_size_limit: string }>(
      `select public, file_size_limit::text from storage.buckets where id = 'journal'`,
    );
    expect(bucket.rows[0]).toEqual({ public: false, file_size_limit: '5242880' });
    const put = (name: string) =>
      `insert into storage.objects (bucket_id, name) values ('journal', '${name}')`;
    await as(owner2, async (tx) => {
      await tx.query(put(`${OWNER}/trade-1-1.png`));
      expect(await count(tx, 'storage.objects')).toBe(1);
    });
    // Another user's folder, no MFA, another user, and anon are all refused.
    await expect(as(owner2, (tx) => tx.query(put(`${OTHER}/trade-1-1.png`)))).rejects.toThrow(
      /row-level security/,
    );
    await expect(as(owner1, (tx) => tx.query(put(`${OWNER}/trade-1-1.png`)))).rejects.toThrow();
    await expect(as(anon, (tx) => tx.query(put(`${OWNER}/x.png`)))).rejects.toThrow();
    await db.query(put(`${OWNER}/trade-9-1.png`)); // as the superuser, like a stored object
    await as(other2, async (tx) => expect(await count(tx, 'storage.objects')).toBe(0));
    await as(owner1, async (tx) => expect(await count(tx, 'storage.objects')).toBe(0));
    await as(owner2, async (tx) => expect(await count(tx, 'storage.objects')).toBe(1));
    await db.query(`delete from storage.objects`);
  });

  it('theses are personal, append-only, and refuse a missing bear case', async () => {
    const ins = (bear: string) =>
      `insert into public.theses (ticker, status, bull, bear, risks, change_view) values ('RKLB', 'intact', 'Bull.', '${bear}', '{Dilution}', '${'x'.repeat(40)}')`;
    await as(owner2, async (tx) => {
      await tx.query(ins('y'.repeat(40)));
      expect(await count(tx, 'public.theses')).toBe(1);
      await expect(tx.query(`update public.theses set status = 'broken'`)).rejects.toThrow(
        /permission denied/,
      );
    });
    await as(other2, async (tx) => expect(await count(tx, 'public.theses')).toBe(0));
    await expect(as(owner2, (tx) => tx.query(ins('Could go down.')))).rejects.toThrow(
      /check constraint/,
    );
    await expect(as(owner2, (tx) => tx.query(`delete from public.theses`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(anon, (tx) => count(tx, 'public.theses'))).rejects.toThrow(/permission denied/);
  });

  it('exports: the owner with MFA reads only their own folder and can write nothing', async () => {
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('exports', '${OWNER}/2026-11-29/trades.json'), ('exports', '${OTHER}/2026-11-29/trades.json')`,
    );
    await as(owner2, async (tx) => expect(await count(tx, 'storage.objects')).toBe(1));
    await as(owner1, async (tx) => expect(await count(tx, 'storage.objects')).toBe(0));
    await expect(
      as(owner2, (tx) =>
        tx.query(
          `insert into storage.objects (bucket_id, name) values ('exports', '${OWNER}/2026-12-06/x.json')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(owner2, async (tx) => {
      const r = await tx.query(`delete from storage.objects where bucket_id = 'exports'`);
      expect(r.affectedRows).toBe(0);
    });
    await db.query(`delete from storage.objects`);
  });

  it('briefs accept the weekly review kind', async () => {
    await db.query(
      `insert into public.briefs (kind, for_date, version, title, push_body, sections, inputs) values ('weekly-review', date '2026-11-29', 'weekly-review-1', 'Weekly review, week ending 2026-11-29', '0 closed.', '[]'::jsonb, '{}'::jsonb)`,
    );
    await db.query(`delete from public.briefs where kind = 'weekly-review'`);
  });

  it('alerts accept the earnings guard kind (ADR 0052), still refuse unknown kinds, and stay owner-only', async () => {
    const ins = (kind: string, id: string) =>
      `insert into public.alerts (id, version, kind, priority, ticker, rule_id, rule_version, rule_status, dedupe_key, decision, headline, push, card, input)
        values ('${id}', 'alerts-1', '${kind}', 'normal', 'NVDA', 'earnings-guard', 1, 'live',
                'earnings|NVDA|earnings-guard|earnings:1:2026-12-03', 'push', 'NVDA reports in 4 sessions', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)`;
    await db.query(ins('earnings', '22222222-2222-4222-8222-222222222222'));
    await expect(
      db.query(ins('earnings-ish', '33333333-3333-4333-8333-333333333333')),
    ).rejects.toThrow(/alerts_kind_check/);
    await as(owner2, async (tx) => {
      expect(await count(tx, `public.alerts where kind = 'earnings'`)).toBe(1);
    });
    await as(other2, async (tx) => {
      expect(await count(tx, `public.alerts where kind = 'earnings'`)).toBe(0);
    });
    await db.query(`delete from public.alerts where kind = 'earnings'`);
  });

  it('catalyst scenarios are personal and need at least one trigger and a plan', async () => {
    const ins = (triggers: string) =>
      `insert into public.catalyst_scenarios (name, tickers, ${triggers ? 'eight_k_items, ' : ''}plan_entry, chase_guard_pct, plan_invalidation, expires_on) values ('NVDA CEO returns', '{NVDA}', ${triggers ? `'${triggers}', ` : ''}'Wait for VWAP.', 0.1, 'Below the low.', '2026-12-31')`;
    await as(owner2, async (tx) => {
      await tx.query(ins('{5.02}'));
      expect(await count(tx, 'public.catalyst_scenarios')).toBe(1);
    });
    await as(other2, async (tx) => expect(await count(tx, 'public.catalyst_scenarios')).toBe(0));
    await expect(as(owner2, (tx) => tx.query(ins('')))).rejects.toThrow(/check constraint/);
    await expect(as(owner1, (tx) => tx.query(ins('{5.02}')))).rejects.toThrow();
    await expect(as(anon, (tx) => count(tx, 'public.catalyst_scenarios'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('alert preferences: only the app owner writes quiet hours and the push cap, with valid values', async () => {
    const ins = (start = '22:00', cap = 5) =>
      `insert into public.alert_preferences (quiet_start, quiet_end, daily_push_cap) values ('${start}', '06:30', ${cap})`;
    await as(owner2, async (tx) => {
      await tx.query(ins());
      expect(await count(tx, 'public.alert_preferences')).toBe(1);
    });
    // A member (signed in, not the app owner) cannot write one, so the jobs read at most one row.
    await expect(as(other2, (tx) => tx.query(ins()))).rejects.toThrow(/row-level security/);
    await as(other2, async (tx) => expect(await count(tx, 'public.alert_preferences')).toBe(0));
    await expect(as(owner2, (tx) => tx.query(ins('25:00')))).rejects.toThrow(/check constraint/);
    await expect(as(owner2, (tx) => tx.query(ins('22:00', 0)))).rejects.toThrow(/check constraint/);
    await expect(as(owner1, (tx) => tx.query(ins()))).rejects.toThrow();
    await expect(as(anon, (tx) => count(tx, 'public.alert_preferences'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('portfolio limits (ADR 0048): personal, seeded with the council values for the owner only, versioned, checked', async () => {
    const seed = readFileSync(
      join(here, '..', 'migrations', '20270108000200_portfolio_limits_seed.sql'),
      'utf8',
    );
    // The seed runs as the database owner after the app owner exists (in this harness the owner is added after
    // the migrations); it is idempotent, and it all rolls back.
    let ran = false;
    await db.transaction(async (tx) => {
      await tx.exec(seed);
      await tx.exec(seed);
      const all = await tx.query<{ owner_id: string }>(
        'select owner_id from public.portfolio_limits',
      );
      expect(all.rows.map((r) => r.owner_id)).toEqual([OWNER]);
      const set = async (s: Session) => {
        await tx.exec('reset role');
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: s.sub, aal: s.aal, role: s.role }),
        ]);
        await tx.exec(`set local role ${s.role}`);
      };
      await set(owner2);
      const mine = await tx.query<Record<string, unknown>>(
        'select largest_position::text, top5::text, min_cash::text, portfolio_beta::text, open_risk::text, set_by, set_on::text, version from public.portfolio_limits',
      );
      expect(mine.rows).toEqual([
        {
          largest_position: '0.2',
          top5: '0.6',
          min_cash: '0.1',
          portfolio_beta: '1.5',
          open_risk: '0.06',
          set_by: 'council',
          set_on: '2026-11-28',
          version: 1,
        },
      ]);
      // Saving bumps the version; clearing a limit stores null.
      await tx.query(
        `update public.portfolio_limits set largest_position = 0.25, min_cash = null, set_by = 'user', set_on = date '2026-11-29'`,
      );
      const saved = await tx.query<{ version: number; min_cash: string | null }>(
        'select version, min_cash::text from public.portfolio_limits',
      );
      expect(saved.rows).toEqual([{ version: 2, min_cash: null }]);
      // A member sees none of it and starts with no row ("No limit set").
      await set(other2);
      expect(await count(tx, 'public.portfolio_limits')).toBe(0);
      ran = true;
      await tx.rollback();
    });
    expect(ran).toBe(true);
    // A member may store their own limits; nobody can write another person's row or delete one.
    await as(other2, async (tx) => {
      await tx.query(`insert into public.portfolio_limits (largest_position) values (0.3)`);
      expect(await count(tx, 'public.portfolio_limits')).toBe(1);
    });
    await expect(
      as(other2, (tx) =>
        tx.query(`insert into public.portfolio_limits (owner_id, top5) values ('${OWNER}', 0.5)`),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(owner2, async (tx) => {
        await tx.query(`insert into public.portfolio_limits (top5) values (0.5)`);
        await tx.query('delete from public.portfolio_limits');
      }),
    ).rejects.toThrow(/permission denied/);
    for (const bad of [
      'largest_position) values (0',
      'largest_position) values (1.2',
      'min_cash) values (1',
      'portfolio_beta) values (0',
      'portfolio_beta) values (11',
      'open_risk) values (-0.01',
    ])
      await expect(
        as(owner2, (tx) => tx.query(`insert into public.portfolio_limits (${bad})`)),
      ).rejects.toThrow(/check constraint/);
    await expect(
      as(owner2, (tx) =>
        tx.query(`insert into public.portfolio_limits (set_by) values ('marsad')`),
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(owner1, (tx) => tx.query(`insert into public.portfolio_limits (top5) values (0.5)`)),
    ).rejects.toThrow();
    await expect(as(anon, (tx) => count(tx, 'public.portfolio_limits'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('push subscriptions belong to the app owner and only point at known push services', async () => {
    const key = 'B'.padEnd(87, 'A');
    const ins = (endpoint: string, p256dh = key) =>
      `insert into public.push_subscriptions (endpoint, p256dh, auth, device) values ('${endpoint}', '${p256dh}', '${'C'.repeat(22)}', 'iPad')`;
    await as(owner2, async (tx) => {
      await tx.query(ins('https://web.push.apple.com/QAbc'));
      expect(await count(tx, 'public.push_subscriptions')).toBe(1);
    });
    // Signed in with MFA but not the app owner: cannot subscribe, sees nothing.
    await expect(
      as(other2, (tx) => tx.query(ins('https://fcm.googleapis.com/fcm/send/x'))),
    ).rejects.toThrow();
    await as(other2, async (tx) => expect(await count(tx, 'public.push_subscriptions')).toBe(0));
    await expect(as(owner1, (tx) => count(tx, 'public.push_subscriptions'))).resolves.toBe(0);
    for (const bad of [
      'http://web.push.apple.com/x',
      'https://evil.example/web.push.apple.com/',
      'https://push.apple.com.evil.example/x',
      'https://notpush.apple.com/x',
    ])
      await expect(as(owner2, (tx) => tx.query(ins(bad)))).rejects.toThrow(/check constraint/);
    await expect(
      as(owner2, (tx) => tx.query(ins('https://web.push.apple.com/other', 'short'))),
    ).rejects.toThrow(/check constraint/);
    await expect(as(anon, (tx) => count(tx, 'public.push_subscriptions'))).rejects.toThrow(
      /permission denied/,
    );
    await as(owner2, async (tx) => {
      await tx.query(`update public.user_settings set push_public_key = '${key}'`);
      await expect(
        tx.query(`update public.user_settings set push_public_key = 'not-a-key'`),
      ).rejects.toThrow(/check constraint/);
    });
    const d = await db.query<{ delivery: unknown }>(
      `insert into public.system_alerts (event, source, headline, trigger, policy_version) values ('stale', 'x', 'h', 't', 'p') returning delivery`,
    );
    expect(d.rows[0]?.delivery).toEqual({});
    await db.query(`delete from public.system_alerts where source = 'x'`);
  });

  it('options positions are personal and need an exit rule, a bear case and 1 to 4 legs', async () => {
    const leg = `{"type":"call","strike":100,"qty":1,"price":5}`;
    const ins = (legs: string, exit = '21', bear = 'Below 100 it expires worthless.') =>
      `insert into public.option_positions (underlying, label, expiry, legs, opened_on, exit_dte, bear_case) values ('NVDA', 'Long call', '2026-12-18', '${legs}'::jsonb, '2026-11-20', ${exit}, '${bear}')`;
    await as(owner2, async (tx) => {
      await tx.query(ins(`[${leg}]`));
      expect(await count(tx, 'public.option_positions')).toBe(1);
    });
    await as(other2, async (tx) => expect(await count(tx, 'public.option_positions')).toBe(0));
    await expect(as(owner1, (tx) => tx.query(ins(`[${leg}]`)))).rejects.toThrow();
    for (const bad of [
      ins(`[${leg}]`, 'null'),
      ins(`[${leg}]`, '21', ' '),
      ins('[]'),
      ins(`[${[leg, leg, leg, leg, leg].join(',')}]`),
      ins(`${leg}`),
    ])
      await expect(as(owner2, (tx) => tx.query(bad))).rejects.toThrow(/check constraint/);
    await expect(as(anon, (tx) => count(tx, 'public.option_positions'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('a rule version cannot change; only its status can', async () => {
    await expect(
      db.query(
        `update public.rules set doc = '{"x":1}'::jsonb where id = 'index-trend-filter' and version = 1`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.query(
        `update public.rules set hash = '00000000' where id = 'index-trend-filter' and version = 1`,
      ),
    ).rejects.toThrow(/immutable/);
    await db.query(
      `update public.rules set status = 'backtested' where id = 'index-trend-filter' and version = 1`,
    );
    const r = await db.query<{ status: string }>(
      `select status from public.rules where id = 'index-trend-filter' and version = 1`,
    );
    expect(r.rows[0]?.status).toBe('backtested');
    await expect(
      db.query(`update public.rules set status = 'retired' where id = 'index-trend-filter'`),
    ).rejects.toThrow(/check constraint/);
  });

  it('briefs reject an unknown kind, a long push body and a second brief of the same kind and day', async () => {
    const ins = (kind: string, body: string, day = '2026-11-26') =>
      db.query(
        `insert into public.briefs (kind, for_date, version, title, push_body, sections, inputs)
         values ('${kind}', date '${day}', 'brief-1', 't', '${body}', '[]', '{}')`,
      );
    await expect(ins('weekly', 'x')).rejects.toThrow(/check constraint/);
    await expect(ins('pre-market', 'x'.repeat(141))).rejects.toThrow(/check constraint/);
    await expect(ins('pre-market', 'x', '2026-11-25')).rejects.toThrow(/duplicate key/);
  });

  it('the regime tables reject an unknown label or level and a non-positive horizon', async () => {
    await expect(
      db.query(
        `insert into public.regime_daily (date, rule_version, label, reason, inputs, recession_version, recession_level, recession)
         values (date '2026-11-24', 'regime-1', 'euphoria', 'x', '{}', 'recession-1', 'low', '{}')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.regime_daily (date, rule_version, label, reason, inputs, recession_version, recession_level, recession)
         values (date '2026-11-24', 'regime-1', 'stress', 'x', '{}', 'recession-1', 'moderate', '{}')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.regime_event_stats (rule_version, condition, horizon, n, sufficient, data_from, data_to)
         values ('regime-1', 'bear', 0, 1, false, date '2020-01-01', date '2020-01-02')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects malformed identifiers at the database', async () => {
    await expect(
      db.query(`insert into public.instruments (figi, ticker) values ('nope', 'AAA')`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(`insert into public.instruments (cik, ticker) values ('123', 'AAA')`),
    ).rejects.toThrow(/check constraint/);
  });

  it('signed-in users cannot read the owner allow list', async () => {
    await expect(as(owner2, (tx) => count(tx, 'private.app_owners'))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('Ask (ADR 0054)', () => {
  const ins = (state = 'answered', verified = true, question = 'How is NVDA doing?') =>
    `insert into public.ask_log (question, answer, citations, verified, model, usd, state)
     values ('${question}', 'NVDA closed at $189.00 [F2].', '[{"id":"F2"}]'::jsonb, ${verified},
             'claude-sonnet-5-5', 0.014, '${state}')`;

  it('the owner with MFA writes and reads the log; it is append-only', async () => {
    await as(owner2, async (tx) => {
      await tx.query(ins());
      await tx.query(ins('facts-only', false));
      expect(await count(tx, 'public.ask_log')).toBe(2);
      const r = await tx.query<{ owner_id: string }>('select owner_id from public.ask_log');
      expect(r.rows.every((x) => x.owner_id === OWNER)).toBe(true);
    });
    await expect(
      as(owner2, (tx) => tx.query(`update public.ask_log set answer = 'changed'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(as(owner2, (tx) => tx.query('delete from public.ask_log'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('a member, the owner without MFA and anon get nothing; nobody writes in the owner name', async () => {
    await expect(as(other2, (tx) => tx.query(ins()))).rejects.toThrow(/row-level security/);
    await expect(
      as(other2, (tx) =>
        tx.query(
          `insert into public.ask_log (owner_id, question, answer, verified, state)
           values ('${OWNER}', 'q', 'a', false, 'capped')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await db.exec(
      `insert into public.ask_log (owner_id, question, answer, verified, state) values ('${OWNER}', 'q', '', false, 'capped')`,
    );
    try {
      await as(owner2, async (tx) => expect(await count(tx, 'public.ask_log')).toBe(1));
      await as(other2, async (tx) => expect(await count(tx, 'public.ask_log')).toBe(0));
      await as(owner1, async (tx) => expect(await count(tx, 'public.ask_log')).toBe(0));
      await expect(as(anon, (tx) => count(tx, 'public.ask_log'))).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec('delete from public.ask_log');
    }
  });

  it('refuses a verified facts-only row, an unknown state and an over-long question', async () => {
    await expect(as(owner2, (tx) => tx.query(ins('facts-only', true)))).rejects.toThrow(
      /check constraint/,
    );
    await expect(as(owner2, (tx) => tx.query(ins('maybe', false)))).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      as(owner2, (tx) => tx.query(ins('answered', true, 'x'.repeat(501)))),
    ).rejects.toThrow(/check constraint/);
  });

  it('ask_is_owner() is true only for the app owner with a session, and anon cannot call it', async () => {
    const owner = (tx: Transaction) =>
      tx.query<{ v: boolean }>('select public.ask_is_owner() as v').then((r) => r.rows[0]!.v);
    expect(await as(owner2, owner)).toBe(true);
    expect(await as(other2, owner)).toBe(false);
    expect(await as(owner1, owner)).toBe(false);
    await expect(as(anon, owner)).rejects.toThrow(/permission denied/);
  });

  it("ai_usage takes Sonnet 5's fallback rows from the service key and still refuses unknown models", async () => {
    await db.exec(`
      insert into public.ai_usage (job, purpose, model, input_tokens, output_tokens, usd)
        values ('ask', 'question', 'claude-sonnet-5', 2000, 300, 0.007)`);
    await expect(
      db.query(`
        insert into public.ai_usage (job, purpose, model, input_tokens, output_tokens, usd)
          values ('ask', 'question', 'gpt-x', 1, 1, 0)`),
    ).rejects.toThrow(/check constraint/);
    await db.exec(`delete from public.ai_usage where job = 'ask'`);
    // Signed-in users still cannot write spend, so only the function's service key records it.
    await expect(
      as(owner2, (tx) =>
        tx.query(`insert into public.ai_usage (job, purpose, model, input_tokens, output_tokens, usd)
                  values ('ask', 'question', 'claude-sonnet-5-5', 1, 1, 0)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('password mode (ADR 0039)', () => {
  const other1: Session = { sub: OTHER, aal: 'aal1', role: 'authenticated' };

  it('ships switched to password mode', () => {
    expect(passwordModeShipped).toBe(true);
  });

  it('the owner signed in with a password (aal1) reads their own rows and the system tables', async () => {
    await asPasswordMode(owner1, async (tx) => {
      expect(await count(tx, 'public.user_settings')).toBe(1);
      expect(await count(tx, 'public.watchlist_items')).toBe(2);
      expect(await count(tx, 'public.job_runs')).toBe(1);
      expect(await count(tx, 'public.alerts')).toBe(1);
    });
  });

  it('a friend signed in with a password reads shared data but nothing of the owner', async () => {
    await asPasswordMode(other1, async (tx) => {
      expect(await count(tx, 'public.job_runs')).toBe(1);
      expect(await count(tx, 'public.daily_bars')).toBe(1);
      expect(await count(tx, 'public.alerts')).toBe(0);
      expect(await count(tx, 'public.briefs')).toBe(0);
      expect(await count(tx, 'public.user_settings')).toBe(1);
      const r = await tx.query<{ owner_id: string }>('select owner_id from public.watchlist_items');
      expect(r.rows.every((x) => x.owner_id === OTHER)).toBe(true);
    });
  });

  it('a session with no assurance level (a forged or anon-shaped token) gets nothing', async () => {
    await asPasswordMode({ sub: OWNER, role: 'authenticated' }, async (tx) => {
      expect(await count(tx, 'public.user_settings')).toBe(0);
      expect(await count(tx, 'public.job_runs')).toBe(0);
    });
  });

  it('the anon role still has no access', async () => {
    await expect(asPasswordMode(anon, (tx) => count(tx, 'public.job_runs'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('signed-in users cannot read or change the switch', async () => {
    await expect(
      asPasswordMode(owner1, (tx) => tx.query('select * from private.auth_policy')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asPasswordMode(owner1, (tx) =>
        tx.query('update private.auth_policy set require_mfa = false'),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('schema guards', () => {
  it('every table in public has row-level security enabled', async () => {
    const r = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });

  it('anon holds no privileges on any public table', async () => {
    const r = await db.query<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'`);
    expect(r.rows).toEqual([]);
  });
  // Phase 8 security review (docs/SECURITY_REVIEW.md): the rules every new table must keep.
  it('every policy is for authenticated only and requires an MFA session', async () => {
    const r = await db.query<{
      tablename: string;
      policyname: string;
      roles: string;
      qual: string | null;
      with_check: string | null;
    }>(`
      select tablename, policyname, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public'`);
    expect(r.rows.length).toBeGreaterThan(20);
    const bad = r.rows.filter(
      (p) =>
        p.roles !== '{authenticated}' ||
        !/private\.(is_mfa|is_app_owner|is_member)\(\)/.test(p.qual ?? '') ||
        (p.with_check !== null &&
          !/private\.(is_mfa|is_app_owner|is_member)\(\)/.test(p.with_check)),
    );
    expect(bad.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([]);
  });

  it("Khaled's signals stay owner-only: alerts, outcomes, briefs, AI usage, push devices, system alerts (ADR 0040)", async () => {
    const r = await db.query<{ tablename: string; qual: string }>(`
      select tablename, qual from pg_policies where schemaname = 'public' and tablename in
        ('alerts', 'alert_outcomes', 'briefs', 'ai_usage', 'push_subscriptions', 'system_alerts')`);
    expect(r.rows).toHaveLength(6);
    for (const p of r.rows) expect(p.qual, p.tablename).toMatch(/private\.is_app_owner\(\)/);
  });

  it('every table with an owner_id is personal: its policies filter by auth.uid()', async () => {
    const r = await db.query<{ tablename: string; policyname: string }>(`
      select p.tablename, p.policyname from pg_policies p
      where p.schemaname = 'public'
        and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'owner_id')
        and (p.qual not like '%owner_id = ( SELECT auth.uid()%'
             or (p.with_check is not null and p.with_check not like '%owner_id = ( SELECT auth.uid()%'))`);
    expect(r.rows).toEqual([]);
  });

  it('signed-in users can write only personal tables (those with an owner_id)', async () => {
    const r = await db.query<{ table_name: string; privilege_type: string }>(`
      select g.table_name, g.privilege_type from information_schema.role_table_grants g
      where g.grantee = 'authenticated' and g.table_schema = 'public'
        and (g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
             or (g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
                 and not exists (select 1 from information_schema.columns c
                                 where c.table_schema = 'public' and c.table_name = g.table_name
                                   and c.column_name = 'owner_id')))`);
    expect(r.rows).toEqual([]);
  });

  it('public has no views and no security-definer or anon-callable functions', async () => {
    const views = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')`);
    expect(views.rows).toEqual([]);
    const fns = await db.query<{ proname: string; definer: boolean; anon: boolean }>(`
      select p.proname, p.prosecdef as definer, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    expect(fns.rows.filter((f) => f.definer || f.anon)).toEqual([]);
  });

  it('anon cannot use the private schema or call its functions', async () => {
    const r = await db.query<{ usage: boolean; mfa: boolean; owner: boolean }>(`
      select has_schema_privilege('anon', 'private', 'usage') as usage,
             has_function_privilege('anon', 'private.is_mfa()', 'execute') as mfa,
             has_function_privilege('anon', 'private.is_app_owner()', 'execute') as owner`);
    expect(r.rows[0]).toEqual({ usage: false, mfa: false, owner: false });
  });
});

describe('system alerts', () => {
  it('rejects an alert with a headline over 90 characters or an unknown event', async () => {
    await expect(
      db.query(
        `insert into public.system_alerts (event, source, headline, trigger, policy_version)
         values ('stale', 'x', '${'a'.repeat(91)}', 't', 'v')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into public.system_alerts (event, source, headline, trigger, policy_version)
         values ('calm', 'x', 'h', 't', 'v')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('scheduler (ADR 0008)', () => {
  const workflowsDir = join(here, '..', '..', '.github', 'workflows');

  /** Clears what the scheduler writes, so other tests keep their counts. */
  async function reset() {
    await db.exec(`
      delete from private.workflow_dispatches;
      delete from net.http_request_queue;
      delete from net._http_response;
      delete from vault.secrets;
      delete from public.job_runs where job = 'scheduler';`);
  }

  it("every workflow's schedule is copied exactly into Supabase Cron, plus the 15-minute check", async () => {
    const expected: string[] = [];
    for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'))) {
      for (const m of readFileSync(join(workflowsDir, file), 'utf8').matchAll(
        /^\s+- cron: '([^']+)'/gm,
      ))
        expected.push(`${file} ${m[1]}`);
    }
    const r = await db.query<{ jobname: string; schedule: string; command: string }>(
      'select jobname, schedule, command from cron.job',
    );
    const actual = r.rows
      .filter((j) => j.jobname.startsWith('gh-'))
      .map((j) => `${/dispatch_workflow\('([^']+)'\)/.exec(j.command)?.[1]} ${j.schedule}`);
    expect(expected.length).toBeGreaterThan(20);
    expect(actual.sort()).toEqual(expected.sort());
    expect(r.rows.find((j) => j.jobname === 'scheduler-check')).toMatchObject({
      schedule: '*/15 * * * *',
      command: 'select private.check_workflow_dispatches()',
    });
  });

  it('without the token nothing is sent, and the Status page is told so', async () => {
    await reset();
    await db.query(`select private.dispatch_workflow('halts.yml')`);
    expect((await db.query('select * from net.http_request_queue')).rows).toEqual([]);
    await db.query(`update private.workflow_dispatches set sent_at = now() - interval '5 minutes'`);
    await db.query('select private.check_workflow_dispatches()');
    const run = await db.query<{ status: string; error: string; details: unknown }>(
      `select status, error, details from public.job_runs where job = 'scheduler'`,
    );
    expect(run.rows).toEqual([
      {
        status: 'skipped',
        error: 'GitHub token not stored in Supabase Vault yet (ADR 0008); nothing was sent',
        details: { sent: 1, accepted: 0, refused: 0, noToken: 1, noReply: 0 },
      },
    ]);
    await reset();
  });

  it("with the token: a POST to the workflow's dispatch URL; a refusal is recorded with GitHub's reply", async () => {
    await reset();
    await db.query(
      `insert into vault.secrets (name, secret) values ('github_actions_token', 'test-token')`,
    );
    await db.query(`select private.dispatch_workflow('halts.yml')`);
    await db.query(`select private.dispatch_workflow('health.yml')`);
    const q = await db.query<{
      id: number;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }>('select id, url, headers, body from net.http_request_queue order by id');
    expect(q.rows.map((x) => x.url)).toEqual([
      'https://api.github.com/repos/kghamdi84/Marsad/actions/workflows/halts.yml/dispatches',
      'https://api.github.com/repos/kghamdi84/Marsad/actions/workflows/health.yml/dispatches',
    ]);
    expect(q.rows[0]?.headers['Authorization']).toBe('Bearer test-token');
    expect(q.rows[0]?.body).toEqual({ ref: 'main' });
    // GitHub refuses the first (a bad token) and accepts the second (204, no body).
    await db.query(
      `insert into net._http_response (id, status_code, content) values ($1, 401, '{"message":"Bad credentials"}'), ($2, 204, '')`,
      [q.rows[0]?.id, q.rows[1]?.id],
    );
    await db.query(`update private.workflow_dispatches set sent_at = now() - interval '5 minutes'`);
    await db.query('select private.check_workflow_dispatches()');
    const run = await db.query<{
      status: string;
      rows_written: number;
      error: string;
      details: unknown;
    }>(`select status, rows_written, error, details from public.job_runs where job = 'scheduler'`);
    expect(run.rows).toEqual([
      {
        status: 'error',
        rows_written: 1,
        error: 'halts.yml: HTTP 401 {"message":"Bad credentials"}',
        details: { sent: 2, accepted: 1, refused: 1, noToken: 0, noReply: 0 },
      },
    ]);
    await reset();
  });

  it('refuses a name that is not a workflow file, and signed-in users cannot call the scheduler', async () => {
    await expect(db.query(`select private.dispatch_workflow('x; select 1')`)).rejects.toThrow(
      /not a workflow file name/,
    );
    await expect(
      as(owner2, (tx) => tx.query(`select private.dispatch_workflow('halts.yml')`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(owner2, (tx) => tx.query(`select private.check_workflow_dispatches()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(anon, (tx) => tx.query(`select private.dispatch_workflow('halts.yml')`)),
    ).rejects.toThrow(/permission denied/);
  });
});
