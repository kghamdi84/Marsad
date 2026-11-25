import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobRunRecord } from '@marsad/core';
import type { PendingPush, PushTable } from './push-job.js';
import { runTelegramJob, telegramSender, type TelegramStore } from './telegram-job.js';

const NOW = new Date('2026-11-25T15:00:00Z');

function fakeStore(pending: PendingPush[]) {
  const logs = new Map<string, Record<string, string>>(
    pending.map((p) => [`${p.table}:${p.item.id}`, { ...p.delivery, telegram: 'pending' }]),
  );
  const runs: JobRunRecord[] = [];
  const store: TelegramStore = {
    getPendingPush: () =>
      Promise.resolve(
        pending.filter((p) => logs.get(`${p.table}:${p.item.id}`)?.['telegram'] === 'pending'),
      ),
    setPushDelivery: (table: PushTable, id: string, expect: string, next) => {
      const k = `${table}:${id}`;
      if (logs.get(k)?.['telegram'] !== expect) return Promise.resolve(false);
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

const halt = (id: string, createdAt = '2026-11-25T14:59:00Z'): PendingPush => ({
  table: 'alerts',
  item: {
    type: 'alert',
    id,
    priority: 'critical',
    title: '[HALT, critical] SOFI: halted (T1)',
    body: 'Nasdaq halt notice.',
    createdAt,
  },
  delivery: { push: 'sent to 1 of 1 device', telegram: 'pending' },
});

describe('runTelegramJob', () => {
  it('sends what push sends, once, with the card link', async () => {
    const f = fakeStore([halt('a1')]);
    const sent: string[] = [];
    const send = (t: string) => {
      sent.push(t);
      return Promise.resolve();
    };
    const run = await runTelegramJob({ store: f.store, send, now: () => NOW });
    expect(run.status).toBe('ok');
    expect(sent).toEqual([
      '[HALT, critical] SOFI: halted (T1)\nNasdaq halt notice.\nhttps://marsad-k84.netlify.app/alerts#alert-a1',
    ]);
    expect(f.logs.get('alerts:a1')).toEqual({
      push: 'sent to 1 of 1 device',
      telegram: 'sent',
      telegram_version: 'telegram-1',
      telegram_at: NOW.toISOString(),
    });
    await runTelegramJob({ store: f.store, send, now: () => NOW });
    expect(sent).toHaveLength(1);
  });

  it('follows the push freshness rules: too old is not sent', async () => {
    const f = fakeStore([halt('old', '2026-11-25T12:00:00Z')]);
    const sent: string[] = [];
    await runTelegramJob({
      store: f.store,
      send: (t) => {
        sent.push(t);
        return Promise.resolve();
      },
      now: () => NOW,
    });
    expect(sent).toHaveLength(0);
    expect(f.logs.get('alerts:old')?.['telegram']).toBe('expired (not sent within 2 h)');
  });

  it('records not configured without the secrets, and fails the run when every send fails', async () => {
    const f = fakeStore([halt('a1')]);
    await runTelegramJob({ store: f.store, send: undefined, now: () => NOW });
    expect(f.logs.get('alerts:a1')?.['telegram']).toBe(
      'not-configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing)',
    );
    const g = fakeStore([halt('a2')]);
    const run = await runTelegramJob({
      store: g.store,
      send: () =>
        Promise.reject(new Error('Telegram answered 403: Forbidden: bot was blocked by the user')),
      now: () => NOW,
    });
    expect(run.status).toBe('error');
    expect(g.logs.get('alerts:a2')?.['telegram']).toBe(
      'failed: Telegram answered 403: Forbidden: bot was blocked by the user',
    );
  });

  it('sends a test message only when asked, and says when it cannot', async () => {
    const sent: string[] = [];
    const ok = await runTelegramJob({
      store: fakeStore([]).store,
      send: (t) => {
        sent.push(t);
        return Promise.resolve();
      },
      now: () => NOW,
      test: true,
    });
    expect(ok.job).toBe('telegram-test');
    expect(sent[0]).toContain('Marsad test message\nSent 2026-11-25 15:00 UTC.');
    const none = await runTelegramJob({
      store: fakeStore([]).store,
      send: undefined,
      now: () => NOW,
      test: true,
    });
    expect(none.status).toBe('error');
  });
});

describe('telegramSender', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('is off without both secrets', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    expect(telegramSender()).toBeUndefined();
  });
  it('posts the text to the chat and never puts the token in an error', async () => {
    const token = '123456:SECRET-token-value';
    vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
    vi.stubEnv('TELEGRAM_CHAT_ID', '42');
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
          status: 400,
        }),
      );
    });
    const send = telegramSender();
    await expect(send?.('hello')).rejects.toThrow(
      'Telegram answered 400: Bad Request: chat not found',
    );
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(calls[0]?.body).toEqual({
      chat_id: '42',
      text: 'hello',
      disable_web_page_preview: true,
    });
    vi.stubGlobal('fetch', () =>
      Promise.reject(new Error(`connect failed https://api.telegram.org/bot${token}`)),
    );
    const err = await send?.('x').catch((e: Error) => e.message);
    expect(err).toBe('Telegram could not be reached');
    expect(String(err)).not.toContain(token);
  });
});
