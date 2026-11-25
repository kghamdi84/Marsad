/** Choosing the one account whose password the Set password workflow sets (ADR 0039). Pure, so it is tested. */
export const MIN_PASSWORD_LENGTH = 10;

export function checkPassword(p: string): string | null {
  if (p.length < MIN_PASSWORD_LENGTH)
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (p.trim() !== p) return 'The password must not start or end with a space.';
  return null;
}

/** The single account with this email; refuses none or several rather than guessing. */
export function pickAccount(
  users: readonly { id: string; email?: string | null }[],
  email: string,
): { id: string } | { error: string } {
  const want = email.trim().toLowerCase();
  const hits = users.filter((u) => (u.email ?? '').trim().toLowerCase() === want);
  if (hits.length === 0) return { error: 'No Marsad account has the email in BRIEF_EMAIL_TO.' };
  if (hits.length > 1) return { error: 'More than one account has that email; nothing changed.' };
  return { id: (hits[0] as { id: string }).id };
}
