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
    insert into public.rules (id, version, hash, doc) values ('index-trend-filter', 1, 'abcdef12', '{}'::jsonb);
    insert into public.rule_events (rule_id, version, to_status, reason) values ('index-trend-filter', 1, 'draft', 'new version');
    insert into public.backtest_runs (rule_id, version, engine, params, trials, report)
      values ('index-trend-filter', 1, 'backtest-1', '{}'::jsonb, 1, '{}'::jsonb);
    insert into public.briefs (kind, for_date, version, title, push_body, sections, inputs)
      values ('pre-market', date '2026-11-25', 'brief-1', 'Pre-market brief, Wed 2026-11-25', 'Regime Stress.', '[]'::jsonb, '{}'::jsonb);
    insert into public.market_movers_daily (date, version, n, gainers, losers, sectors)
      values (date '2026-11-24', 'watch-1', 990, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
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
});

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
      expect(await count(tx, 'public.source_status')).toBe(14); // five seeded sources plus massive_reference, massive_bars, the four Study sources, massive_sections, massive_breadth and massive_topics
    });
  });

  it('a non-owner account reads no system rows', async () => {
    await as(other2, async (tx) => {
      expect(await count(tx, 'public.job_runs')).toBe(0);
      expect(await count(tx, 'public.source_status')).toBe(0);
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

  it('identity, split and alert tables follow the same rule: owner with MFA reads, everyone else nothing', async () => {
    for (const table of [
      'instruments',
      'instrument_tickers',
      'splits',
      'system_alerts',
      'daily_bars',
    ]) {
      await as(owner2, async (tx) => expect(await count(tx, `public.${table}`)).toBe(1));
      await as(other2, async (tx) => expect(await count(tx, `public.${table}`)).toBe(0));
      await as(owner1, async (tx) => expect(await count(tx, `public.${table}`)).toBe(0));
      await expect(as(anon, (tx) => count(tx, `public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(owner2, (tx) => tx.query(`delete from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('every Study table follows the same rule: owner with MFA reads, everyone else nothing, nobody deletes', async () => {
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
      'briefs',
      'rules',
      'rule_events',
      'backtest_runs',
      'alerts',
      'econ_calendar_snapshots',
      'earnings_estimate_snapshots',
      'news_articles',
      'short_interest',
      'short_volume',
      'dividends',
    ]) {
      await as(owner2, async (tx) => expect(await count(tx, `public.${table}`), table).toBe(1));
      await as(other2, async (tx) => expect(await count(tx, `public.${table}`), table).toBe(0));
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
