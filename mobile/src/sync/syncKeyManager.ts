import { clearCachedMasterKey, getCachedMasterKey, setCachedMasterKey } from '@/auth/sessionStorage';
import { decodeBase64, encodeBase64 } from '@/crypto/base64';
import { generateMasterKey, unwrapMasterKey, wrapMasterKey } from '@/crypto/reflectionEncryption';
import { getRandomBytes } from '@/crypto/randomBytes';
import { getCloudSyncKey, putCloudSyncKey } from './syncApi';

export type SyncPassphraseMode = 'create' | 'unlock';

/** Supplied by the UI (SyncPassphraseSheet) — resolves with the passphrase the user entered, or rejects/never-resolves-then-rejects if they cancel. */
export type PassphrasePrompt = (mode: SyncPassphraseMode) => Promise<string>;

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
    const passphrase = await promptForPassphrase('unlock');
    const masterKey = await unwrapMasterKey(cloudKey, passphrase);
    await setCachedMasterKey(encodeBase64(masterKey));
    return masterKey;
  }

  const passphrase = await promptForPassphrase('create');
  const masterKey = generateMasterKey(getRandomBytes);
  const wrapped = await wrapMasterKey(masterKey, passphrase, getRandomBytes);
  await putCloudSyncKey(sessionToken, wrapped);
  await setCachedMasterKey(encodeBase64(masterKey));
  return masterKey;
}

/** Sign-out clears the device's cached master key (Part H §32 still preserves the local reflections themselves — only the ability to sync/decrypt new cloud data without re-entering the passphrase is cleared). */
export function forgetCachedMasterKey(): Promise<void> {
  return clearCachedMasterKey();
}
