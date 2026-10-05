import type { AppLocale } from '@/localization/locales';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import {
  getLocalPreferencesUpdatedAt,
  markPreferencesSynced,
  recordLocalPreferencesUpdatedAt,
} from './preferencesSyncState';
import { getCloudPreferences, putCloudPreferences, type PreferencesRecord } from './syncApi';

export type LocalPreferencesSnapshot = {
  locale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
  translationId: string;
};

/**
 * A getter is preferred: it is read only once the cloud request returns, so
 * a change the user makes while that request is in flight is the value
 * uploaded — never a snapshot taken before it.
 */
export type LocalPreferencesSource = LocalPreferencesSnapshot | (() => LocalPreferencesSnapshot);

export type ApplyPreferences = (preferences: {
  locale?: AppLocale;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
}) => void;

function readLocal(source: LocalPreferencesSource): LocalPreferencesSnapshot {
  return typeof source === 'function' ? source() : source;
}

function timestampOf(record: PreferencesRecord | null | undefined): number | null {
  if (!record) return null;
  const parsed = Date.parse(record.updatedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function adoptCloud(cloud: PreferencesRecord, applyLocally: ApplyPreferences): void {
  applyLocally({
    locale: cloud.locale as AppLocale | undefined,
    translationDisplayMode: cloud.translationDisplayMode,
    translationId: cloud.translationId,
  });
  const cloudUpdatedAt = timestampOf(cloud);
  if (cloudUpdatedAt !== null) {
    recordLocalPreferencesUpdatedAt(cloudUpdatedAt);
    markPreferencesSynced(cloudUpdatedAt);
  }
}

/**
 * Uploads this device's preferences stamped with the time they last changed
 * here (never "now" when a change time is known, so an old change can never
 * look newer than it is). The backend keeps whichever is newer and returns
 * what it stored; a newer value from another device is adopted unless this
 * device changed again in the meantime.
 */
async function uploadLocal(
  sessionToken: string,
  local: LocalPreferencesSource,
  localUpdatedAt: number | null,
  applyLocally?: ApplyPreferences,
): Promise<void> {
  const updatedAt = localUpdatedAt ?? Date.now();
  const saved = await putCloudPreferences(sessionToken, { ...readLocal(local), updatedAt: new Date(updatedAt).toISOString() });
  const savedUpdatedAt = timestampOf(saved);

  if (savedUpdatedAt === null || savedUpdatedAt <= updatedAt) {
    markPreferencesSynced(updatedAt);
    return;
  }
  const latestLocal = await getLocalPreferencesUpdatedAt();
  if (applyLocally && (latestLocal === null || savedUpdatedAt > latestLocal)) adoptCloud(saved, applyLocally);
}

/**
 * Runs on every full sync (sign-in, cold start, foreground, pull-to-refresh).
 * Per-record last-write-wins by timestamp, matching the backend:
 *  - no account preference yet → this device's preferences are uploaded;
 *  - this device changed more recently than the account → uploaded;
 *  - the account is newer, or this device never recorded a change → the
 *    account preference is applied here;
 *  - same timestamp → already in agreement, nothing to do.
 */
export async function reconcilePreferencesOnSignIn(
  sessionToken: string,
  local: LocalPreferencesSource,
  applyLocally: ApplyPreferences,
): Promise<void> {
  const cloud = await getCloudPreferences(sessionToken);
  // Read after the request returns: a change made during it must count.
  const localUpdatedAt = await getLocalPreferencesUpdatedAt();
  const cloudUpdatedAt = timestampOf(cloud);

  if (cloud && (localUpdatedAt === null || (cloudUpdatedAt !== null && cloudUpdatedAt > localUpdatedAt))) {
    adoptCloud(cloud, applyLocally);
    return;
  }

  if (cloud && cloudUpdatedAt !== null && cloudUpdatedAt === localUpdatedAt) {
    markPreferencesSynced(cloudUpdatedAt);
    return;
  }

  await uploadLocal(sessionToken, local, localUpdatedAt, applyLocally);
}

/** Pushes this device's preferences as soon as they change while signed in (see useAuth.tsx). A failure is left for the next full sync, which re-sends them because they are still newer than the account's. Never touches recent-ayah history (Part F §27: that never syncs). */
export async function pushPreferences(sessionToken: string, local: LocalPreferencesSource): Promise<void> {
  await uploadLocal(sessionToken, local, await getLocalPreferencesUpdatedAt());
}
