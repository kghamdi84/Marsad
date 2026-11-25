/** Choosing the one account whose password the Set password workflow sets (ADR 0039). Pure, so it is tested. */
export const MIN_PASSWORD_LENGTH = 10;

export function checkPassword(p: string): string | null {
  if (p.length < MIN_PASSWORD_LENGTH)
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (p.trim() !== p) return 'The password must not start or end with a space.';
  return null;
}

/**
 * The account to change. Sign-ups are closed, so a project with exactly one account means that account,
 * whatever its email. With several accounts, only the one whose email matches; none or several matches change
 * nothing rather than guess.
 */
export function pickAccount(
  users: readonly { id: string; email?: string | null }[],
  email: string | null,
): { id: string } | { error: string } {
  if (users.length === 1) return { id: (users[0] as { id: string }).id };
  if (users.length === 0) return { error: 'The project has no account.' };
  if (!email) return { error: 'Several accounts exist and no email was given; nothing changed.' };
  const want = email.trim().toLowerCase();
  const hits = users.filter((u) => (u.email ?? '').trim().toLowerCase() === want);
  if (hits.length === 0) return { error: 'Several accounts exist and none has the given email.' };
  if (hits.length > 1) return { error: 'More than one account has that email; nothing changed.' };
  return { id: (hits[0] as { id: string }).id };
}
