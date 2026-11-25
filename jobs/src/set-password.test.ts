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

  it('uses the only account when the project has one, whatever its email (sign-ups are closed)', () => {
    expect(pickAccount([{ id: 'b', email: 'someone@yahoo.com' }], 'owner@gmail.com')).toEqual({
      id: 'b',
    });
    expect(pickAccount([{ id: 'b', email: 'someone@yahoo.com' }], null)).toEqual({ id: 'b' });
  });

  it('changes nothing when there is no account, or several and none or several match', () => {
    expect(pickAccount([], 'owner@example.com')).toEqual({
      error: expect.stringMatching(/no account/) as unknown,
    });
    const two = [
      { id: 'a', email: 'x@example.com' },
      { id: 'b', email: 'y@example.com' },
    ];
    expect(pickAccount(two, 'owner@example.com')).toEqual({
      error: expect.stringMatching(/none has/) as unknown,
    });
    expect(pickAccount(two, null)).toEqual({
      error: expect.stringMatching(/no email/) as unknown,
    });
    const twice = [
      { id: 'a', email: 'owner@example.com' },
      { id: 'c', email: 'OWNER@example.com' },
      { id: 'd', email: 'z@example.com' },
    ];
    expect(pickAccount(twice, 'owner@example.com')).toEqual({
      error: expect.stringMatching(/More than one/) as unknown,
    });
  });
});
