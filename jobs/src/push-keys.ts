import { createECDH } from 'node:crypto';

/**
 * The uncompressed P-256 public key (base64url, 87 characters) for a VAPID private key given as the 32-byte
 * scalar in base64url, the form the Status page shows. Throws on anything else, without echoing the input.
 */
export function vapidPublicKeyFor(privateKey: string): string {
  const d = Buffer.from(privateKey.trim(), 'base64url');
  if (d.length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(privateKey.trim()))
    throw new Error('VAPID_PRIVATE_KEY is not a 32-byte base64url key');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  return ecdh.getPublicKey('base64url', 'uncompressed');
}
