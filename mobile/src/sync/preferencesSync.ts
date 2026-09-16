import type { AppLocale } from '@/localization/locales';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import { getCloudPreferences, putCloudPreferences } from './syncApi';

export type LocalPreferencesSnapshot = {
  locale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
  translationId: string;
};

export type ApplyPreferences = (preferences: {
  locale?: AppLocale;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
}) => void;

/**
 * First-sign-in / reconnect reconciliation (Part F §31, Part G §31): if the
 * account has never stored a preference, this device's local values become
 * the account's preference. If the account already has one, it is treated
 * as authoritative for this newly-joining/reconnecting device — a
 * deliberately simple, documented policy rather than a full bidirectional
 * timestamp merge (this project's local preference stores don't carry a
 * per-change timestamp). Any preference the user changes AFTER this point,
 * on any signed-in device, is pushed immediately via pushPreferences below,
 * so that becomes the new account-wide value going forward.
 */
export async function reconcilePreferencesOnSignIn(
  sessionToken: string,
  local: LocalPreferencesSnapshot,
  applyLocally: ApplyPreferences,
): Promise<void> {
  const cloud = await getCloudPreferences(sessionToken);

  if (!cloud) {
    await putCloudPreferences(sessionToken, { ...local, updatedAt: new Date().toISOString() });
    return;
  }

  applyLocally({
    locale: cloud.locale as AppLocale | undefined,
    translationDisplayMode: cloud.translationDisplayMode,
    translationId: cloud.translationId,
  });
}

/** Pushes the current local preference value as the new account-wide value. Called reactively whenever locale/translation preference changes while signed in — see useSyncEffects.ts. Never touches recent-ayah history (Part F §27: that never syncs). */
export function pushPreferences(sessionToken: string, local: LocalPreferencesSnapshot): Promise<void> {
  return putCloudPreferences(sessionToken, { ...local, updatedAt: new Date().toISOString() }).then(() => undefined);
}
