import { describe, expect, it } from 'vitest';
import { linkErrorFromUrl, parseSignInInput } from './signInInput';

const LINK =
  'https://hwdwivilqdydmxhycapy.supabase.co/auth/v1/verify?token=4f2c1e9a8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a&type=magiclink&redirect_to=https://marsad-k84.netlify.app/';

describe('parseSignInInput', () => {
  it('accepts a 6-digit code, trimming spaces', () => {
    expect(parseSignInInput(' 123456 ')).toEqual({ kind: 'code', token: '123456' });
  });

  it('accepts the whole sign-in link and keeps the token hash and type', () => {
    expect(parseSignInInput(LINK)).toEqual({
      kind: 'link',
      tokenHash: '4f2c1e9a8b7d6c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a',
      type: 'magiclink',
    });
  });

  it('accepts a link with a PKCE-prefixed token and type email', () => {
    const r = parseSignInInput(
      'https://abc.supabase.co/auth/v1/verify?token=pkce_abc123&type=email&redirect_to=x',
    );
    expect(r).toEqual({ kind: 'link', tokenHash: 'pkce_abc123', type: 'email' });
  });

  it('rejects links that are not Supabase Auth verify links', () => {
    expect(
      parseSignInInput('https://evil.example.com/auth/v1/verify?token=abc&type=magiclink'),
    ).toEqual({ kind: 'invalid' });
    expect(
      parseSignInInput('http://abc.supabase.co/auth/v1/verify?token=abc&type=magiclink'),
    ).toEqual({ kind: 'invalid' });
  });

  it('rejects other link types, missing tokens, short codes and text', () => {
    expect(
      parseSignInInput('https://abc.supabase.co/auth/v1/verify?token=abc&type=recovery'),
    ).toEqual({ kind: 'invalid' });
    expect(parseSignInInput('https://abc.supabase.co/auth/v1/verify?type=magiclink')).toEqual({
      kind: 'invalid',
    });
    expect(parseSignInInput('12345')).toEqual({ kind: 'invalid' });
    expect(parseSignInInput('Sign in')).toEqual({ kind: 'invalid' });
  });
});

describe('linkErrorFromUrl', () => {
  it('reads the description from the fragment (implicit flow)', () => {
    expect(
      linkErrorFromUrl(
        'https://marsad-k84.netlify.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toBe('Email link is invalid or has expired');
  });

  it('reads the query string too, and falls back to the code', () => {
    expect(linkErrorFromUrl('https://x.app/?error=access_denied&error_code=otp_expired')).toBe(
      'otp_expired',
    );
  });

  it('returns null for a normal address', () => {
    expect(linkErrorFromUrl('https://marsad-k84.netlify.app/regime')).toBeNull();
  });
});
