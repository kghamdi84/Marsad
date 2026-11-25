import { describe, expect, it } from 'vitest';
import { gateFor, type GateInput } from './gate.js';

const base: GateInput = {
  configured: true,
  loading: false,
  hasSession: true,
  currentLevel: 'aal1',
  nextLevel: 'aal1',
  requireMfa: true,
};

describe('gateFor', () => {
  it('reports missing configuration first', () => {
    expect(gateFor({ ...base, configured: false })).toBe('config-missing');
  });
  it('waits while loading', () => {
    expect(gateFor({ ...base, loading: true })).toBe('loading');
  });
  it('asks for sign-in without a session', () => {
    expect(gateFor({ ...base, hasSession: false })).toBe('signed-out');
  });
  it('forces enrollment when no factor exists', () => {
    expect(gateFor(base)).toBe('mfa-enroll');
  });
  it('asks for the TOTP code when a factor exists', () => {
    expect(gateFor({ ...base, nextLevel: 'aal2' })).toBe('mfa-verify');
  });
  it('opens the app only at aal2', () => {
    expect(gateFor({ ...base, currentLevel: 'aal2', nextLevel: 'aal2' })).toBe('ready');
  });
  it('never opens the app for an email-code-only session', () => {
    for (const nextLevel of ['aal1', 'aal2', null] as const) {
      expect(gateFor({ ...base, currentLevel: 'aal1', nextLevel })).not.toBe('ready');
    }
  });
  it('in password mode opens the app for any signed-in session, with or without a factor (ADR 0039)', () => {
    for (const nextLevel of ['aal1', 'aal2', null] as const) {
      expect(gateFor({ ...base, requireMfa: false, currentLevel: 'aal1', nextLevel })).toBe(
        'ready',
      );
    }
    expect(gateFor({ ...base, requireMfa: false, hasSession: false })).toBe('signed-out');
  });
});
