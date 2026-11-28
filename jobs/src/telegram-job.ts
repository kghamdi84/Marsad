import { planPush, runJob, type JobRunRecord } from '@marsad/core';
import type { PendingPush, PushStore } from './push-job.js';

/** The queue reads and the once-only claim, on the `telegram` field of the delivery log. */
export type TelegramStore = Pick<PushStore, 'getPendingPush' | 'setPushDelivery' | 'recordRun'>;
export type TelegramSend = (text: string) => Promise<void>;

export interface TelegramJobDeps {
  store: TelegramStore;
  /** Undefined when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set. */
  send: TelegramSend | undefined;
  now: () => Date;
  test?: boolean;
}

export const TELEGRAM_VERSION = 'telegram-1';
const SITE = 'https://marsad-k84.netlify.app';
const NOT_CONFIGURED = 'not-configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing)';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

/**
 * Telegram as the second channel (telegram-1, ADR 0033): the same items and the same freshness rules as Web Push
 * (planPush: too old is not sent, late says so), each claimed once on its own `telegram` field, so a push failure
 * on the iPad does not mean silence.
 */
export async function runTelegramJob(deps: TelegramJobDeps): Promise<JobRunRecord> {
  const { store, send, now } = deps;
  const run = await runJob(
    deps.test ? 'telegram-test' : 'telegram',
    async () => {
      const at = now();
      if (deps.test) {
        if (send === undefined) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing');
        await send(
          `Marsad test message\nSent ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC. Telegram reaches you.\n${SITE}/status`,
        );
        return { rows: 1, details: { test: true } };
      }
      const pending = await store.getPendingPush();
      // A channel without its secrets is "skipped" with the reason, never "ok", so Status cannot look healthy.
      if (pending.length === 0)
        return send === undefined
          ? { rows: 0, skipped: NOT_CONFIGURED, details: { pending: 0, configured: false } }
          : { rows: 0, details: { pending: 0 } };
      const settle = (p: PendingPush, from: string, telegram: string) =>
        store.setPushDelivery(p.table, p.item.id, from, {
          ...p.delivery,
          telegram,
          telegram_version: TELEGRAM_VERSION,
          telegram_at: at.toISOString(),
        });
      let sent = 0;
      let expired = 0;
      let lost = 0;
      const failures: string[] = [];
      for (const p of pending) {
        const plan = planPush(p.item, at);
        if (!plan.send) {
          if (await settle(p, 'pending', plan.delivery)) expired += 1;
          continue;
        }
        if (send === undefined) {
          await settle(p, 'pending', NOT_CONFIGURED);
          continue;
        }
        if (
          !(await store.setPushDelivery(p.table, p.item.id, 'pending', {
            ...p.delivery,
            telegram: 'sending',
          }))
        ) {
          lost += 1;
          continue;
        }
        const m = plan.message;
        try {
          await send(`${m.title}\n${m.body}\n${SITE}${m.url}`);
          await settle(p, 'sending', 'sent');
          sent += 1;
        } catch (e) {
          await settle(p, 'sending', `failed: ${message(e)}`);
          failures.push(`${p.table} ${p.item.id}: ${message(e)}`);
        }
      }
      if (failures.length > 0 && sent === 0)
        throw new Error(`No Telegram message delivered: ${failures.slice(0, 3).join(' | ')}`);
      return {
        rows: sent,
        ...(send === undefined ? { skipped: NOT_CONFIGURED } : {}),
        details: {
          pending: pending.length,
          sent,
          expired,
          configured: send !== undefined,
          ...(lost ? { claimedElsewhere: lost } : {}),
          ...(failures.length ? { failures: failures.slice(0, 5) } : {}),
        },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}

/**
 * Sends through the Telegram Bot API when both secrets are set. Errors name only the HTTP status and Telegram's
 * description, never the request URL, which contains the token.
 */
export function telegramSender(): TelegramSend | undefined {
  const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
  const chat = process.env['TELEGRAM_CHAT_ID']?.trim();
  if (!token || !chat) return undefined;
  return async (text) => {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('Telegram could not be reached');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { description?: unknown };
      const why = typeof body.description === 'string' ? body.description.slice(0, 120) : '';
      throw new Error(`Telegram answered ${res.status}${why ? `: ${why}` : ''}`);
    }
  };
}
