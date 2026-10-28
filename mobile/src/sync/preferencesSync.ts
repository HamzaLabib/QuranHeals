import { loadRecentEmotionUses, mergeRecentEmotionsFromAccount, mergeRecentEmotionUses, sameRecentEmotionUses, type RecentEmotionUse } from '@/storage/recentEmotions';

import {
  parseCloudPreferences,
  parseCloudRecentEmotions,
  RECENT_EMOTIONS_FIELD,
  samePreferenceValue,
  SYNCED_PREFERENCE_FIELDS,
  type SyncedPreferenceField,
  type SyncedPreferenceValue,
} from './preferenceFields';
import { loadAccountPreferenceState, updateAccountPreferenceState, type PreferenceEntry } from './preferencesSyncState';
import { getCloudPreferences, putCloudPreferences, type PreferencesRecord } from './syncApi';

/** Applies an account value on this device (the settings' setters with `fromSync`, so it is not recorded as the user's change). */
export type ApplyPreference = (field: SyncedPreferenceField, value: SyncedPreferenceValue) => void;

export type PreferenceSyncOptions = {
  /** False once the session this sync runs for has ended: nothing more is applied on the device. */
  isCurrent?: () => boolean;
};

/** One preference sync per account at a time: a full sync and an immediate upload never interleave. */
const queues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  queues.set(userId, settled);
  void settled.then(() => {
    if (queues.get(userId) === settled) queues.delete(userId);
  });
  return run;
}

/**
 * Settings sync for one signed-in account, field by field
 * (sync/preferenceFields.ts; the server's rules are
 * backend/src/services/preferencesMerge.ts). Runs on every full sync
 * (sign-in, launch, foreground, pull-to-refresh).
 *
 *  1. Download the account's settings. For each field:
 *     - a change made here for this account and not yet confirmed, newer
 *       than the account's → kept, and uploaded in step 2;
 *     - otherwise the account's value is applied on this device (settings
 *       follow the signed-in account);
 *     - a field the account has never stored is left as it is here, and
 *       NOT uploaded: only the user's own change while signed in to this
 *       account is (sync/preferencesSyncState.ts).
 *  2. Upload this account's pending changes (pushPreferences).
 *
 * Home's recent emotions merge instead (storage/recentEmotions.ts): the
 * account's history joins this account's own list here, and whatever this
 * device has beyond what the account returned goes up with step 2.
 */
export function syncPreferences(sessionToken: string, ownerUserId: string, apply: ApplyPreference, options: PreferenceSyncOptions = {}): Promise<void> {
  return oneAtATime(ownerUserId, async () => {
    const isCurrent = options.isCurrent ?? (() => true);
    const record = await getCloudPreferences(sessionToken);
    const cloud = parseCloudPreferences(record);
    await adoptAccountRecentEmotions(ownerUserId, record, [], isCurrent);
    const toApply = await updateAccountPreferenceState(ownerUserId, (state) => {
      const adopted: [SyncedPreferenceField, SyncedPreferenceValue][] = [];
      for (const field of SYNCED_PREFERENCE_FIELDS) {
        const remote = cloud[field];
        if (!remote) continue;
        const entry = state.fields[field];
        if (entry && !entry.synced && entry.updatedAt > remote.at) continue;
        state.fields[field] = { value: remote.value, updatedAt: remote.at, synced: true };
        adopted.push([field, remote.value]);
      }
      return adopted;
    });
    if (isCurrent()) toApply.forEach(([field, value]) => apply(field, value));
    await upload(sessionToken, ownerUserId, apply, isCurrent);
  });
}

/** Uploads this account's pending setting changes now (a change made while signed in; see useAuth.tsx). A failure leaves them pending for the next sync. */
export function pushPreferences(sessionToken: string, ownerUserId: string, apply: ApplyPreference, options: PreferenceSyncOptions = {}): Promise<void> {
  return oneAtATime(ownerUserId, () => upload(sessionToken, ownerUserId, apply, options.isCurrent ?? (() => true)));
}

/**
 * The account's recent emotions (`record`), if it returned any, become what
 * the account is known to hold and join `ownerUserId`'s own list; `sent`:
 * the uses this device just uploaded (their instants as the account stored
 * them are adopted). A server that does not know them returns none: then
 * nothing changes here.
 */
async function adoptAccountRecentEmotions(ownerUserId: string, record: PreferencesRecord | null, sent: RecentEmotionUse[], isCurrent: () => boolean): Promise<void> {
  const account = parseCloudRecentEmotions(record);
  if (account === null) return;
  await updateAccountPreferenceState(ownerUserId, (state) => {
    state.recentEmotions = account;
  });
  if (isCurrent()) await mergeRecentEmotionsFromAccount(ownerUserId, account, sent);
}

/** backend/src/validators/syncValidators.ts recentEmotionsSchema's key (the catalog's keys, e.g. "closer_to_allah"). */
const UPLOADABLE_EMOTION_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** This account's recent emotions to upload: its list here when that adds anything to what the account holds; else null. */
async function recentEmotionsToUpload(ownerUserId: string, known: RecentEmotionUse[] | undefined): Promise<RecentEmotionUse[] | null> {
  // Only keys in the catalog's form: one damaged entry must never get every settings upload refused.
  const own = (await loadRecentEmotionUses(ownerUserId)).filter((use) => UPLOADABLE_EMOTION_KEY.test(use.key));
  if (own.length === 0) return null;
  const account = known ?? [];
  return sameRecentEmotionUses(mergeRecentEmotionUses(own, account), account) ? null : own;
}

async function upload(sessionToken: string, ownerUserId: string, apply: ApplyPreference, isCurrent: () => boolean): Promise<void> {
  const state = await loadAccountPreferenceState(ownerUserId);
  const pending = SYNCED_PREFERENCE_FIELDS.flatMap((field) => {
    const entry = state.fields[field];
    return entry && !entry.synced ? [[field, entry] as [SyncedPreferenceField, PreferenceEntry]] : [];
  });
  const recent = await recentEmotionsToUpload(ownerUserId, state.recentEmotions);
  if (pending.length === 0 && !recent) return;

  const body: Record<string, unknown> = { fieldUpdatedAt: {} };
  let newest = 0;
  for (const [field, entry] of pending) {
    body[field] = entry.value;
    (body.fieldUpdatedAt as Record<string, string>)[field] = new Date(entry.updatedAt).toISOString();
    newest = Math.max(newest, entry.updatedAt);
  }
  if (recent) {
    const latest = Math.max(...recent.map((use) => use.at));
    body[RECENT_EMOTIONS_FIELD] = recent.map((use) => ({ key: use.key, at: new Date(use.at).toISOString() }));
    (body.fieldUpdatedAt as Record<string, string>)[RECENT_EMOTIONS_FIELD] = new Date(latest).toISOString();
    newest = Math.max(newest, latest);
  }
  // What a server from before per-field sync compares (it ignores fieldUpdatedAt and the newer settings).
  body.updatedAt = new Date(newest).toISOString();
  const record = await putCloudPreferences(sessionToken, body as never);
  const saved = parseCloudPreferences(record);
  if (recent) await adoptAccountRecentEmotions(ownerUserId, record, recent, isCurrent);

  const toApply = await updateAccountPreferenceState(ownerUserId, (current) => {
    const adopted: [SyncedPreferenceField, SyncedPreferenceValue][] = [];
    for (const [field, sent] of pending) {
      const entry = current.fields[field];
      // Changed again while this was uploading: that newer change goes next time.
      if (!entry || entry.updatedAt !== sent.updatedAt || entry.synced) continue;
      const stored = saved[field];
      // Not stored (a server that does not know this setting yet): stays pending.
      if (!stored) continue;
      const sameValue = samePreferenceValue(stored.value, sent.value);
      if (stored.at === sent.updatedAt && sameValue) {
        entry.synced = true;
        continue;
      }
      // This value, stored at an earlier instant than sent: the server's
      // time in place of a device clock running ahead
      // (backend/src/services/clientInstants.ts). That instant is kept here,
      // so a later change on any device can still win.
      const acceptedEarlier = sameValue && stored.at < sent.updatedAt;
      // The Mushaf guide only moves forward on the account (preferencesMerge.ts): a 'closed' sent here never
      // replaces another device's 'finished', which is then kept here too, whatever its instant.
      const outranked = field === 'mushafGuide' && stored.value === 'finished' && sent.value === 'closed';
      if (acceptedEarlier || outranked || stored.at >= sent.updatedAt) {
        // The account holds a newer value (another device), or the same
        // value at the newest instant of this upload (an older server).
        current.fields[field] = { value: stored.value, updatedAt: stored.at, synced: true };
        if (!sameValue) adopted.push([field, stored.value]);
      }
    }
    return adopted;
  });
  if (isCurrent()) toApply.forEach(([field, value]) => apply(field, value));
}
