import type { ProviderCredential } from '@/auth/reauthentication';
import { clearCachedMasterKey, getCachedMasterKey, setCachedMasterKey } from '@/auth/sessionStorage';
import { decodeBase64, encodeBase64 } from '@/crypto/base64';
import {
  generateMasterKey,
  masterKeyFingerprint,
  unwrapMasterKey,
  wrapMasterKey,
  type WrappedMasterKey,
} from '@/crypto/reflectionEncryption';
import { getRandomBytes } from '@/crypto/randomBytes';
import { markAllReflectionsPending } from '@/storage/ayahReflections';
import { getCloudSyncKey, putCloudSyncKey, replaceCloudSyncKey, resetCloudReflectionSync } from './syncApi';
import { passwordLengthError } from '@/utils/syncPasswordValidation';

export type SyncPassphraseMode = 'create' | 'unlock';

/** Supplied by the UI (SyncPassphraseSheet) — resolves with the passphrase the user entered, or rejects/never-resolves-then-rejects if they cancel. */
export type VerifyPassphrase = (value: string) => Promise<boolean>;
/** Offered by the unlock step only: the forgotten-password recovery (see resetEncryptedReflectionSync). Requires a fresh credential from the account's own provider. */
export type ResetEncryptedSync = (credential: ProviderCredential) => Promise<void>;
export type PassphrasePrompt = (
  mode: SyncPassphraseMode,
  verify?: VerifyPassphrase,
  reset?: ResetEncryptedSync,
) => Promise<string>;

/**
 * How the unlock prompt reports that the user did not enter a password but
 * reset encrypted reflection sync instead (after the reset succeeded):
 * ensureReflectionMasterKey then continues straight into creating a new
 * password and key.
 */
export class SyncPasswordResetError extends Error {}

export async function verifySyncPassphrase(key: WrappedMasterKey, value: string): Promise<boolean> {
  try {
    const masterKey = await unwrapMasterKey(key, value);
    masterKey.fill(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The unlock step's verifier: verification IS the unwrap (KDF + AEAD
 * decryption of the cloud key), so the unwrap that proved the password is
 * kept and reused once the user continues instead of running the KDF a
 * second time. Only the latest value is kept; a superseded result is wiped.
 */
export function createPassphraseVerifier(key: WrappedMasterKey) {
  let latest: { value: string; masterKey: Promise<Uint8Array> } | null = null;
  const wipe = (entry: typeof latest) => void entry?.masterKey.then((masterKey) => masterKey.fill(0), () => {});
  const unwrap = (value: string) => {
    if (latest?.value !== value) {
      wipe(latest);
      latest = { value, masterKey: unwrapMasterKey(key, value) };
    }
    return latest.masterKey;
  };
  return {
    verify: ((value) => unwrap(value).then(() => true, () => false)) as VerifyPassphrase,
    /** The master key for `value` (a copy the caller owns); throws on a wrong password. */
    unwrap: async (value: string) => (await unwrap(value)).slice(),
    dispose: () => {
      wipe(latest);
      latest = null;
    },
  };
}

export class SyncPassphraseCancelledError extends Error {}

/**
 * The cached master key is stored together with the account it belongs to
 * and is only ever returned for that account — another account signing in
 * on this device never receives it, even if clearing it at sign-out failed.
 * A value cached by an earlier version (a bare base64 key, no account) is
 * accepted once and rebound: those versions cleared it at every sign-out,
 * so it can only belong to the session that was signed in across the update.
 */
async function readCachedMasterKey(ownerUserId: string): Promise<Uint8Array | null> {
  const cached = await getCachedMasterKey();
  if (!cached) return null;

  let bound: unknown;
  try {
    bound = JSON.parse(cached);
  } catch {
    bound = undefined;
  }
  if (bound && typeof bound === 'object' && !Array.isArray(bound)) {
    const { userId, key } = bound as { userId?: unknown; key?: unknown };
    if (userId === ownerUserId && typeof key === 'string') return decodeBase64(key);
    await clearCachedMasterKey();
    return null;
  }

  const legacyKey = decodeBase64(cached);
  await cacheMasterKeyFor(ownerUserId, legacyKey);
  return legacyKey;
}

function cacheMasterKeyFor(ownerUserId: string, masterKey: Uint8Array): Promise<void> {
  return setCachedMasterKey(JSON.stringify({ userId: ownerUserId, key: encodeBase64(masterKey) }));
}

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
  ownerUserId: string,
  // False once this sync's session ended: its key is then never cached
  // (sign-out has just cleared the cached key; it must stay cleared).
  isCurrent: () => boolean = () => true,
): Promise<Uint8Array> {
  const cacheMasterKey = async (owner: string, masterKey: Uint8Array) => {
    if (!isCurrent()) throw new SyncPassphraseCancelledError('The session ended before the sync password step completed.');
    await cacheMasterKeyFor(owner, masterKey);
  };
  const cloudKey = await getCloudSyncKey(sessionToken);
  const cached = await readCachedMasterKey(ownerUserId);
  if (cached) {
    if (cachedKeyIsCurrent(cached, cloudKey)) return cached;
    // The account's key was reset elsewhere (forgotten password on another
    // device): this key must never encrypt anything again.
    await clearCachedMasterKey();
  }

  if (cloudKey) {
    let resetCompleted = false;
    const reset: ResetEncryptedSync = async (credential) => {
      await resetEncryptedReflectionSync(sessionToken, ownerUserId, credential);
      resetCompleted = true;
    };
    const verifier = createPassphraseVerifier(cloudKey);
    let passphrase: string;
    try {
      passphrase = await promptForPassphrase('unlock', verifier.verify, reset);
    } catch (error) {
      verifier.dispose();
      if (!(resetCompleted && error instanceof SyncPasswordResetError)) throw error;
      return createMasterKey(sessionToken, promptForPassphrase, ownerUserId, cacheMasterKey);
    }
    try {
      const masterKey = await verifier.unwrap(passphrase);
      await cacheMasterKey(ownerUserId, masterKey);
      return masterKey;
    } finally {
      verifier.dispose();
    }
  }

  return createMasterKey(sessionToken, promptForPassphrase, ownerUserId, cacheMasterKey);
}

/**
 * A cached key is only usable while it is still the account's key. No
 * cloud key at all means the key was reset (or the account deleted). Keys
 * created before fingerprints existed cannot be checked and are trusted, as
 * before.
 */
function cachedKeyIsCurrent(cached: Uint8Array, cloudKey: WrappedMasterKey | null): boolean {
  if (!cloudKey) return false;
  return !cloudKey.keyFingerprint || cloudKey.keyFingerprint === masterKeyFingerprint(cached);
}

/** Always a brand-new random master key — a reset never reuses the old one. */
async function createMasterKey(
  sessionToken: string,
  promptForPassphrase: PassphrasePrompt,
  ownerUserId: string,
  cacheMasterKey: (owner: string, masterKey: Uint8Array) => Promise<void>,
): Promise<Uint8Array> {
  const passphrase = await promptForPassphrase('create');
  if (passwordLengthError(passphrase)) throw new Error('Invalid new sync password length.');
  const masterKey = generateMasterKey(getRandomBytes);
  const wrapped = await wrapMasterKey(masterKey, passphrase, getRandomBytes);
  await putCloudSyncKey(sessionToken, { ...wrapped, keyFingerprint: masterKeyFingerprint(masterKey) });
  await cacheMasterKey(ownerUserId, masterKey);
  return masterKey;
}

/**
 * Forgotten sync password recovery. The password cannot be recovered and
 * nothing encrypted under it can be decrypted without it — by design — so
 * this discards the account's encrypted reflection sync state instead: the
 * cloud sync key and every cloud reflection record (backend), and this
 * device's cached key. Reflections stored on this device are kept and
 * marked unsynced; the next sync re-encrypts them under the NEW key the
 * user creates next. Favorites, preferences and the account are untouched.
 *
 * `credential` is a fresh Apple/Google ID token for the account's own
 * identity; the backend refuses the reset unless it verifies (nothing is
 * deleted, locally or remotely, if it does not).
 */
export async function resetEncryptedReflectionSync(
  sessionToken: string,
  ownerUserId: string,
  credential: ProviderCredential,
): Promise<void> {
  await resetCloudReflectionSync(sessionToken, credential);
  await clearCachedMasterKey();
  await markAllReflectionsPending(ownerUserId);
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
    // Same master key, so the same fingerprint — kept only if the account's
    // key already had one (and refused if it does not match this key).
    if (previous.keyFingerprint && previous.keyFingerprint !== masterKeyFingerprint(masterKey)) {
      throw new Error('Key verification failed.');
    }
    const replacement: WrappedMasterKey = {
      ...(await wrapMasterKey(masterKey, next, getRandomBytes)),
      ...(previous.keyFingerprint ? { keyFingerprint: previous.keyFingerprint } : {}),
    };
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
