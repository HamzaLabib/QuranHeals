import type { ApplyPreferences, LocalPreferencesSnapshot } from './preferencesSync';
import { reconcilePreferencesOnSignIn } from './preferencesSync';
import { syncFavorites } from './favoritesSync';
import { syncReflections } from './reflectionsSync';
import { ensureReflectionMasterKey, SyncPassphraseCancelledError, type PassphrasePrompt } from './syncKeyManager';

export type FullSyncOptions = {
  local: LocalPreferencesSnapshot;
  applyPreferencesLocally: ApplyPreferences;
  promptForPassphrase: PassphrasePrompt;
};

export type FullSyncResult = {
  favoritesSynced: boolean;
  preferencesSynced: boolean;
  reflectionsSynced: boolean;
};

/**
 * Runs after every sign-in (guest → account migration, Part G) and may be
 * re-run on reconnect (Part H §33). Order matters:
 *
 * 1. Preferences (locale, translation display) carry nothing sensitive and
 *    need no Sync Password, so they sync immediately.
 * 2. The Sync Password is a mandatory gate on *reflections and favorites*
 *    specifically (see SyncPassphraseSheet's copy) — it must be
 *    created/unlocked before either syncs, not after. Favorites therefore
 *    now runs after the password step, not before it, even though
 *    favorites themselves aren't encrypted by it (see
 *    docs/auth-and-sync/reflection-privacy.md) — the password is an
 *    access gate for that data, not just an encryption step for
 *    reflections alone.
 * 3. Reflections run last, using the now-unlocked master key.
 *
 * ensureReflectionMasterKey's prompt is mandatory in the UI (no
 * cancel/skip) — the only way it rejects with SyncPassphraseCancelledError
 * is the user choosing to sign out instead (see useAuth.tsx), in which case
 * this returns a partial result (preferences only) rather than throwing,
 * since the session is being torn down anyway.
 */
export async function runFullSync(sessionToken: string, options: FullSyncOptions): Promise<FullSyncResult> {
  const result: FullSyncResult = { favoritesSynced: false, preferencesSynced: false, reflectionsSynced: false };

  await reconcilePreferencesOnSignIn(sessionToken, options.local, options.applyPreferencesLocally);
  result.preferencesSynced = true;

  try {
    const masterKey = await ensureReflectionMasterKey(sessionToken, options.promptForPassphrase);

    await syncFavorites(sessionToken);
    result.favoritesSynced = true;

    await syncReflections(sessionToken, masterKey);
    result.reflectionsSynced = true;
  } catch (error) {
    if (error instanceof SyncPassphraseCancelledError) {
      return result;
    }
    throw error;
  }

  return result;
}
