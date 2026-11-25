import { describe, expect, it } from 'vitest';
import { checkPassword, pickAccount } from './set-password.js';

describe('set password (ADR 0039)', () => {
  it('accepts a password of 10 or more characters and refuses shorter ones or outer spaces', () => {
    expect(checkPassword('0123456789')).toBeNull();
    expect(checkPassword('012345678')).toMatch(/at least 10/);
    expect(checkPassword(' 0123456789')).toMatch(/space/);
  });

  it('picks the one account with the email, ignoring case and spaces', () => {
    const users = [
      { id: 'a', email: 'Owner@Example.com' },
      { id: 'b', email: 'other@example.com' },
    ];
    expect(pickAccount(users, ' owner@example.com ')).toEqual({ id: 'a' });
  });

  it('changes nothing when no account or several accounts match', () => {
    expect(pickAccount([{ id: 'b', email: 'other@example.com' }], 'owner@example.com')).toEqual({
      error: expect.stringMatching(/No Marsad account/) as unknown,
    });
    const twice = [
      { id: 'a', email: 'owner@example.com' },
      { id: 'c', email: 'OWNER@example.com' },
    ];
    expect(pickAccount(twice, 'owner@example.com')).toEqual({
      error: expect.stringMatching(/More than one/) as unknown,
    });
  });
});
