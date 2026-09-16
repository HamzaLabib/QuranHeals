import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KDF_ITERATIONS,
  decryptReflectionText,
  encryptReflectionText,
  generateMasterKey,
  MASTER_KEY_LENGTH_BYTES,
  NONCE_LENGTH_BYTES,
  unwrapMasterKey,
  wrapMasterKey,
  type RandomBytesFn,
} from '@/crypto/reflectionEncryption';

// Tests inject Node's own CSPRNG instead of expo-crypto (an RN-only native
// module) — see mobile/src/crypto/randomBytes.ts's doc comment.
const testRandomBytes: RandomBytesFn = (length) => new Uint8Array(nodeRandomBytes(length));

// A low iteration count keeps these tests fast; production uses
// DEFAULT_KDF_ITERATIONS (210,000) — see reflectionEncryption.ts.
const FAST_ITERATIONS = 100;

describe('encryptReflectionText / decryptReflectionText (reflection AEAD)', () => {
  it('round-trips plaintext, including Arabic text', async () => {
    const key = generateMasterKey(testRandomBytes);
    const plaintext = 'This ayah gave me peace. هذه الآية منحتني السكينة.';

    const encrypted = encryptReflectionText(plaintext, key, testRandomBytes);
    expect(decryptReflectionText(encrypted, key)).toBe(plaintext);
  });

  it('never returns the plaintext readably inside the ciphertext/nonce fields', () => {
    const key = generateMasterKey(testRandomBytes);
    const plaintext = 'a very identifiable secret string';
    const encrypted = encryptReflectionText(plaintext, key, testRandomBytes);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(encrypted.nonce).not.toContain(plaintext);
  });

  it('produces a unique nonce for every encryption, even for identical plaintext/key', () => {
    const key = generateMasterKey(testRandomBytes);
    const a = encryptReflectionText('same text', key, testRandomBytes);
    const b = encryptReflectionText('same text', key, testRandomBytes);

    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('the wrong key cannot decrypt', () => {
    const key = generateMasterKey(testRandomBytes);
    const wrongKey = generateMasterKey(testRandomBytes);
    const encrypted = encryptReflectionText('secret', key, testRandomBytes);

    expect(() => decryptReflectionText(encrypted, wrongKey)).toThrow();
  });

  it('tampered ciphertext fails authentication instead of decrypting into garbage', () => {
    const key = generateMasterKey(testRandomBytes);
    const encrypted = encryptReflectionText('secret', key, testRandomBytes);
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA' };

    expect(() => decryptReflectionText(tampered, key)).toThrow();
  });

  it('a tampered nonce also fails authentication', () => {
    const key = generateMasterKey(testRandomBytes);
    const encrypted = encryptReflectionText('secret', key, testRandomBytes);
    const tampered = { ...encrypted, nonce: encrypted.nonce.slice(0, -4) + 'AAAA' };

    expect(() => decryptReflectionText(tampered, key)).toThrow();
  });

  it('rejects an unsupported encryption format version', () => {
    const key = generateMasterKey(testRandomBytes);
    const encrypted = encryptReflectionText('secret', key, testRandomBytes);

    expect(() => decryptReflectionText({ ...encrypted, encryptionVersion: 99 }, key)).toThrow(/version/i);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encryptReflectionText('x', new Uint8Array(16), testRandomBytes)).toThrow();
  });

  it('generateMasterKey and nonces have the expected lengths', () => {
    const key = generateMasterKey(testRandomBytes);
    expect(key).toHaveLength(MASTER_KEY_LENGTH_BYTES);
    const encrypted = encryptReflectionText('x', key, testRandomBytes);
    expect(encrypted.nonce.length).toBeGreaterThan(0);
    // base64 of NONCE_LENGTH_BYTES bytes decodes back to that many bytes.
    expect(NONCE_LENGTH_BYTES).toBe(24);
  });
});

describe('wrapMasterKey / unwrapMasterKey (cross-device key recovery via Sync Passphrase)', () => {
  it('round-trips the master key through wrap/unwrap with the correct passphrase', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const wrapped = await wrapMasterKey(masterKey, 'correct horse battery staple', testRandomBytes, FAST_ITERATIONS);
    const unwrapped = await unwrapMasterKey(wrapped, 'correct horse battery staple');

    expect(Buffer.from(unwrapped).equals(Buffer.from(masterKey))).toBe(true);
  });

  it('an incorrect passphrase cannot unwrap the key', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const wrapped = await wrapMasterKey(masterKey, 'right passphrase', testRandomBytes, FAST_ITERATIONS);

    await expect(unwrapMasterKey(wrapped, 'wrong passphrase')).rejects.toThrow();
  });

  it('a tampered wrapped-key blob fails to unwrap even with the correct passphrase', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const wrapped = await wrapMasterKey(masterKey, 'passphrase', testRandomBytes, FAST_ITERATIONS);
    const tampered = { ...wrapped, wrappedKey: wrapped.wrappedKey.slice(0, -4) + 'AAAA' };

    await expect(unwrapMasterKey(tampered, 'passphrase')).rejects.toThrow();
  });

  it('the backend never needs to see the master key: wrapping only ever produces ciphertext + salt + iteration count', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const wrapped = await wrapMasterKey(masterKey, 'a passphrase only the user knows', testRandomBytes, FAST_ITERATIONS);

    expect(Object.keys(wrapped).sort()).toEqual(
      ['encryptionVersion', 'kdfIterations', 'nonce', 'salt', 'wrappedKey'].sort(),
    );
    expect(wrapped.wrappedKey).not.toContain('a passphrase only the user knows');
  });

  it('the same passphrase with a different salt derives a different wrapping key (unique wrap per setup)', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const first = await wrapMasterKey(masterKey, 'same passphrase', testRandomBytes, FAST_ITERATIONS);
    const second = await wrapMasterKey(masterKey, 'same passphrase', testRandomBytes, FAST_ITERATIONS);

    expect(first.salt).not.toBe(second.salt);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
  });

  it('rejects an unsupported sync-key encryption format version', async () => {
    const masterKey = generateMasterKey(testRandomBytes);
    const wrapped = await wrapMasterKey(masterKey, 'passphrase', testRandomBytes, FAST_ITERATIONS);

    await expect(unwrapMasterKey({ ...wrapped, encryptionVersion: 99 }, 'passphrase')).rejects.toThrow(/version/i);
  });

  it('production default iteration count meets the OWASP PBKDF2-HMAC-SHA256 minimum', () => {
    expect(DEFAULT_KDF_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });
});
