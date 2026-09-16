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
 * re-run on reconnect (Part H §33). Order matters: preferences and
 * favorites need no key and run first; reflections run last since they may
 * need to prompt the user for their Sync Passphrase — if the user cancels
 * that prompt, favorites/preferences have already synced successfully, so
 * this returns a partial result instead of throwing.
 */
export async function runFullSync(sessionToken: string, options: FullSyncOptions): Promise<FullSyncResult> {
  const result: FullSyncResult = { favoritesSynced: false, preferencesSynced: false, reflectionsSynced: false };

  await reconcilePreferencesOnSignIn(sessionToken, options.local, options.applyPreferencesLocally);
  result.preferencesSynced = true;

  await syncFavorites(sessionToken);
  result.favoritesSynced = true;

  try {
    const masterKey = await ensureReflectionMasterKey(sessionToken, options.promptForPassphrase);
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
