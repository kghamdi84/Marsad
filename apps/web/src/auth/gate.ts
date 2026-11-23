export type Gate =
  'config-missing' | 'loading' | 'signed-out' | 'mfa-enroll' | 'mfa-verify' | 'ready';

export type Aal = 'aal1' | 'aal2' | null;

export interface GateInput {
  configured: boolean;
  loading: boolean;
  hasSession: boolean;
  currentLevel: Aal;
  nextLevel: Aal;
}

/**
 * Decides which screen to show. MFA is mandatory: a session below aal2 never
 * reaches the app. With no verified factor (nextLevel aal1) the user enrolls.
 */
export function gateFor(s: GateInput): Gate {
  if (!s.configured) return 'config-missing';
  if (s.loading) return 'loading';
  if (!s.hasSession) return 'signed-out';
  if (s.currentLevel === 'aal2') return 'ready';
  if (s.nextLevel === 'aal2') return 'mfa-verify';
  return 'mfa-enroll';
}
