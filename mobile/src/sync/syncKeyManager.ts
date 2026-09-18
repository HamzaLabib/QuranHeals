import { clearCachedMasterKey, getCachedMasterKey, setCachedMasterKey } from '@/auth/sessionStorage';
import { decodeBase64, encodeBase64 } from '@/crypto/base64';
import { generateMasterKey, unwrapMasterKey, wrapMasterKey, type WrappedMasterKey } from '@/crypto/reflectionEncryption';
import { getRandomBytes } from '@/crypto/randomBytes';
import { getCloudSyncKey, putCloudSyncKey, replaceCloudSyncKey } from './syncApi';
import { passwordLengthError } from '@/utils/syncPasswordValidation';

export type SyncPassphraseMode = 'create' | 'unlock';

/** Supplied by the UI (SyncPassphraseSheet) — resolves with the passphrase the user entered, or rejects/never-resolves-then-rejects if they cancel. */
export type VerifyPassphrase = (value: string) => Promise<boolean>;
export type PassphrasePrompt = (mode: SyncPassphraseMode, verify?: VerifyPassphrase) => Promise<string>;

export async function verifySyncPassphrase(key: WrappedMasterKey, value: string): Promise<boolean> {
  try {
    const masterKey = await unwrapMasterKey(key, value);
    masterKey.fill(0);
    return true;
  } catch {
    return false;
  }
}

export class SyncPassphraseCancelledError extends Error {}

/**
 * Recovers (or, on the very first device to turn sync on, creates) the
 * account's reflection master key. See docs/reflection-privacy.md for the
 * full design; in short: the master key is cached on-device after the
 * first successful unlock (SecureStore), so the passphrase is only asked
 * for once per device, not on every app open — losing the passphrase with
 * no device still holding the cached key means reflections cannot be
 * recovered, which is disclosed to the user, not hidden.
 */
export async function ensureReflectionMasterKey(
  sessionToken: string,
  promptForPassphrase: PassphrasePrompt,
): Promise<Uint8Array> {
  const cached = await getCachedMasterKey();
  if (cached) {
    return decodeBase64(cached);
  }

  const cloudKey = await getCloudSyncKey(sessionToken);

  if (cloudKey) {
    const passphrase = await promptForPassphrase('unlock', (value) => verifySyncPassphrase(cloudKey, value));
    const masterKey = await unwrapMasterKey(cloudKey, passphrase);
    await setCachedMasterKey(encodeBase64(masterKey));
    return masterKey;
  }

  const passphrase = await promptForPassphrase('create');
  if (passwordLengthError(passphrase)) throw new Error('Invalid new sync password length.');
  const masterKey = generateMasterKey(getRandomBytes);
  const wrapped = await wrapMasterKey(masterKey, passphrase, getRandomBytes);
  await putCloudSyncKey(sessionToken, wrapped);
  await setCachedMasterKey(encodeBase64(masterKey));
  return masterKey;
}

/** Envelope encryption: re-encrypt the existing master key, keeping every
 * reflection, conflict and offline device on the same data key. Never write
 * plaintext or change the cache/session. The server replaces the entire
 * wrapper atomically only if the original still matches. */
export async function changeSyncPassword(sessionToken: string, current: string, next: string): Promise<void> {
  if (passwordLengthError(next) || current === next) throw new Error('Invalid new sync password.');
  const previous = await getCloudSyncKey(sessionToken);
  if (!previous) throw new Error('No sync key exists.');
  const masterKey = await unwrapMasterKey(previous, current);
  try {
    const replacement = await wrapMasterKey(masterKey, next, getRandomBytes);
    const check = await unwrapMasterKey(replacement, next);
    try {
      if (!check.every((byte, index) => byte === masterKey[index])) throw new Error('Key verification failed.');
    } finally {
      check.fill(0);
    }
    try {
      await replaceCloudSyncKey(sessionToken, previous, replacement);
    } catch (error) {
      // A response can be lost after a committed write. Confirm that exact
      // ciphertext before reporting success; never roll back over another
      // device's newer change. If offline, either complete wrapper remains.
      const saved = await getCloudSyncKey(sessionToken).catch(() => null);
      if (!saved || !sameWrappedKey(saved, replacement)) throw error;
    }
  } finally {
    masterKey.fill(0);
  }
}

function sameWrappedKey(a: WrappedMasterKey, b: WrappedMasterKey): boolean {
  return a.wrappedKey === b.wrappedKey && a.nonce === b.nonce && a.salt === b.salt &&
    a.kdfIterations === b.kdfIterations && a.encryptionVersion === b.encryptionVersion;
}

/** Sign-out clears the device's cached master key (Part H §32 still preserves the local reflections themselves — only the ability to sync/decrypt new cloud data without re-entering the passphrase is cleared). */
export function forgetCachedMasterKey(): Promise<void> {
  return clearCachedMasterKey();
}
