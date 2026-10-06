import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * env.ts parses process.env once at module load, so each test resets the
 * module registry before stubbing a fresh key and re-importing — otherwise
 * every test after the first would silently reuse whichever key happened
 * to be parsed first.
 */

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function freshModule(encryptionKey: string | undefined) {
  if (encryptionKey === undefined) {
    vi.stubEnv('APPLE_REFRESH_TOKEN_ENCRYPTION_KEY', '');
  } else {
    vi.stubEnv('APPLE_REFRESH_TOKEN_ENCRYPTION_KEY', encryptionKey);
  }
  return import('../../src/crypto/appleCredentialEncryption.js');
}

describe('Apple credential encryption (AES-256-GCM)', () => {
  it('round-trips a refresh token through encrypt/decrypt', async () => {
    const { encryptAppleRefreshToken, decryptAppleRefreshToken } = await freshModule(crypto.randomBytes(32).toString('base64'));

    const encrypted = encryptAppleRefreshToken('a-real-apple-refresh-token');

    expect(decryptAppleRefreshToken(encrypted)).toBe('a-real-apple-refresh-token');
  });

  it('never stores the plaintext token in the ciphertext field', async () => {
    const { encryptAppleRefreshToken } = await freshModule(crypto.randomBytes(32).toString('base64'));

    const encrypted = encryptAppleRefreshToken('a-real-apple-refresh-token');

    expect(encrypted.ciphertext).not.toContain('a-real-apple-refresh-token');
    expect(JSON.stringify(encrypted)).not.toContain('a-real-apple-refresh-token');
  });

  it('two encryptions of the same token produce different ciphertext (random IV, never reused)', async () => {
    const { encryptAppleRefreshToken } = await freshModule(crypto.randomBytes(32).toString('base64'));

    const first = encryptAppleRefreshToken('same-token');
    const second = encryptAppleRefreshToken('same-token');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('a tampered authTag fails to decrypt (authenticated encryption, not just confidentiality)', async () => {
    const { encryptAppleRefreshToken, decryptAppleRefreshToken } = await freshModule(crypto.randomBytes(32).toString('base64'));

    const encrypted = encryptAppleRefreshToken('a-real-apple-refresh-token');
    const tampered = { ...encrypted, authTag: Buffer.from('0'.repeat(16)).toString('base64') };

    expect(() => decryptAppleRefreshToken(tampered)).toThrow();
  });

  it('throws a clear configuration error when the encryption key is not set', async () => {
    const { encryptAppleRefreshToken } = await freshModule(undefined);

    expect(() => encryptAppleRefreshToken('x')).toThrow(/APPLE_REFRESH_TOKEN_ENCRYPTION_KEY/);
  });

  it('throws a clear configuration error when the key is not exactly 32 bytes', async () => {
    const { encryptAppleRefreshToken } = await freshModule(Buffer.from('too-short').toString('base64'));

    expect(() => encryptAppleRefreshToken('x')).toThrow(/32 bytes/);
  });
});
