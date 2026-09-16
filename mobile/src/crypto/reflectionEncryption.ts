import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { decodeBase64, encodeBase64 } from './base64';

/**
 * Client-side authenticated encryption for خواطر (reflections) — see Part D.
 * Everything here is a maintained, audited primitive (@noble/ciphers'
 * XChaCha20-Poly1305 AEAD, @noble/hashes' PBKDF2-HMAC-SHA256), never
 * hand-rolled cryptography. This module never touches the network or
 * storage directly — see mobile/src/sync/reflectionsSync.ts and
 * mobile/src/sync/syncKeyManager.ts for how it's wired to sync.
 *
 * Key model (full design: docs/reflection-privacy.md):
 *  - Each account has one random 32-byte reflection master key, generated
 *    on-device the first time any device turns sync on.
 *  - Reflections are encrypted with that master key (encryptReflectionText).
 *  - The master key itself is never uploaded in the clear. It is "wrapped"
 *    (encrypted) under a key derived from a separate Sync Passphrase the
 *    user sets — wrapMasterKey — and only the wrapped blob + KDF salt/
 *    iteration count are uploaded (UserSyncKey on the backend).
 *  - A second device downloads the wrapped blob, the user re-enters the
 *    same Sync Passphrase, and unwrapMasterKey recovers the master key
 *    locally. The backend never sees the passphrase or the unwrapped key.
 *  - Losing the Sync Passphrase with no device that still has the unwrapped
 *    key means the reflections are unrecoverable — the same trade-off true
 *    end-to-end encryption always has. This is documented, not hidden.
 */

export const ENCRYPTION_VERSION = 1;
export const MASTER_KEY_LENGTH_BYTES = 32;
export const NONCE_LENGTH_BYTES = 24; // XChaCha20's extended nonce.
export const SALT_LENGTH_BYTES = 16;

// OWASP's 2023 minimum recommendation for PBKDF2-HMAC-SHA256. Only paid
// once per device per sign-in (to unwrap the master key), not per
// reflection save, so this cost is acceptable.
export const DEFAULT_KDF_ITERATIONS = 210_000;

/** Real randomness always comes from mobile/src/crypto/randomBytes.ts (expo-crypto); tests inject Node's crypto.randomBytes. Never a Math.random()-backed source. */
export type RandomBytesFn = (length: number) => Uint8Array;

export type EncryptedPayload = {
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
};

export type WrappedMasterKey = {
  wrappedKey: string;
  nonce: string;
  salt: string;
  kdfIterations: number;
  encryptionVersion: number;
};

function assertKeyLength(key: Uint8Array) {
  if (key.length !== MASTER_KEY_LENGTH_BYTES) {
    throw new Error(`Encryption key must be ${MASTER_KEY_LENGTH_BYTES} bytes.`);
  }
}

export function generateMasterKey(randomBytes: RandomBytesFn): Uint8Array {
  return randomBytes(MASTER_KEY_LENGTH_BYTES);
}

export async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_KDF_ITERATIONS,
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, passphrase.normalize('NFKC'), salt, { c: iterations, dkLen: MASTER_KEY_LENGTH_BYTES });
}

/** Encrypts one reflection's plaintext with the account's reflection master key. A fresh random nonce is generated for every call — nonces are never reused. */
export function encryptReflectionText(plaintext: string, masterKey: Uint8Array, randomBytes: RandomBytesFn): EncryptedPayload {
  assertKeyLength(masterKey);
  const nonce = randomBytes(NONCE_LENGTH_BYTES);
  const cipher = xchacha20poly1305(masterKey, nonce);
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext));

  return { ciphertext: encodeBase64(ciphertext), nonce: encodeBase64(nonce), encryptionVersion: ENCRYPTION_VERSION };
}

/** Decrypts one reflection. Throws if the key is wrong or the ciphertext/nonce has been tampered with — the Poly1305 tag makes forged/corrupted ciphertext fail loudly rather than decrypt into garbage. */
export function decryptReflectionText(payload: EncryptedPayload, masterKey: Uint8Array): string {
  if (payload.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported reflection encryption version: ${payload.encryptionVersion}`);
  }
  assertKeyLength(masterKey);

  const cipher = xchacha20poly1305(masterKey, decodeBase64(payload.nonce));
  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = cipher.decrypt(decodeBase64(payload.ciphertext));
  } catch {
    throw new Error('This reflection could not be decrypted (wrong key, or the data was corrupted or tampered with).');
  }

  return new TextDecoder().decode(plaintextBytes);
}

/** Wraps (encrypts) the reflection master key under a key derived from the user's Sync Passphrase — this is the only form of the master key ever uploaded. */
export async function wrapMasterKey(
  masterKey: Uint8Array,
  passphrase: string,
  randomBytes: RandomBytesFn,
  iterations: number = DEFAULT_KDF_ITERATIONS,
): Promise<WrappedMasterKey> {
  assertKeyLength(masterKey);
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const passphraseKey = await derivePassphraseKey(passphrase, salt, iterations);
  const nonce = randomBytes(NONCE_LENGTH_BYTES);
  const cipher = xchacha20poly1305(passphraseKey, nonce);
  const wrapped = cipher.encrypt(masterKey);

  return {
    wrappedKey: encodeBase64(wrapped),
    nonce: encodeBase64(nonce),
    salt: encodeBase64(salt),
    kdfIterations: iterations,
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

/** Recovers the reflection master key on a (new) device from the wrapped blob and the user's re-entered Sync Passphrase. Throws on a wrong passphrase or corrupted blob. */
export async function unwrapMasterKey(wrapped: WrappedMasterKey, passphrase: string): Promise<Uint8Array> {
  if (wrapped.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported sync key encryption version: ${wrapped.encryptionVersion}`);
  }

  const salt = decodeBase64(wrapped.salt);
  const passphraseKey = await derivePassphraseKey(passphrase, salt, wrapped.kdfIterations);
  const cipher = xchacha20poly1305(passphraseKey, decodeBase64(wrapped.nonce));

  try {
    return cipher.decrypt(decodeBase64(wrapped.wrappedKey));
  } catch {
    throw new Error('Incorrect sync passphrase, or the sync key data was corrupted.');
  }
}
