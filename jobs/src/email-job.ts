import {
  DIGEST_MAX_AGE_SECONDS,
  DIGEST_VERSION,
  EMAIL_COPY_MAX_AGE_SECONDS,
  criticalAlertEmail,
  digestEmail,
  runJob,
  systemAlertEmail,
  type JobRunRecord,
  type StoredAlertText,
  type SystemAlertText,
} from '@marsad/core';

export type EmailTable = 'alerts' | 'system_alerts';
export type DeliveryField = 'email' | 'digest';

export type PendingEmail =
  | { table: 'alerts'; alert: StoredAlertText; delivery: Record<string, string> }
  | { table: 'system_alerts'; alert: SystemAlertText; delivery: Record<string, string> };

export interface EmailStore {
  /** Critical alerts and system alerts with delivery.email = 'pending', oldest first. */
  getPendingEmail(): Promise<PendingEmail[]>;
  /** Alerts with delivery.digest = 'pending', oldest first. */
  getPendingDigest(): Promise<{ alert: StoredAlertText; delivery: Record<string, string> }[]>;
  /** Replaces the delivery log only while `field` still says `expect`; true when this run won the item. */
  setDelivery(
    table: EmailTable,
    id: string,
    field: DeliveryField,
    expect: string,
    delivery: Record<string, string>,
  ): Promise<boolean>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export type EmailSend = (subject: string, text: string) => Promise<void>;

export interface EmailJobDeps {
  store: EmailStore;
  /** Undefined when RESEND_API_KEY or BRIEF_EMAIL_TO is not set. */
  send: EmailSend | undefined;
  now: () => Date;
}

const NOT_CONFIGURED = 'not-configured (RESEND_API_KEY or BRIEF_EMAIL_TO missing)';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
const ageSeconds = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 1000;

/**
 * Email copies of critical alerts and system alerts (digest-1, ADR 0032), run right after the push dispatcher.
 * Each item is claimed once, sent within 24 hours (late copies say how late) and its delivery log updated.
 */
export async function runCriticalEmailJob(deps: EmailJobDeps): Promise<JobRunRecord> {
  const { store, send, now } = deps;
  const run = await runJob(
    'email-critical',
    async () => {
      const at = now();
      const pending = await store.getPendingEmail();
      if (pending.length === 0) return { rows: 0, details: { pending: 0 } };
      const settle = (p: PendingEmail, from: string, email: string) =>
        store.setDelivery(p.table, p.alert.id, 'email', from, {
          ...p.delivery,
          email,
          email_version: DIGEST_VERSION,
          email_at: at.toISOString(),
        });
      let sent = 0;
      let expired = 0;
      let lost = 0;
      const failures: string[] = [];
      for (const p of pending) {
        if (!(ageSeconds(p.alert.createdAt, at) <= EMAIL_COPY_MAX_AGE_SECONDS)) {
          if (await settle(p, 'pending', 'expired (not sent within 24 h)')) expired += 1;
          continue;
        }
        if (send === undefined) {
          await settle(p, 'pending', NOT_CONFIGURED);
          continue;
        }
        const claimed = await store.setDelivery(p.table, p.alert.id, 'email', 'pending', {
          ...p.delivery,
          email: 'sending',
        });
        if (!claimed) {
          lost += 1;
          continue;
        }
        const mail =
          p.table === 'alerts' ? criticalAlertEmail(p.alert, at) : systemAlertEmail(p.alert, at);
        try {
          await send(mail.subject, mail.text);
          await settle(p, 'sending', 'sent');
          sent += 1;
        } catch (e) {
          await settle(p, 'sending', `failed: ${message(e)}`);
          failures.push(`${p.table} ${p.alert.id}: ${message(e)}`);
        }
      }
      if (failures.length > 0 && sent === 0)
        throw new Error(`No email copy delivered: ${failures.slice(0, 3).join(' | ')}`);
      return {
        rows: sent,
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
 * The alert digest (digest-1): one email with every alert the pipeline held back since the last digest, sent with
 * the pre-market brief and the close recap. Alerts older than 48 hours are recorded as expired, never mailed as
 * news. If the send fails, the claimed alerts return to pending for the next digest and the run fails.
 */
export async function runDigestJob(deps: EmailJobDeps): Promise<JobRunRecord> {
  const { store, send, now } = deps;
  const run = await runJob(
    'alert-digest',
    async () => {
      const at = now();
      const pending = await store.getPendingDigest();
      const stamp = (delivery: Record<string, string>, digest: string) => ({
        ...delivery,
        digest,
        digest_version: DIGEST_VERSION,
        digest_at: at.toISOString(),
      });
      let expired = 0;
      const fresh: typeof pending = [];
      for (const p of pending) {
        if (ageSeconds(p.alert.createdAt, at) <= DIGEST_MAX_AGE_SECONDS) fresh.push(p);
        else if (
          await store.setDelivery(
            'alerts',
            p.alert.id,
            'digest',
            'pending',
            stamp(p.delivery, 'expired (older than 48 h)'),
          )
        )
          expired += 1;
      }
      if (fresh.length === 0) return { rows: 0, details: { pending: pending.length, expired } };
      if (send === undefined) {
        for (const p of fresh)
          await store.setDelivery(
            'alerts',
            p.alert.id,
            'digest',
            'pending',
            stamp(p.delivery, NOT_CONFIGURED),
          );
        return { rows: 0, details: { pending: pending.length, expired, configured: false } };
      }
      const claimed: typeof pending = [];
      for (const p of fresh)
        if (
          await store.setDelivery('alerts', p.alert.id, 'digest', 'pending', {
            ...p.delivery,
            digest: 'sending',
          })
        )
          claimed.push(p);
      const mail = digestEmail(
        claimed.map((p) => p.alert),
        at,
      );
      if (mail === null)
        return {
          rows: 0,
          details: { pending: pending.length, expired, claimedElsewhere: fresh.length },
        };
      try {
        await send(mail.subject, mail.text);
      } catch (e) {
        for (const p of claimed)
          await store.setDelivery('alerts', p.alert.id, 'digest', 'sending', {
            ...p.delivery,
            digest: 'pending',
          });
        throw new Error(
          `Digest of ${claimed.length} alerts not sent (kept for the next digest): ${message(e)}`,
          { cause: e },
        );
      }
      for (const p of claimed)
        await store.setDelivery(
          'alerts',
          p.alert.id,
          'digest',
          'sending',
          stamp(p.delivery, 'sent'),
        );
      return {
        rows: claimed.length,
        details: { pending: pending.length, expired, sent: claimed.length, subject: mail.subject },
      };
    },
    () => now().getTime(),
  );
  await store.recordRun(run);
  return run;
}
