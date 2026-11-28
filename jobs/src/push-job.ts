import {
  PUSH_VERSION,
  planPush,
  pushPayload,
  runJob,
  type JobRunRecord,
  type PushItem,
  type PushMessage,
} from '@marsad/core';

export type PushTable = 'alerts' | 'system_alerts' | 'briefs';

/** An item whose delivery log says push is pending, with the log as stored (merged on every update). */
export interface PendingPush {
  table: PushTable;
  item: PushItem;
  delivery: Record<string, string>;
}

export interface PushDevice {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  /** Consecutive failed sends so far. */
  failures: number;
}

export interface PushStore {
  /** Items with delivery.push = 'pending', oldest first. */
  getPendingPush(): Promise<PendingPush[]>;
  /**
   * Replaces the delivery log only while it still says `expect` for push; true when this run won the item. Two
   * dispatchers running at once can therefore never both send the same item.
   */
  setPushDelivery(
    table: PushTable,
    id: string,
    expect: string,
    delivery: Record<string, string>,
  ): Promise<boolean>;
  /** The owner's VAPID public key, or null before keys are created on the Status page. */
  getPushPublicKey(): Promise<string | null>;
  /** Devices not disabled. */
  getPushDevices(): Promise<PushDevice[]>;
  /** Success clears the error and the failure count; a failure stores the error and the new count. */
  recordDeviceResult(
    id: number,
    r:
      | { ok: true; at: string }
      | { ok: false; error: string; failures: number; disabledAt: string | null },
  ): Promise<void>;
  recordRun(run: JobRunRecord): Promise<void>;
}

export interface SendOutcome {
  ok: boolean;
  status: number;
  error?: string;
}

/** Encrypts and posts one message to one device (web-push in production, a stand-in in tests). */
export type PushSender = (
  device: PushDevice,
  payload: string,
  m: PushMessage,
) => Promise<SendOutcome>;

export interface PushJobDeps {
  store: PushStore;
  /** Null when VAPID_PRIVATE_KEY is not set. */
  sender: PushSender | null;
  /** The public key derived from VAPID_PRIVATE_KEY, or null when it is not set. */
  secretPublicKey: string | null;
  now: () => Date;
  /** Sends one test message to every device instead of dispatching pending items. */
  test?: boolean;
}

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);

/**
 * The Web Push dispatcher (push-1, ADR 0031). Runs at the end of every workflow that can create an alert, a
 * system alert or a brief. Each pending item is claimed, judged by planPush (too old: not sent; late: says so),
 * sent to every active device and its delivery log updated. Nothing is sent before keys and devices exist, and
 * the delivery log says why; a key that does not match the one the devices subscribed with fails the run.
 */
export async function runPushJob(deps: PushJobDeps): Promise<JobRunRecord> {
  const { store, sender, secretPublicKey, now } = deps;
  const run = await runJob(
    deps.test ? 'push-test' : 'push-dispatch',
    async () => {
      const at = now();
      const pending = deps.test ? [] : await store.getPendingPush();
      if (!deps.test && pending.length === 0)
        return sender === null || secretPublicKey === null
          ? {
              rows: 0,
              skipped: 'not-configured (VAPID_PRIVATE_KEY secret missing)',
              details: { pending: 0 },
            }
          : { rows: 0, details: { pending: 0 } };

      const settle = async (p: PendingPush, push: string) =>
        store.setPushDelivery(p.table, p.item.id, 'pending', {
          ...p.delivery,
          push,
          push_version: PUSH_VERSION,
          push_at: at.toISOString(),
        });
      const holdAll = async (why: string) => {
        for (const p of pending) await settle(p, why);
      };

      const publicKey = await store.getPushPublicKey();
      if (sender === null || secretPublicKey === null) {
        await holdAll('not-configured (VAPID_PRIVATE_KEY secret missing)');
        if (deps.test) throw new Error('VAPID_PRIVATE_KEY secret missing');
        return {
          rows: 0,
          skipped: 'not-configured (VAPID_PRIVATE_KEY secret missing)',
          details: { pending: pending.length, notConfigured: 'secret' },
        };
      }
      if (publicKey === null) {
        await holdAll('not-configured (no keys created on the Status page)');
        if (deps.test) throw new Error('No keys created on the Status page');
        return {
          rows: 0,
          skipped: 'not-configured (no keys created on the Status page)',
          details: { pending: pending.length, notConfigured: 'keys' },
        };
      }
      if (publicKey !== secretPublicKey) {
        await holdAll('failed (VAPID_PRIVATE_KEY does not match the keys on the Status page)');
        throw new Error('VAPID_PRIVATE_KEY does not match the public key saved on the Status page');
      }
      const devices = await store.getPushDevices();
      if (devices.length === 0) {
        await holdAll('no devices (turn on notifications on the Status page)');
        if (deps.test) throw new Error('No devices have notifications turned on');
        return { rows: 0, details: { pending: pending.length, devices: 0 } };
      }

      const sendAll = async (m: PushMessage) => {
        const payload = pushPayload(m);
        let ok = 0;
        const errors: string[] = [];
        for (const d of devices) {
          let r: SendOutcome;
          try {
            r = await sender(d, payload, m);
          } catch (e) {
            r = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
          }
          if (r.ok) {
            ok += 1;
            d.failures = 0;
            await store.recordDeviceResult(d.id, { ok: true, at: at.toISOString() });
          } else {
            const error = short(`${r.status || 'network'}: ${r.error ?? 'refused'}`);
            errors.push(`${d.device || `device ${d.id}`} ${error}`);
            d.failures += 1;
            // 404 and 410 mean the push service has dropped the subscription: never send to it again.
            const gone = r.status === 404 || r.status === 410;
            await store.recordDeviceResult(d.id, {
              ok: false,
              error,
              failures: d.failures,
              disabledAt: gone ? at.toISOString() : null,
            });
          }
        }
        return { ok, errors };
      };

      if (deps.test) {
        const r = await sendAll({
          title: 'Marsad test notification',
          body: `Sent ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC. Notifications reach this device.`,
          url: '/status',
          tag: 'test',
          urgency: 'normal',
          ttlSeconds: 600,
        });
        if (r.ok === 0) throw new Error(`No device accepted the test: ${r.errors.join('; ')}`);
        return { rows: r.ok, details: { devices: devices.length, sent: r.ok, errors: r.errors } };
      }

      let sent = 0;
      let expired = 0;
      let lost = 0;
      const failures: string[] = [];
      for (const p of pending) {
        const plan = planPush(p.item, at);
        if (!plan.send) {
          if (await settle(p, plan.delivery)) expired += 1;
          else lost += 1;
          continue;
        }
        const claimed = await store.setPushDelivery(p.table, p.item.id, 'pending', {
          ...p.delivery,
          push: 'sending',
        });
        if (!claimed) {
          lost += 1;
          continue;
        }
        const r = await sendAll(plan.message);
        const result =
          r.ok > 0
            ? `sent to ${r.ok} of ${devices.length} device${devices.length === 1 ? '' : 's'}`
            : `failed (${r.errors[0] ?? 'no device accepted'})`.slice(0, 240);
        await store.setPushDelivery(p.table, p.item.id, 'sending', {
          ...p.delivery,
          push: result,
          push_version: PUSH_VERSION,
          push_at: at.toISOString(),
        });
        if (r.ok > 0) sent += 1;
        else failures.push(`${p.table} ${p.item.id}: ${r.errors.join('; ')}`);
      }
      if (failures.length > 0 && sent === 0)
        throw new Error(`No push delivered: ${failures.slice(0, 3).join(' | ')}`);
      return {
        rows: sent,
        details: {
          pending: pending.length,
          sent,
          expired,
          devices: devices.length,
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
