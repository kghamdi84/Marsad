import { describe, expect, it } from 'vitest';
import type { JobRunRecord, StoredAlertText } from '@marsad/core';
import {
  runCriticalEmailJob,
  runDigestJob,
  type DeliveryField,
  type EmailStore,
  type EmailTable,
  type PendingEmail,
} from './email-job.js';

const NOW = new Date('2026-11-25T15:00:00Z');
const card = [{ heading: '[HALT, critical] SOFI', lines: ['SOFI halted'] }];
const alert = (id: string, createdAt = '2026-11-25T14:59:00Z'): StoredAlertText => ({
  id,
  createdAt,
  kind: 'halt',
  priority: 'critical',
  headline: `Alert ${id}`,
  card,
  reasons: [],
});

function fakeStore(email: PendingEmail[], digest: StoredAlertText[] = []) {
  const logs = new Map<string, Record<string, string>>();
  for (const p of email) logs.set(`${p.table}:${p.alert.id}`, { ...p.delivery, email: 'pending' });
  for (const a of digest)
    logs.set(`alerts:${a.id}`, { push: 'not sent (digest)', digest: 'pending' });
  const runs: JobRunRecord[] = [];
  const store: EmailStore = {
    getPendingEmail: () =>
      Promise.resolve(
        email.filter((p) => logs.get(`${p.table}:${p.alert.id}`)?.['email'] === 'pending'),
      ),
    getPendingDigest: () =>
      Promise.resolve(
        digest
          .filter((a) => logs.get(`alerts:${a.id}`)?.['digest'] === 'pending')
          .map((a) => ({ alert: a, delivery: logs.get(`alerts:${a.id}`) ?? {} })),
      ),
    setDelivery: (table: EmailTable, id: string, field: DeliveryField, expect: string, next) => {
      const k = `${table}:${id}`;
      if (logs.get(k)?.[field] !== expect) return Promise.resolve(false);
      logs.set(k, next);
      return Promise.resolve(true);
    },
    recordRun: (r) => {
      runs.push(r);
      return Promise.resolve();
    },
  };
  return { store, logs, runs };
}

const mailbox = (fail = false) => {
  const sent: { subject: string; text: string }[] = [];
  return {
    sent,
    send: (subject: string, text: string) => {
      if (fail) return Promise.reject(new Error('Resend answered 403'));
      sent.push({ subject, text });
      return Promise.resolve();
    },
  };
};

const critical = (id: string, createdAt?: string): PendingEmail => ({
  table: 'alerts',
  alert: alert(id, createdAt),
  delivery: { push: 'pending', email: 'pending' },
});
const system: PendingEmail = {
  table: 'system_alerts',
  alert: {
    id: '7',
    createdAt: '2026-11-25T14:58:00Z',
    event: 'stale',
    source: 'nasdaq-halts',
    headline: 'Halts feed stale',
    trigger: 'No message for 30 minutes.',
    pausedRules: ['halt-alerts'],
  },
  delivery: { push: 'pending', email: 'pending' },
};

describe('runCriticalEmailJob', () => {
  it('sends one copy per critical and system alert and records it', async () => {
    const f = fakeStore([critical('a1'), system]);
    const m = mailbox();
    const run = await runCriticalEmailJob({ store: f.store, send: m.send, now: () => NOW });
    expect(run.status).toBe('ok');
    // The job sends in the store's order (the real store returns oldest first).
    expect(m.sent.map((x) => x.subject)).toEqual([
      'Marsad critical: Alert a1',
      'Marsad system: feed stale, nasdaq-halts',
    ]);
    expect(f.logs.get('alerts:a1')).toEqual({
      push: 'pending',
      email: 'sent',
      email_version: 'digest-1',
      email_at: NOW.toISOString(),
    });
    const again = await runCriticalEmailJob({ store: f.store, send: m.send, now: () => NOW });
    expect(again.rows_written).toBe(0);
    expect(m.sent).toHaveLength(2);
  });

  it('records not configured without the email secrets, and expired after 24 hours', async () => {
    const f = fakeStore([critical('new'), critical('old', '2026-11-24T14:59:59Z')]);
    const run = await runCriticalEmailJob({ store: f.store, send: undefined, now: () => NOW });
    expect(run.status).toBe('skipped');
    expect(f.logs.get('alerts:new')?.['email']).toBe(
      'not-configured (RESEND_API_KEY or BRIEF_EMAIL_TO missing)',
    );
    expect(f.logs.get('alerts:old')?.['email']).toBe('expired (not sent within 24 h)');
  });

  it('fails the run when no copy could be sent, with the reason in the log', async () => {
    const f = fakeStore([critical('a1')]);
    const run = await runCriticalEmailJob({
      store: f.store,
      send: mailbox(true).send,
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(f.logs.get('alerts:a1')?.['email']).toBe('failed: Resend answered 403');
  });

  it('never sends an item another run already claimed', async () => {
    const f = fakeStore([critical('a1')]);
    const real = f.store.getPendingEmail;
    f.store.getPendingEmail = async () => {
      const rows = await real();
      await f.store.setDelivery('alerts', 'a1', 'email', 'pending', { email: 'sending' });
      return rows;
    };
    const m = mailbox();
    const run = await runCriticalEmailJob({ store: f.store, send: m.send, now: () => NOW });
    expect(m.sent).toHaveLength(0);
    expect(run.details).toMatchObject({ claimedElsewhere: 1 });
  });
});

describe('runDigestJob', () => {
  it('sends one email for every held alert and marks each sent', async () => {
    const f = fakeStore(
      [],
      [alert('d1', '2026-11-25T02:00:00Z'), alert('d2', '2026-11-25T03:00:00Z')],
    );
    const m = mailbox();
    const run = await runDigestJob({ store: f.store, send: m.send, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(run.rows_written).toBe(2);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]?.subject).toBe('Marsad digest: 2 alerts held, 2026-11-25');
    expect(f.logs.get('alerts:d1')?.['digest']).toBe('sent');
    const again = await runDigestJob({ store: f.store, send: m.send, now: () => NOW });
    expect(again.rows_written).toBe(0);
    expect(m.sent).toHaveLength(1);
  });

  it('expires alerts held longer than 48 hours instead of mailing them as news', async () => {
    const f = fakeStore(
      [],
      [alert('stale', '2026-11-23T14:59:59Z'), alert('ok', '2026-11-23T15:00:00Z')],
    );
    const m = mailbox();
    await runDigestJob({ store: f.store, send: m.send, now: () => NOW });
    expect(f.logs.get('alerts:stale')?.['digest']).toBe('expired (older than 48 h)');
    expect(f.logs.get('alerts:ok')?.['digest']).toBe('sent');
    expect(m.sent[0]?.text).not.toContain('Alert stale');
  });

  it('keeps the alerts for the next digest when the send fails', async () => {
    const f = fakeStore([], [alert('d1', '2026-11-25T02:00:00Z')]);
    const run = await runDigestJob({ store: f.store, send: mailbox(true).send, now: () => NOW });
    expect(run.status).toBe('error');
    expect(run.error).toMatch(/kept for the next digest/);
    expect(f.logs.get('alerts:d1')?.['digest']).toBe('pending');
  });

  it('records not configured without the email secrets, and sends nothing when nothing is held', async () => {
    const f = fakeStore([], [alert('d1', '2026-11-25T02:00:00Z')]);
    await runDigestJob({ store: f.store, send: undefined, now: () => NOW });
    expect(f.logs.get('alerts:d1')?.['digest']).toBe(
      'not-configured (RESEND_API_KEY or BRIEF_EMAIL_TO missing)',
    );
    const m = mailbox();
    const empty = await runDigestJob({ store: fakeStore([]).store, send: m.send, now: () => NOW });
    expect(empty.status).toBe('ok');
    expect(m.sent).toHaveLength(0);
  });
});
