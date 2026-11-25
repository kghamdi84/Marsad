export type Gate =
  'config-missing' | 'loading' | 'signed-out' | 'mfa-enroll' | 'mfa-verify' | 'ready';

export type Aal = 'aal1' | 'aal2' | null;

export interface GateInput {
  configured: boolean;
  loading: boolean;
  hasSession: boolean;
  currentLevel: Aal;
  nextLevel: Aal;
  /** False while password-only sign-in is allowed (ADR 0039); the database enforces the same switch. */
  requireMfa: boolean;
}

/**
 * Decides which screen to show. With requireMfa, a session below aal2 never reaches the app and a user with no
 * verified factor (nextLevel aal1) enrolls. Without it, any signed-in session opens the app.
 */
export function gateFor(s: GateInput): Gate {
  if (!s.configured) return 'config-missing';
  if (s.loading) return 'loading';
  if (!s.hasSession) return 'signed-out';
  if (s.currentLevel === 'aal2' || !s.requireMfa) return 'ready';
  if (s.nextLevel === 'aal2') return 'mfa-verify';
  return 'mfa-enroll';
}
