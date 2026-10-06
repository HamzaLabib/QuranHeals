import crypto from 'node:crypto';

import { requireAppleRefreshTokenEncryptionKey } from '../config/env';

/**
 * Encrypts/decrypts an Apple refresh token at rest (see
 * types/accountDomain.ts's AppleCredentialEntity). Standard AES-256-GCM via
 * Node's built-in crypto module — authenticated encryption, no custom
 * cryptographic design — keyed by APPLE_REFRESH_TOKEN_ENCRYPTION_KEY, a
 * server-only secret that never leaves this backend. This is a plaintext
 * backend-held secret (unlike reflections, which this backend can never
 * decrypt — see docs/reflection-privacy.md), because account deletion must
 * actually present the token to Apple's revoke endpoint; "at rest" here
 * means "not plaintext in the database," not "zero-knowledge."
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export type EncryptedAppleCredential = { ciphertext: string; iv: string; authTag: string };

export function encryptAppleRefreshToken(refreshToken: string): EncryptedAppleCredential {
  const key = requireAppleRefreshTokenEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptAppleRefreshToken(encrypted: EncryptedAppleCredential): string {
  const key = requireAppleRefreshTokenEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
