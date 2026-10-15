import { syncPreferences, type ApplyPreference } from './preferencesSync';
import { syncFavorites } from './favoritesSync';
import { syncReading } from './readingSync';
import { syncReflections } from './reflectionsSync';
import { ensureReflectionMasterKey, SyncPassphraseCancelledError, type PassphrasePrompt } from './syncKeyManager';

export type FullSyncOptions = {
  /** The account `sessionToken` belongs to. Favorites/reflections sync only that account's local data and cached key. */
  ownerUserId: string;
  /** Applies one of the account's settings on this device (sync/preferencesSync.ts). */
  applyPreference: ApplyPreference;
  promptForPassphrase: PassphrasePrompt;
  /**
   * False once the session this sync runs for has ended (sign-out, or
   * another account signed in): the sync stops at the next step instead of
   * caching keys or syncing further. Every step already only touches
   * `ownerUserId`'s own data; this keeps a late sync from doing anything at
   * all after its session is gone. Defaults to always current.
   */
  isCurrent?: () => boolean;
};

/** A sync that stopped because its session ended — not a failure. */
export class StaleSyncError extends Error {}

export type FullSyncResult = {
  favoritesSynced: boolean;
  preferencesSynced: boolean;
  reflectionsSynced: boolean;
  /** أورادي وختماتي: true only when every change was acknowledged by the account. */
  readingSynced: boolean;
};

/**
 * Runs after every sign-in (guest → account migration, Part G) and may be
 * re-run on reconnect (Part H §33). Order matters:
 *
 * 1. Settings (sync/preferenceFields.ts) carry nothing sensitive and need
 *    no Sync Password, so they sync immediately — this account's own
 *    values only: nothing chosen as a guest or under another account is
 *    uploaded (sync/preferencesSyncState.ts).
 * 2. أورادي وختماتي (sync/readingSync.ts): account-based, like favorites'
 *    storage, and never behind the Sync Password — so they sync before its
 *    prompt, whether reflections are unlocked, locked, or never set up. A
 *    failure (offline…) never blocks the rest or throws: it is reported as
 *    `readingSynced: false`, and the caller retries (useAuth.tsx).
 * 3. The Sync Password is a mandatory gate on *reflections and favorites*
 *    specifically (see SyncPassphraseSheet's copy) — it must be
 *    created/unlocked before either syncs, not after. Favorites therefore
 *    now runs after the password step, not before it, even though
 *    favorites themselves aren't encrypted by it (see
 *    docs/auth-and-sync/reflection-privacy.md) — the password is an
 *    access gate for that data, not just an encryption step for
 *    reflections alone.
 * 4. Reflections run last, using the now-unlocked master key.
 *
 * ensureReflectionMasterKey's prompt is mandatory in the UI (no
 * cancel/skip) — the only way it rejects with SyncPassphraseCancelledError
 * is the user choosing to sign out instead (see useAuth.tsx), in which case
 * this returns a partial result (preferences and أورادي وختماتي) rather than throwing,
 * since the session is being torn down anyway.
 */
export async function runFullSync(sessionToken: string, options: FullSyncOptions): Promise<FullSyncResult> {
  const result: FullSyncResult = { favoritesSynced: false, preferencesSynced: false, reflectionsSynced: false, readingSynced: false };
  const isCurrent = options.isCurrent ?? (() => true);
  const stopIfStale = () => {
    if (!isCurrent()) throw new StaleSyncError('The session this sync was for has ended.');
  };

  try {
    stopIfStale();
    await syncPreferences(sessionToken, options.ownerUserId, options.applyPreference, { isCurrent });
    result.preferencesSynced = true;

    stopIfStale();
    try {
      result.readingSynced = await syncReading(sessionToken, options.ownerUserId, { isCurrent });
    } catch {
      // Everything stays saved on the device; the next sync retries it.
    }

    stopIfStale();
    const masterKey = await ensureReflectionMasterKey(sessionToken, options.promptForPassphrase, options.ownerUserId, isCurrent);

    stopIfStale();
    await syncFavorites(sessionToken, options.ownerUserId);
    result.favoritesSynced = true;

    stopIfStale();
    await syncReflections(sessionToken, masterKey, options.ownerUserId);
    result.reflectionsSynced = true;
  } catch (error) {
    if (error instanceof SyncPassphraseCancelledError || error instanceof StaleSyncError) {
      return result;
    }
    throw error;
  }

  return result;
}
