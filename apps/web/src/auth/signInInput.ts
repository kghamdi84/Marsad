/**
 * What the sign-in field accepts: the 6-digit code (when Supabase's email carries one) or the whole
 * sign-in link copied from the email. The link's `token` is the one-time token hash, which
 * `verifyOtp({ token_hash, type })` accepts in any browser (ADR 0005).
 */
export type SignInInput =
  | { kind: 'code'; token: string }
  | { kind: 'link'; tokenHash: string; type: 'magiclink' | 'email' }
  | { kind: 'invalid' };

const LINK_TYPES = new Set(['magiclink', 'email']);

function param(text: string, name: string): string | null {
  const m = new RegExp(`[?&#]${name}=([^&#\\s]+)`).exec(text);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export function parseSignInInput(raw: string): SignInInput {
  const s = raw.trim();
  if (/^\d{6,10}$/.test(s)) return { kind: 'code', token: s };
  // Only Supabase Auth's own verify link: https://<project>.supabase.co/auth/v1/verify?token=...&type=...
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1\/verify\?/i.test(s))
    return { kind: 'invalid' };
  const tokenHash = param(s, 'token');
  const type = param(s, 'type') ?? 'magiclink';
  if (!tokenHash || !LINK_TYPES.has(type)) return { kind: 'invalid' };
  return { kind: 'link', tokenHash, type: type as 'magiclink' | 'email' };
}

/** The error Supabase puts in the address bar when an opened sign-in link fails (query or fragment). */
export function linkErrorFromUrl(href: string): string | null {
  const desc = param(href, 'error_description');
  if (desc) return desc.replace(/\+/g, ' ');
  return param(href, 'error_code');
}
