import { createClient } from '@supabase/supabase-js';
import type { CardSection, PushItem, StoredAlertText } from '@marsad/core';
import type { DeliveryField, EmailStore, EmailTable, PendingEmail } from './email-job.js';
import type { PendingPush, PushStore, PushTable } from './push-job.js';

type Row = Record<string, unknown>;

/** The dispatcher's reads and writes with the secret key (job_runs through the main store's recordRun). */
export function supabasePushStore(url: string, secretKey: string): Omit<PushStore, 'recordRun'> {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pending = async (table: PushTable, cols: string): Promise<Row[]> => {
    const { data, error } = await db
      .from(table)
      .select(cols)
      .eq('delivery->>push', 'pending')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(`${table} pending read failed: ${error.message}`);
    return (data ?? []) as unknown as Row[];
  };
  const delivery = (r: Row) => (r['delivery'] ?? {}) as Record<string, string>;
  return {
    async getPendingPush() {
      const out: PendingPush[] = [];
      for (const r of await pending('alerts', 'id, priority, push, created_at, delivery')) {
        const push = (r['push'] ?? {}) as { title?: string; body?: string };
        const item: PushItem = {
          type: 'alert',
          id: String(r['id']),
          priority: r['priority'] as 'critical' | 'high' | 'normal' | 'digest',
          title: String(push.title ?? ''),
          body: String(push.body ?? ''),
          createdAt: String(r['created_at']),
        };
        out.push({ table: 'alerts', item, delivery: delivery(r) });
      }
      for (const r of await pending('system_alerts', 'id, event, headline, created_at, delivery')) {
        const item: PushItem = {
          type: 'system',
          id: String(r['id']),
          event: r['event'] as 'stale' | 'recovered' | 'mismatch',
          headline: String(r['headline']),
          createdAt: String(r['created_at']),
        };
        out.push({ table: 'system_alerts', item, delivery: delivery(r) });
      }
      for (const r of await pending('briefs', 'id, kind, title, push_body, created_at, delivery')) {
        const item: PushItem = {
          type: 'brief',
          id: String(r['id']),
          kind: String(r['kind']),
          title: String(r['title']),
          body: String(r['push_body']),
          createdAt: String(r['created_at']),
        };
        out.push({ table: 'briefs', item, delivery: delivery(r) });
      }
      return out.sort((a, b) => Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt));
    },
    async setPushDelivery(table, id, expect, next) {
      const { data, error } = await db
        .from(table)
        .update({ delivery: next })
        .eq('id', id)
        .eq('delivery->>push', expect)
        .select('id');
      if (error) throw new Error(`${table} delivery update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
    async getPushPublicKey() {
      const { data, error } = await db
        .from('user_settings')
        .select('push_public_key')
        .not('push_public_key', 'is', null)
        .limit(2);
      if (error) throw new Error(`user_settings read failed: ${error.message}`);
      const keys = [...new Set((data ?? []).map((r) => String(r['push_public_key'])))];
      if (keys.length > 1) throw new Error('More than one push public key is saved');
      return keys[0] ?? null;
    },
    async getPushDevices() {
      const { data, error } = await db
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth, device, failures')
        .is('disabled_at', null)
        .order('id');
      if (error) throw new Error(`push_subscriptions read failed: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: Number(r['id']),
        endpoint: String(r['endpoint']),
        p256dh: String(r['p256dh']),
        auth: String(r['auth']),
        device: String(r['device'] ?? ''),
        failures: Number(r['failures'] ?? 0),
      }));
    },
    async recordDeviceResult(id, r) {
      const patch = r.ok
        ? { last_ok_at: r.at, last_error: null, failures: 0 }
        : {
            last_error: r.error.slice(0, 300),
            failures: r.failures,
            ...(r.disabledAt ? { disabled_at: r.disabledAt } : {}),
          };
      const { error } = await db.from('push_subscriptions').update(patch).eq('id', id);
      if (error) throw new Error(`push_subscriptions update failed: ${error.message}`);
    },
  };
}

/** Email copies and the digest (ADR 0032), with the same once-only claim as push. */
export function supabaseEmailStore(url: string, secretKey: string): Omit<EmailStore, 'recordRun'> {
  const db = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pending = async (table: EmailTable, field: DeliveryField, cols: string): Promise<Row[]> => {
    const { data, error } = await db
      .from(table)
      .select(cols)
      .eq(`delivery->>${field}`, 'pending')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(`${table} pending ${field} read failed: ${error.message}`);
    return (data ?? []) as unknown as Row[];
  };
  const delivery = (r: Row) => (r['delivery'] ?? {}) as Record<string, string>;
  const alertText = (r: Row): StoredAlertText => ({
    id: String(r['id']),
    createdAt: String(r['created_at']),
    kind: String(r['kind']),
    priority: String(r['priority']),
    headline: String(r['headline']),
    card: (r['card'] ?? []) as CardSection[],
    reasons: (r['reasons'] ?? []) as string[],
  });
  const ALERT_COLS = 'id, created_at, kind, priority, headline, card, reasons, delivery';
  return {
    async getPendingEmail() {
      const out: PendingEmail[] = [];
      for (const r of await pending('alerts', 'email', ALERT_COLS))
        out.push({ table: 'alerts', alert: alertText(r), delivery: delivery(r) });
      for (const r of await pending(
        'system_alerts',
        'email',
        'id, created_at, event, source, headline, trigger, paused_rules, delivery',
      ))
        out.push({
          table: 'system_alerts',
          alert: {
            id: String(r['id']),
            createdAt: String(r['created_at']),
            event: r['event'] as 'stale' | 'recovered' | 'mismatch',
            source: String(r['source']),
            headline: String(r['headline']),
            trigger: String(r['trigger']),
            pausedRules: (r['paused_rules'] ?? []) as string[],
          },
          delivery: delivery(r),
        });
      return out.sort((a, b) => Date.parse(a.alert.createdAt) - Date.parse(b.alert.createdAt));
    },
    async getPendingDigest() {
      return (await pending('alerts', 'digest', ALERT_COLS)).map((r) => ({
        alert: alertText(r),
        delivery: delivery(r),
      }));
    },
    async setDelivery(table, id, field, expect, next) {
      const { data, error } = await db
        .from(table)
        .update({ delivery: next })
        .eq('id', id)
        .eq(`delivery->>${field}`, expect)
        .select('id');
      if (error) throw new Error(`${table} delivery update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
