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
      expect(await count(tx, 'public.source_status')).toBe(7); // five seeded sources plus massive_reference and massive_bars
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
