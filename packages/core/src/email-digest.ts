/**
 * Email copies of critical alerts and the alert digest (digest-1, ADR 0032). Pure text builders: the job reads stored
 * alerts and sends through the transactional email API. Every alert keeps its stored card text unchanged, so the
 * email says exactly what the app shows; times are given in ET and UTC.
 */
import { clip } from './briefs.js';
import type { CardSection } from './alerts.js';

export const DIGEST_VERSION = 'digest-1';

/** An email copy is still worth sending up to this age; later it is recorded as expired. */
export const EMAIL_COPY_MAX_AGE_SECONDS = 24 * 3600;
/** A digest collects alerts up to this age; older ones are recorded as expired, never mailed as news. */
export const DIGEST_MAX_AGE_SECONDS = 48 * 3600;
/** Most alerts listed in full in one digest; the rest are counted and named by headline. */
export const DIGEST_MAX_FULL = 20;

export interface StoredAlertText {
  id: string;
  createdAt: string;
  kind: string;
  priority: string;
  headline: string;
  card: readonly CardSection[];
  /** Why the pipeline held it for the digest (its reasons). */
  reasons?: readonly string[];
}

export interface SystemAlertText {
  id: string;
  createdAt: string;
  event: 'stale' | 'recovered' | 'mismatch';
  source: string;
  headline: string;
  trigger: string;
  pausedRules: readonly string[];
}

const SITE = 'https://marsad-k84.netlify.app';

const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const et = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
const when = (iso: string) => `${et(iso)} ET (${utc(iso)})`;

function cardText(card: readonly CardSection[]): string {
  return card.map((s) => [s.heading, ...s.lines.map((l) => `  ${l}`)].join('\n')).join('\n');
}

function lateLine(createdAt: string, now: Date): string | null {
  const minutes = Math.floor((now.getTime() - Date.parse(createdAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 10) return null;
  const lag = minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
  return `Sent ${lag} after the alert.`;
}

/** The email copy of one critical alert: subject from the header, body the full stored card. */
export function criticalAlertEmail(
  a: StoredAlertText,
  now: Date,
): { subject: string; text: string } {
  const late = lateLine(a.createdAt, now);
  return {
    subject: clip(`Marsad critical: ${a.headline}`, 120),
    text: [
      `Critical alert, ${when(a.createdAt)}.`,
      ...(late ? [late] : []),
      '',
      cardText(a.card),
      '',
      `Open the card: ${SITE}/alerts#alert-${a.id}`,
      'Marsad never places orders; every decision is yours.',
    ].join('\n'),
  };
}

const SYSTEM_SUBJECT: Record<SystemAlertText['event'], string> = {
  stale: 'feed stale',
  recovered: 'feed recovered',
  mismatch: 'sources disagree',
};

export function systemAlertEmail(s: SystemAlertText, now: Date): { subject: string; text: string } {
  const late = lateLine(s.createdAt, now);
  return {
    subject: clip(`Marsad system: ${SYSTEM_SUBJECT[s.event]}, ${s.source}`, 120),
    text: [
      `System alert, ${when(s.createdAt)}.`,
      ...(late ? [late] : []),
      '',
      s.headline,
      s.trigger,
      s.pausedRules.length > 0 ? `Paused rules: ${s.pausedRules.join(', ')}.` : 'No rules paused.',
      '',
      `Status page: ${SITE}/status`,
    ].join('\n'),
  };
}

/**
 * One digest email for alerts the pipeline held back (quiet hours, the daily push cap, digest priority, event
 * risk), oldest first. Each is listed with why it was held and its full card, up to DIGEST_MAX_FULL; the rest are
 * named by headline so nothing is silently dropped.
 */
export function digestEmail(
  alerts: readonly StoredAlertText[],
  now: Date,
): { subject: string; text: string } | null {
  if (alerts.length === 0) return null;
  const sorted = [...alerts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const full = sorted.slice(0, DIGEST_MAX_FULL);
  const rest = sorted.slice(DIGEST_MAX_FULL);
  const n = sorted.length;
  const held = (a: StoredAlertText) => {
    const r = (a.reasons ?? []).filter((x) => /digest|quiet|cap|event risk/i.test(x));
    return r.length > 0 ? `Held: ${r.join('; ')}.` : 'Held for the digest.';
  };
  return {
    subject: `Marsad digest: ${n} alert${n === 1 ? '' : 's'} held, ${utc(now.toISOString()).slice(0, 10)}`,
    text: [
      `${n} alert${n === 1 ? '' : 's'} held back from push since the last digest, oldest first.`,
      '',
      ...full.flatMap((a, i) => [
        `${i + 1}. ${a.headline} (${a.kind}, ${a.priority}), ${when(a.createdAt)}`,
        held(a),
        cardText(a.card),
        `Card: ${SITE}/alerts#alert-${a.id}`,
        '',
      ]),
      ...(rest.length > 0
        ? [
            `${rest.length} more, listed by headline (full cards on the Alerts page):`,
            ...rest.map((a) => `- ${a.headline}, ${when(a.createdAt)}`),
            '',
          ]
        : []),
      'Marsad never places orders; every decision is yours.',
    ].join('\n'),
  };
}
